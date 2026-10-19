import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LedgerReason, LogoEngine, Prisma, SignatureKind, SignatureStatus } from '@prisma/client';
import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z, ZodError, ZodTypeAny } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import { fontInfo, iconExists, iconMarkup } from '../../render/assets';
import { optimizeSvg, toPng } from '../../render/export';
import { MAX_UPLOAD_BYTES, sniffImage } from '../../render/sanitize';
import {
  EmailBrand,
  EmailTemplateContent,
  INSTALL_GUIDE,
  PlatformMention,
  renderEmailSignatureHtml,
  renderEmailSignatureText,
  SOCIAL_NETWORKS,
} from '../../render/signatures/email';
import { handwritingProposals, renderHandwriting } from '../../render/signatures/handwritten';
import { renderStamp, stampTexts } from '../../render/signatures/stamp';
import { renderVariant } from '../../render/variants';
import { CREDIT_COSTS, PUBLIC_TRIES_PER_DAY } from '../../shared/credit-costs';
import { parseCsv } from '../../shared/csv';
import { logoSpecSchema } from '../../shared/logo-spec';
import { AuditService } from '../audit/audit.service';
import { CreditsService } from '../credits/credits.service';
import { ModerationService } from '../moderation/moderation.service';
import { StorageService } from '../storage/storage.service';
import {
  EmailData,
  emailDataSchema,
  handwrittenDataSchema,
  IMAGE_SIGNATURE_NOTICE,
  stampDataSchema,
} from './signature.schemas';
import {
  BatchSignaturesDto,
  CreateSignatureDto,
  PublicEmailSignatureDto,
  UpdateSignatureDto,
} from './signatures.dto';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

const DEFAULT_BRAND = { primary: '#0E7C66', secondary: '#F2A541', text: '#1F2937' };
const LOGO_DISPLAY_HEIGHT = 56;
const PHOTO_SIZE = 80;
const MAX_BATCH_ROWS = 200;

