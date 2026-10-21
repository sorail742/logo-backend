import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JobKind, LedgerReason, Prisma, SignatureKind, SignatureStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  renderEmailSignature,
  renderEmailSignatureText,
  type EmailSignatureData,
} from '../../render/email-signature';
import { svgToPng } from '../../render/raster';
import { INK_COLORS, renderHandwrittenSvg, renderStampSvg } from '../../render/stamp';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { AuditService } from '../audit/audit.service';
import { workspacePlan } from '../billing/plan-features';
import { CreditsService } from '../credits/credits.service';
import { JobsService } from '../jobs/jobs.service';
import { ModerationService } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { SignatureBatchInput } from './signature-batch.service';
import { POWERED_BY, SignatureBrandService } from './signature-brand.service';
import {
  emailTemplateKey,
  parseMembersCsv,
  parsePublicBrand,
  parseSignatureData,
  stampReviewTerms,
  stampTerms,
  type SignatureData,
} from './signature-data';
import { SIGNATURE_INCLUDE, toSignatureDto } from './signature.presenter';
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

/** Durée de validité des URL d'un paraphe ou d'un cachet (§6.4 : courte durée). */
const FILE_URL_TTL_S = 300;
/** Côté du PNG transparent haute définition (SIG-24). */
const PNG_SIZE = 2048;
const MAX_BATCH_ROWS = 500;

const ATTESTATION_REQUIRED = {
  message: 'Vous devez certifier être habilité à représenter la structure',
  code: 'ATTESTATION_REQUIRED',
};