@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly credits: CreditsService,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // ─── Création ───

  async create(ctx: Ctx, dto: CreateSignatureDto) {
    switch (dto.kind) {
      case SignatureKind.EMAIL:
        return this.createEmail(ctx, dto);
      case SignatureKind.HANDWRITTEN:
      case SignatureKind.STAMP:
        return this.createImage(ctx, dto);
    }
  }

  /** Signature e-mail (SIG-10 à SIG-15) : gratuite, images publiques pour les messageries. */
  private async createEmail(
    ctx: Ctx,
    dto: Pick<CreateSignatureDto, 'data' | 'templateId' | 'logoId' | 'photoBase64'>,
  ) {
    const data = parse(emailDataSchema, dto.data);
    const template = await this.emailTemplate(dto.templateId);
    const signature = await this.prisma.signature.create({
      data: {
        projectId: ctx.projectId,
        kind: SignatureKind.EMAIL,
        templateId: template.id,
        data: { ...data, logoId: dto.logoId ?? null } as Prisma.InputJsonValue,
        isPrivate: false,
      },
    });
    return this.renderEmail(
      signature.id,
      ctx.workspaceId,
      data,
      template.content as unknown as EmailTemplateContent,
      dto.logoId,
      dto.photoBase64,
    );
  }

  /** Paraphe ou cachet (SIG-20 à SIG-24) : 1 crédit, attestation, fichiers privés (§6.4). */
  private async createImage(ctx: Ctx, dto: CreateSignatureDto) {
    if (!dto.attest) {
      throw new BadRequestException(
        'Attestez être titulaire du nom ou habilité à représenter la structure',
      );
    }
    const { svg, data, flagged } = await this.renderImage(dto.kind, dto.data);
    if (dto.templateId)
      await this.prisma.template.findFirstOrThrow({ where: { id: dto.templateId, kind: 'STAMP' } });

    const signature = await this.prisma.$transaction(async (tx) => {
      const created = await tx.signature.create({
        data: {
          projectId: ctx.projectId,
          kind: dto.kind,
          templateId: dto.templateId,
          data: data as Prisma.InputJsonValue,
          status: flagged.length ? SignatureStatus.PENDING_REVIEW : SignatureStatus.ACTIVE,
          isPrivate: true,
          attestedAt: new Date(),
        },
      });
      await this.credits.debit(tx, {
        workspaceId: ctx.workspaceId,
        amount: CREDIT_COSTS.HANDWRITTEN_OR_STAMP,
        reason: LedgerReason.GENERATION,
        actorId: ctx.actorId,
        note: `SIGNATURE_${dto.kind}:${created.id}`,
      });
      return created;
    });

    const fileKey = await this.storeImage(signature.id, svg, dto.kind);
    const saved = await this.prisma.signature.update({
      where: { id: signature.id },
      data: { fileKey },
    });
    await this.audit.log({
      actorId: ctx.actorId,
      action: 'signature.attest',
      entityType: 'Signature',
      entityId: signature.id,
      after: { kind: dto.kind, attestedAt: saved.attestedAt, flagged },
    });
    return this.present(saved, flagged);
  }

  private async renderImage(kind: SignatureKind, raw: unknown) {
    if (kind === SignatureKind.HANDWRITTEN) {
      const data = parse(handwrittenDataSchema, raw);
      const { svg } = renderHandwriting(data.spec, data.ink);
      return { svg, data, flagged: [] as string[] };
    }
    const data = parse(stampDataSchema, raw);
    if (data.center.kind === 'icon' && !iconExists(data.center.iconId)) {
      throw new BadRequestException('Icône hors bibliothèque');
    }
    // Termes officiels (République, Ministère, Police…) : validation manuelle (§6.4).
    const flagged = [
      ...new Set(
        (
          await Promise.all(stampTexts(data).map((t) => this.moderation.findBlocked(t, 'STAMP')))
        ).flat(),
      ),
    ];
    const { svg } = renderStamp(data);
    return { svg, data, flagged };
  }

  /** Fichiers privés : SVG et PNG transparent haute définition (SIG-24). */
  private async storeImage(signatureId: string, svg: string, kind: SignatureKind) {
    const base = `private/signatures/${signatureId}/${kind === SignatureKind.STAMP ? 'cachet' : 'paraphe'}`;
    await this.storage.put(`${base}.svg`, optimizeSvg(svg), 'image/svg+xml');
    await this.storage.put(
      `${base}.png`,
      toPng(svg, kind === SignatureKind.STAMP ? 2400 : 1800),
      'image/png',
    );
    return base;
  }

  // ─── Signature e-mail : rendu et images publiques ───

  private async renderEmail(
    signatureId: string,
    workspaceId: string,
    data: EmailData,
    template: EmailTemplateContent,
    logoId?: string | null,
    photoBase64?: string,
  ) {
    const signature = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    const brand = await this.brand(signature.projectId, signatureId, logoId);
    if (photoBase64) brand.photo = await this.publishPhoto(signatureId, photoBase64);
    else if ((signature.data as { photoUrl?: string } | null)?.photoUrl) {
      brand.photo = { url: (signature.data as { photoUrl: string }).photoUrl, size: PHOTO_SIZE };
    }
    brand.socialIcons = await this.publishSocialIcons(signatureId, data, brand.primary);

    // Offre gratuite : mention de la plateforme dans la signature (§8.2).
    const platform = (await this.credits.hasPaidAccess(workspaceId)) ? null : this.platform();
    const html = renderEmailSignatureHtml(data, brand, template, platform);
    const updated = await this.prisma.signature.update({
      where: { id: signatureId },
      data: {
        html,
        data: {
          ...data,
          logoId: logoId ?? null,
          photoUrl: brand.photo?.url ?? null,
        } as Prisma.InputJsonValue,
      },
    });
    return { ...this.present(updated), text: renderEmailSignatureText(data, platform) };
  }

  /** Couleurs, police et logo du kit (SIG-12) : logo choisi, sinon favori, sinon le plus récent. */
  private async brand(
    projectId: string,
    signatureId: string,
    logoId?: string | null,
  ): Promise<EmailBrand> {
    const logo = await this.prisma.logo.findFirst({
      where: { projectId, engine: { not: LogoEngine.UPLOAD }, ...(logoId && { id: logoId }) },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
    });
    if (logoId && !logo) throw new BadRequestException('Logo introuvable dans ce projet');
    const parsed = logo ? logoSpecSchema.safeParse(logo.versions[0]?.spec) : null;
    if (!parsed?.success) {
      return { ...DEFAULT_BRAND, fontFamily: 'Arial, Helvetica, sans-serif' };
    }

    const spec = parsed.data;
    const font = fontInfo(spec.font.id);
    const fallback =
      font?.category === 'serif'
        ? "Georgia, 'Times New Roman', serif"
        : 'Arial, Helvetica, sans-serif';
    // Logo horizontal sans signature, en PNG 2× pour les écrans haute densité.
    const rendered = renderVariant(
      { ...spec, tagline: null, colors: { ...spec.colors, background: null } },
      'horizontal',
    );
    const height = LOGO_DISPLAY_HEIGHT;
    const width = Math.round((rendered.width / rendered.height) * height);
    const png = toPng(rendered.svg, width * 2);
    return {
      primary: spec.colors.primary,
      secondary: spec.colors.secondary,
      text: spec.colors.text,
      fontFamily: font ? `'${font.family}', ${fallback}` : fallback,
      logo: { url: await this.publishAsset(signatureId, 'logo', png), width, height },
    };
  }

  private async publishPhoto(signatureId: string, base64: string) {
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('Photo : 5 Mo maximum');
    const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    if (!isJpeg && sniffImage(buf) !== 'png')
      throw new BadRequestException('Photo : PNG ou JPEG uniquement');
    const png = await sharp(buf)
      .resize(PHOTO_SIZE * 2, PHOTO_SIZE * 2, { fit: 'cover' })
      .png()
      .toBuffer();
    return { url: await this.publishAsset(signatureId, 'photo', png), size: PHOTO_SIZE };
  }

  private async publishSocialIcons(signatureId: string, data: EmailData, color: string) {
    const icons: EmailBrand['socialIcons'] = {};
    for (const net of SOCIAL_NETWORKS) {
      if (!data.socials?.[net]) continue;
      const id = `brand-${net}`;
      if (!iconExists(id)) continue;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(id)}</svg>`;
      icons[net] = await this.publishAsset(signatureId, net, toPng(svg, 40));
    }
    return icons;
  }

  /**
   * Images des signatures e-mail : les messageries exigent des URL HTTPS absolues et durables,
   * donc ces fichiers (et eux seuls) sont servis publiquement par l'API. Le nom contient
   * l'empreinte du contenu, ce qui permet une mise en cache longue.
   */
  private async publishAsset(signatureId: string, name: string, png: Buffer) {
    const hash = createHash('sha256').update(png).digest('hex').slice(0, 12);
    const file = `${name}-${hash}.png`;
    await this.storage.put(`public/signatures/${signatureId}/${file}`, png, 'image/png');
    return `${this.config.getOrThrow<string>('API_URL')}/api/v1/public/signature-assets/${signatureId}/${file}`;
  }

  async publicAsset(signatureId: string, file: string): Promise<Buffer> {
    if (!/^[a-z]+-[0-9a-f]{12}\.png$/.test(file)) throw new NotFoundException();
    const sig = await this.prisma.signature.findUnique({
      where: { id: signatureId },
      select: { kind: true },
    });
    if (sig?.kind !== SignatureKind.EMAIL) throw new NotFoundException();
    try {
      return await this.storage.get(`public/signatures/${signatureId}/${file}`);
    } catch {
      throw new NotFoundException();
    }
  }

  private async emailTemplate(templateId?: string) {
    const template = templateId
      ? await this.prisma.template.findFirst({
          where: { id: templateId, kind: 'EMAIL_SIGNATURE', isActive: true },
        })
      : await this.prisma.template.findFirst({
          where: { kind: 'EMAIL_SIGNATURE', isActive: true },
          orderBy: { name: 'asc' },
        });
    if (!template) throw new BadRequestException('Modèle de signature e-mail introuvable');
    return template;
  }

  private platform(): PlatformMention {
    return {
      name: this.config.get<string>('PLATFORM_NAME') ?? 'Plateforme',
      url: this.config.getOrThrow<string>('APP_URL'),
    };
  }

  // ─── Consultation et modification ───

  async get(signatureId: string) {
    const s = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    return this.present(s);
  }

  list(projectId: string) {
    return this.prisma.signature
      .findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } })
      .then((rows) => rows.map((r) => this.present(r)));
  }

  async update(ctx: Ctx, signatureId: string, dto: UpdateSignatureDto) {
    const s = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    if (s.kind === SignatureKind.EMAIL) {
      const current = s.data as Record<string, unknown>;
      const data = parse(emailDataSchema, { ...current, ...(dto.data ?? {}) });
      const template = await this.emailTemplate(dto.templateId ?? s.templateId ?? undefined);
      if (dto.templateId)
        await this.prisma.signature.update({
          where: { id: s.id },
          data: { templateId: template.id },
        });
      const logoId = dto.logoId ?? (current.logoId as string | null);
      return this.renderEmail(
        s.id,
        ctx.workspaceId,
        data,
        template.content as unknown as EmailTemplateContent,
        logoId,
        dto.photoBase64,
      );
    }

    // Paraphe ou cachet : retouche gratuite, nouvelle attestation et nouveau contrôle des termes.
    if (!dto.data) throw new BadRequestException('Rien à modifier');
    if (!dto.attest)
      throw new BadRequestException('Attestation requise pour modifier un paraphe ou un cachet');
    if (s.status === SignatureStatus.REJECTED)
      throw new ForbiddenException('Ce cachet a été refusé par la modération');
    const { svg, data, flagged } = await this.renderImage(s.kind, {
      ...(s.data as object),
      ...dto.data,
    });
    const fileKey = await this.storeImage(s.id, svg, s.kind);
    const updated = await this.prisma.signature.update({
      where: { id: s.id },
      data: {
        data: data as Prisma.InputJsonValue,
        fileKey,
        attestedAt: new Date(),
        status: flagged.length ? SignatureStatus.PENDING_REVIEW : SignatureStatus.ACTIVE,
      },
    });
    return this.present(updated, flagged);
  }

  /** HTML, texte brut et guide d'installation (SIG-13 à SIG-15). */
  async html(signatureId: string) {
    const s = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    if (s.kind !== SignatureKind.EMAIL || !s.html)
      throw new BadRequestException('Pas une signature e-mail');
    const platform = s.html.includes('Signature créée avec') ? this.platform() : null;
    return {
      html: s.html,
      text: renderEmailSignatureText(parse(emailDataSchema, s.data), platform),
      installGuide: INSTALL_GUIDE,
    };
  }

  /** URL signée de 15 minutes vers le paraphe ou le cachet, s'il est validé (§6.4). */
  async file(signatureId: string, format: 'png' | 'svg' = 'png') {
    const s = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    if (s.kind === SignatureKind.EMAIL || !s.fileKey)
      throw new BadRequestException('Pas de fichier pour cette signature');
    if (s.status === SignatureStatus.PENDING_REVIEW) {
      throw new ForbiddenException(
        'Ce cachet contient un terme officiel : il est en attente de validation manuelle',
      );
    }
    if (s.status === SignatureStatus.REJECTED)
      throw new ForbiddenException('Ce cachet a été refusé par la modération');
    const name = s.kind === SignatureKind.STAMP ? 'cachet' : 'paraphe';
    return {
      url: await this.storage.signedUrl(`${s.fileKey}.${format}`, {
        downloadName: `${name}.${format}`,
      }),
      expiresInSeconds: 900,
      notice: IMAGE_SIGNATURE_NOTICE,
    };
  }

  /** Propositions de paraphe à partir du nom : aperçus gratuits, rien n'est enregistré (SIG-20). */
  handwritingProposals(fullName: string, ink: 'blue' | 'violet' | 'red' | 'black' = 'blue') {
    return handwritingProposals(fullName).map((spec) => ({
      spec,
      svg: renderHandwriting(spec, ink).svg,
    }));
  }

  // ─── Signatures en lot (SIG-16) ───

  async batch(ctx: Ctx, dto: BatchSignaturesDto) {
    if (!(await this.credits.hasPaidAccess(ctx.workspaceId))) {
      throw new HttpException(
        'Les signatures en lot sont réservées aux offres payantes',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    const { header, rows } = parseCsv(dto.csv);
    if (!header.includes('nom')) throw new BadRequestException('Colonne « nom » manquante');
    if (rows.length > MAX_BATCH_ROWS)
      throw new BadRequestException(`${MAX_BATCH_ROWS} lignes maximum`);

    const created: { line: number; id: string; fullName: string }[] = [];
    const errors: { line: number; message: string }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        const data = {
          ...(dto.common ?? {}),
          fullName: row.nom,
          jobTitle: row.fonction || null,
          email: row.email || null,
          phones: [row.telephone, row.telephone2].filter(Boolean),
        };
        const result = await this.createEmail(ctx, {
          data,
          templateId: dto.templateId,
          logoId: dto.logoId,
        });
        created.push({ line: i + 2, id: result.id, fullName: row.nom });
      } catch (err) {
        const message =
          err instanceof HttpException ? JSON.stringify(err.getResponse()) : String(err);
        errors.push({ line: i + 2, message });
      }
    }
    return { created, errors };
  }

  // ─── Essai sans compte (§13.6) ───

  async publicEmail(ip: string, dto: PublicEmailSignatureDto) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `public-try:email-signature:${day}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 86_400);
    if (count > PUBLIC_TRIES_PER_DAY) {
      throw new HttpException(
        'Limite d’essais gratuits atteinte pour aujourd’hui, créez un compte pour continuer',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const data = parse(emailDataSchema, dto.data);
    const primary = dto.color ?? DEFAULT_BRAND.primary;
    const brand: EmailBrand = {
      primary,
      text: DEFAULT_BRAND.text,
      fontFamily: 'Arial, Helvetica, sans-serif',
    };
    const template: EmailTemplateContent = { layout: dto.layout ?? 'logo-left', divider: true };
    const platform = this.platform();
    return {
      html: renderEmailSignatureHtml(data, brand, template, platform),
      text: renderEmailSignatureText(data, platform),
      installGuide: INSTALL_GUIDE,
      triesLeft: Math.max(0, PUBLIC_TRIES_PER_DAY - count),
    };
  }

  // ─── Modération (ADM-12) ───

  async pendingReview() {
    const rows = await this.prisma.signature.findMany({
      where: { status: SignatureStatus.PENDING_REVIEW },
      orderBy: { createdAt: 'asc' },
      include: { project: { select: { id: true, title: true, workspaceId: true } } },
      take: 100,
    });
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        kind: r.kind,
        data: r.data,
        attestedAt: r.attestedAt,
        createdAt: r.createdAt,
        project: r.project,
        flagged: r.kind === SignatureKind.STAMP ? await this.flaggedTerms(r.data) : [],
        previewUrl: r.fileKey ? await this.storage.signedUrl(`${r.fileKey}.png`) : null,
      })),
    );
  }

  async review(
    actorId: string,
    signatureId: string,
    decision: 'APPROVE' | 'REJECT',
    note: string | undefined,
    ip: string,
  ) {
    const s = await this.prisma.signature.findUniqueOrThrow({ where: { id: signatureId } });
    if (s.status !== SignatureStatus.PENDING_REVIEW)
      throw new BadRequestException('Cette signature n’est pas en attente');
    const status = decision === 'APPROVE' ? SignatureStatus.ACTIVE : SignatureStatus.REJECTED;
    const updated = await this.prisma.signature.update({ where: { id: s.id }, data: { status } });
    await this.audit.log({
      actorId,
      action: `signature.review.${decision.toLowerCase()}`,
      entityType: 'Signature',
      entityId: s.id,
      before: { status: s.status },
      after: { status, note },
      ip,
    });
    return this.present(updated);
  }

  private async flaggedTerms(raw: unknown) {
    const parsed = stampDataSchema.safeParse(raw);
    if (!parsed.success) return [];
    return [
      ...new Set(
        (
          await Promise.all(
            stampTexts(parsed.data).map((t) => this.moderation.findBlocked(t, 'STAMP')),
          )
        ).flat(),
      ),
    ];
  }

  // ─── Présentation ───

  private present(s: Prisma.SignatureGetPayload<object>, flagged: string[] = []) {
    const { fileKey: _f, ...rest } = s;
    const image = s.kind !== SignatureKind.EMAIL;
    return {
      ...rest,
      ...(image && { notice: IMAGE_SIGNATURE_NOTICE }),
      ...(s.status === SignatureStatus.PENDING_REVIEW && {
        review: {
          message:
            'Termes officiels détectés : le cachet sera disponible après validation manuelle.',
          terms: flagged,
        },
      }),
    };
  }
}

function parse<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new BadRequestException({
        message: 'Données de signature invalides',
        errors: err.issues.map((i) => `${i.path.join('.')} : ${i.message}`),
      });
    }
    throw err;
  }
}