@Injectable()
export class SignaturesService {
  private readonly logger = new Logger(SignaturesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly credits: CreditsService,
    private readonly moderation: ModerationService,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly brands: SignatureBrandService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(projectId: string) {
    const rows = await this.prisma.signature.findMany({
      where: { projectId },
      include: SIGNATURE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSignatureDto);
  }

  async get(signatureId: string) {
    return toSignatureDto(
      await this.prisma.signature.findUniqueOrThrow({
        where: { id: signatureId },
        include: SIGNATURE_INCLUDE,
      }),
    );
  }

  /**
   * Création (SIG-10 à 24) : un paraphe ou un cachet exige l'attestation et coûte un crédit ;
   * un cachet portant des termes officiels attend une validation manuelle (§6.4).
   */
  async create(ctx: Ctx, dto: CreateSignatureDto) {
    const parsed = parseSignatureData(dto.kind, dto.data);
    if (dto.kind !== SignatureKind.EMAIL && !dto.attested) {
      throw new BadRequestException(ATTESTATION_REQUIRED);
    }
    const id = randomUUID();
    const templateId = await this.templateId(parsed, dto.templateId);
    const review = await this.review(parsed);
    const content = await this.content(ctx.projectId, id, parsed, dto.templateId);

    try {
      const signature = await this.prisma.$transaction(async (tx) => {
        if (dto.kind !== SignatureKind.EMAIL) {
          await this.credits.debit(tx, {
            workspaceId: ctx.workspaceId,
            amount: CREDIT_COSTS.HANDWRITTEN_OR_STAMP,
            reason: LedgerReason.GENERATION,
            actorId: ctx.actorId,
            note: dto.kind === SignatureKind.STAMP ? 'Cachet' : 'Paraphe',
          });
        }
        return tx.signature.create({
          data: {
            id,
            projectId: ctx.projectId,
            kind: dto.kind,
            status: review.status,
            templateId,
            data: parsed.data as Prisma.InputJsonValue,
            html: content.html,
            fileKey: content.fileKey,
            isPrivate: dto.kind !== SignatureKind.EMAIL,
            attestedAt: dto.attested ? new Date() : null,
          },
          include: SIGNATURE_INCLUDE,
        });
      });
      await this.flagForReview(ctx, signature.id, review.terms);
      if (dto.kind !== SignatureKind.EMAIL) {
        const { creditBalance } = await this.credits.balance(ctx.workspaceId);
        await this.notifications.creditsDebited(
          ctx.workspaceId,
          creditBalance + CREDIT_COSTS.HANDWRITTEN_OR_STAMP,
          creditBalance,
        );
      }
      return toSignatureDto(signature);
    } catch (err) {
      await this.removeFiles(content.fileKey);
      throw err;
    }
  }

  /** Modification : le type ne change pas ; un cachet modifié repasse par le contrôle. */
  async update(ctx: Ctx, signatureId: string, dto: UpdateSignatureDto) {
    const current = await this.prisma.signature.findUniqueOrThrow({
      where: { id: signatureId },
      include: SIGNATURE_INCLUDE,
    });
    if (current.kind !== SignatureKind.EMAIL && !dto.attested) {
      throw new BadRequestException(ATTESTATION_REQUIRED);
    }
    const parsed = parseSignatureData(current.kind, dto.data ?? current.data);
    const templateKey = dto.templateId ?? current.template?.key ?? undefined;
    const templateId = await this.templateId(parsed, templateKey);
    const review = await this.review(parsed);
    const content = await this.content(current.projectId, current.id, parsed, templateKey);

    try {
      const signature = await this.prisma.signature.update({
        where: { id: signatureId },
        data: {
          status: review.status,
          templateId,
          data: parsed.data as Prisma.InputJsonValue,
          html: content.html,
          fileKey: content.fileKey,
          ...(dto.attested && { attestedAt: new Date() }),
        },
        include: SIGNATURE_INCLUDE,
      });
      await this.removeFiles(current.fileKey);
      if (current.status !== SignatureStatus.PENDING_REVIEW) {
        await this.flagForReview(ctx, signature.id, review.terms);
      }
      return toSignatureDto(signature);
    } catch (err) {
      await this.removeFiles(content.fileKey);
      throw err;
    }
  }

  /** HTML et texte brut de la signature e-mail (SIG-13, SIG-15), à la marque du moment. */
  async html(signatureId: string) {
    const signature = await this.prisma.signature.findUniqueOrThrow({
      where: { id: signatureId },
      include: SIGNATURE_INCLUDE,
    });
    if (signature.kind !== SignatureKind.EMAIL) {
      throw new BadRequestException('Seule une signature e-mail a une version HTML');
    }
    const parsed = parseSignatureData(SignatureKind.EMAIL, signature.data);
    const data = parsed.data as EmailSignatureData;
    const brand = await this.brands.brand(signature.projectId, signature.id);
    return {
      html: renderEmailSignature(emailTemplateKey(signature.template?.key), data, brand),
      text: renderEmailSignatureText(data, brand),
    };
  }

  /** URL signée de courte durée du paraphe ou du cachet (PNG transparent et SVG, SIG-24). */
  async fileUrl(signatureId: string) {
    const signature = await this.prisma.signature.findUniqueOrThrow({
      where: { id: signatureId },
      include: { project: { select: { title: true, chosenName: { select: { value: true } } } } },
    });
    if (signature.kind === SignatureKind.EMAIL || !signature.fileKey) {
      throw new BadRequestException('Cette signature n’a pas de fichier');
    }
    if (signature.status === SignatureStatus.PENDING_REVIEW) {
      throw new ConflictException({
        message: 'Ce cachet est en cours de validation par notre équipe',
        code: 'SIGNATURE_PENDING_REVIEW',
      });
    }
    if (signature.status === SignatureStatus.REJECTED) {
      throw new ForbiddenException({
        message: 'Ce cachet a été refusé : modifiez-le pour le soumettre à nouveau',
        code: 'SIGNATURE_REJECTED',
      });
    }
    const base = signature.kind === SignatureKind.STAMP ? 'cachet' : 'paraphe';
    const expiresIn = FILE_URL_TTL_S;
    const [url, svgUrl] = await Promise.all([
      this.storage.signedUrl(pngKey(signature.fileKey), { expiresIn, fileName: `${base}.png` }),
      this.storage.signedUrl(signature.fileKey, { expiresIn, fileName: `${base}.svg` }),
    ]);
    return { url, svgUrl, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  /**
   * Signatures e-mail de tous les membres (SIG-16) à partir de la signature du projet : le CSV
   * remplace nom, fonction, e-mail et téléphone. Archive produite par le worker.
   */
  async batch(ctx: Ctx, dto: BatchSignaturesDto, idempotencyKey: string) {
    const plan = await workspacePlan(this.prisma, ctx.workspaceId);
    if (!plan.features.batchSignatures) {
      throw new ForbiddenException({
        message: 'Les signatures en lot sont réservées aux offres Pro et Agence',
        code: 'PLAN_REQUIRED',
      });
    }
    const base = await this.prisma.signature.findFirst({
      where: { projectId: ctx.projectId, kind: SignatureKind.EMAIL },
      include: SIGNATURE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (!base) {
      throw new BadRequestException('Enregistrez d’abord la signature e-mail du projet');
    }
    const members = parseMembersCsv(dto.csv);
    if (members.length === 0) {
      throw new BadRequestException('Aucune ligne exploitable : une colonne « nom » est attendue');
    }
    if (members.length > MAX_BATCH_ROWS) {
      throw new BadRequestException(`${MAX_BATCH_ROWS} membres au plus par import`);
    }
    const input: SignatureBatchInput = {
      signatureId: base.id,
      templateId: emailTemplateKey(dto.templateId ?? base.template?.key),
      members,
    };
    const job = await this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.SIGNATURE,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.EMAIL_SIGNATURE,
      idempotencyKey,
      actorId: ctx.actorId,
    });
    return { count: members.length, jobId: job.jobId };
  }

  /** Signature e-mail sans compte (§13.6) : rendu immédiat, rien n'est enregistré. */
  publicEmail(dto: PublicEmailSignatureDto) {
    const parsed = parseSignatureData(SignatureKind.EMAIL, dto.data);
    const data = parsed.data as EmailSignatureData;
    const brand = { ...parsePublicBrand(dto.brand), poweredBy: POWERED_BY };
    return {
      html: renderEmailSignature(emailTemplateKey(dto.templateId), data, brand),
      text: renderEmailSignatureText(data, brand),
    };
  }

  /** PNG du logo de la signature e-mail, servi publiquement (images en HTTPS absolu, SIG-13). */
  async logoPng(signatureId: string) {
    const signature = await this.prisma.signature.findUnique({
      where: { id: signatureId },
      select: { kind: true, projectId: true, project: { select: { deletedAt: true } } },
    });
    if (!signature || signature.kind !== SignatureKind.EMAIL || signature.project.deletedAt) {
      throw new NotFoundException('Logo introuvable');
    }
    const logo = await this.brands.logo(signature.projectId);
    if (!logo) throw new NotFoundException('Logo introuvable');
    return svgToPng(this.brands.logoSvg(logo.source), { size: 240 });
  }

  // ─── Rendu et contrôles ───

  /** Modèle en base : gabarit e-mail choisi, forme du cachet ; aucun pour un paraphe. */
  private async templateId(parsed: SignatureData, key: string | undefined) {
    const templateKey =
      parsed.kind === 'EMAIL'
        ? emailTemplateKey(key)
        : parsed.kind === 'STAMP'
          ? parsed.data.shape
          : null;
    if (!templateKey) return null;
    const template = await this.prisma.template.findUnique({
      where: { key: templateKey },
      select: { id: true },
    });
    return template?.id ?? null;
  }

  /** §6.4 : termes officiels ou interdits sur un cachet → validation manuelle. */
  private async review(parsed: SignatureData) {
    if (parsed.kind !== 'STAMP') return { status: SignatureStatus.ACTIVE, terms: [] as string[] };
    const blocked = await this.moderation.findBlocked(stampTerms(parsed.data).join(' '), 'STAMP');
    const found = stampReviewTerms(parsed.data, blocked);
    return {
      status: found.length ? SignatureStatus.PENDING_REVIEW : SignatureStatus.ACTIVE,
      terms: found,
    };
  }

  /** HTML d'une signature e-mail, ou SVG + PNG privés d'un paraphe ou d'un cachet. */
  private async content(
    projectId: string,
    signatureId: string,
    parsed: SignatureData,
    templateKey: string | undefined,
  ): Promise<{ html: string | null; fileKey: string | null }> {
    if (parsed.kind === 'EMAIL') {
      const brand = await this.brands.brand(projectId, signatureId);
      return {
        html: renderEmailSignature(emailTemplateKey(templateKey), parsed.data, brand),
        fileKey: null,
      };
    }
    let svg: string;
    if (parsed.kind === 'STAMP') {
      const logoSvg =
        parsed.data.centerMode === 'logo'
          ? await this.brands.stampMark(projectId, INK_COLORS[parsed.data.ink])
          : null;
      svg = renderStampSvg(parsed.data, { logoSvg });
    } else {
      svg = renderHandwrittenSvg(parsed.data);
    }
    const png = svgToPng(svg, { size: PNG_SIZE });
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { workspaceId: true },
    });
    // Nom de fichier tiré au hasard : aucun paramètre de la requête n'entre dans le chemin.
    const fileKey = `signatures/${project.workspaceId}/${randomUUID()}.svg`;
    await this.storage.put(fileKey, Buffer.from(svg), 'image/svg+xml');
    await this.storage.put(pngKey(fileKey), png, 'image/png');
    return { html: null, fileKey };
  }

  private async removeFiles(fileKey: string | null) {
    if (!fileKey) return;
    await Promise.all([this.storage.delete(fileKey), this.storage.delete(pngKey(fileKey))]).catch(
      (err: Error) => this.logger.warn(`Fichiers de signature non supprimés : ${err.message}`),
    );
  }

  /** Cachet soumis à validation : trace dans le journal pour la file de modération. */
  private async flagForReview(ctx: Ctx, signatureId: string, terms: string[]) {
    if (!terms.length) return;
    await this.audit.log({
      actorId: ctx.actorId,
      action: 'signature.pending_review',
      entityType: 'Signature',
      entityId: signatureId,
      after: { terms },
    });
  }
}

export function pngKey(fileKey: string) {
  return fileKey.replace(/\.svg$/, '.png');
}
