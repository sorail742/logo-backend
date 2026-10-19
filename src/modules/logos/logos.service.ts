import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotImplementedException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { JobKind, LogoEngine, LogoType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { composeLogo } from '../../render/compose';
import { perceptualHash } from '../../render/export';
import {
  MAX_UPLOAD_BYTES,
  pngPalette,
  sanitizeSvg,
  sniffImage,
  svgPalette,
} from '../../render/sanitize';
import { renderMockups, renderVariant, VARIANTS } from '../../render/variants';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { LogoGenerationInput, LogoSpec, logoSpecSchema } from '../../shared/logo-spec';
import { CreditsService } from '../credits/credits.service';
import { JobsService } from '../jobs/jobs.service';
import { StorageService } from '../storage/storage.service';
import { LogoExportInput } from './logo-export.service';
import { assertLibraryAssets } from './logo-generator.service';
import { ExportLogoDto, GenerateLogosDto, ImportLogoDto, SaveVersionDto } from './logos.dto';

interface Ctx {
  projectId?: string;
  workspaceId: string;
  actorId: string;
}

const LATEST_VERSION = { orderBy: { number: 'desc' as const }, take: 1 };

@Injectable()
export class LogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly credits: CreditsService,
  ) {}

  // ─── Génération (LOGO-01 à LOGO-06) ───

  async generate(ctx: Ctx & { projectId: string }, dto: GenerateLogosDto, idempotencyKey?: string) {
    if (dto.engine === 'IMAGE_VECTORIZE') {
      throw new NotImplementedException(
        'Moteur B (image IA + vectorisation) pas encore disponible',
      );
    }
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      include: { chosenName: true, brief: true },
    });
    if (!project.chosenName) {
      throw new BadRequestException(
        'Retenez d’abord un nom (ou saisissez celui que vous avez déjà)',
      );
    }

    let reference: LogoSpec | null = null;
    if (dto.fromLogoId) {
      const ref = await this.prisma.logo.findFirst({
        where: { id: dto.fromLogoId, projectId: ctx.projectId },
        include: { versions: LATEST_VERSION },
      });
      const parsed = logoSpecSchema.safeParse(ref?.versions[0]?.spec);
      if (!parsed.success)
        throw new BadRequestException('Logo de référence introuvable ou importé');
      reference = parsed.data;
    }

    const previous = await this.prisma.logoVersion.findMany({
      where: { logo: { projectId: ctx.projectId }, number: 1 },
      select: { spec: true },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
    const avoidIcons = previous
      .map((v) => (v.spec as { icon?: { id?: string } } | null)?.icon?.id)
      .filter((id): id is string => !!id);

    const input: LogoGenerationInput = {
      text: project.chosenName.value,
      acronym: project.chosenName.acronym,
      tagline: dto.tagline ?? null,
      entityType: project.entityType,
      brief: {
        sector: project.brief?.sector ?? '',
        mission: project.brief?.mission ?? '',
        values: project.brief?.values ?? [],
        tone: project.brief?.tone,
      },
      types: dto.types,
      style: dto.style,
      palette: dto.palette ?? null,
      count: 8,
      feedback: dto.feedback ?? null,
      reference,
      avoidIcons,
    };

    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.LOGOS,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.LOGOS_BATCH_SVG,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }

  // ─── Import d'un logo existant (LOGO-07, parcours « j'ai déjà un logo ») ───

  async importLogo(ctx: Ctx & { projectId: string }, dto: ImportLogoDto) {
    const buf = Buffer.from(dto.fileBase64, 'base64');
    if (buf.length === 0) throw new BadRequestException('Fichier vide');
    if (buf.length > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('5 Mo maximum');

    const kind = sniffImage(buf);
    if (!kind) throw new BadRequestException('Seuls les fichiers SVG et PNG sont acceptés');

    let svg: string;
    let palette: string[];
    if (kind === 'svg') {
      try {
        svg = sanitizeSvg(buf.toString('utf8'));
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
      palette = svgPalette(svg);
    } else {
      palette = await pngPalette(buf);
      const meta = await import('sharp').then((m) => m.default(buf).metadata());
      const [w, h] = [meta.width ?? 512, meta.height ?? 512];
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><image width="${w}" height="${h}" href="data:image/png;base64,${buf.toString('base64')}"/></svg>`;
    }

    const fileKey = `uploads/${ctx.workspaceId}/${randomUUID()}.${kind}`;
    await this.storage.put(fileKey, buf, kind === 'svg' ? 'image/svg+xml' : 'image/png');

    return this.prisma.logo.create({
      data: {
        projectId: ctx.projectId,
        type: LogoType.ICON_TEXT,
        engine: LogoEngine.UPLOAD,
        style: 'IMPORTED',
        versions: {
          create: {
            number: 1,
            label: 'Logo importé',
            spec: {
              imported: true,
              format: kind,
              fileKey,
              fileName: dto.fileName ?? null,
              palette,
            },
            svg,
          },
        },
      },
      include: { versions: true },
    });
  }

  // ─── Consultation ───

  list(projectId: string, favorites?: boolean) {
    return this.prisma.logo.findMany({
      where: { projectId, ...(favorites && { isFavorite: true }) },
      include: { versions: LATEST_VERSION, _count: { select: { versions: true } } },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  get(logoId: string) {
    return this.prisma.logo.findUniqueOrThrow({
      where: { id: logoId },
      include: { versions: LATEST_VERSION, _count: { select: { versions: true } } },
    });
  }

  update(logoId: string, isFavorite?: boolean) {
    return this.prisma.logo.update({ where: { id: logoId }, data: { isFavorite } });
  }

  versions(logoId: string) {
    return this.prisma.logoVersion.findMany({
      where: { logoId },
      orderBy: { number: 'desc' },
      select: { id: true, number: true, label: true, spec: true, createdAt: true },
    });
  }

  // ─── Éditeur : versions nommées (LOGO-10 à LOGO-13) ───

  /** Enregistre une édition : la spécification est validée puis rendue côté serveur. */
  async saveVersion(logoId: string, dto: SaveVersionDto) {
    const logo = await this.prisma.logo.findUniqueOrThrow({ where: { id: logoId } });
    if (logo.engine === LogoEngine.UPLOAD) {
      throw new BadRequestException('Un logo importé ne se modifie pas dans l’éditeur');
    }
    const spec = this.parseSpec(dto.spec);
    const { svg } = composeLogo(spec);

    // Numérotation sûre en cas d'enregistrements simultanés : nouvelle tentative sur conflit.
    for (let attempt = 0; attempt < 3; attempt++) {
      const last = await this.prisma.logoVersion.findFirst({
        where: { logoId },
        orderBy: { number: 'desc' },
      });
      try {
        const version = await this.prisma.logoVersion.create({
          data: {
            logoId,
            number: (last?.number ?? 0) + 1,
            label: dto.label,
            spec: spec as Prisma.InputJsonValue,
            svg,
          },
        });
        await this.prisma.logo.update({
          where: { id: logoId },
          data: { type: spec.type, phash: perceptualHash(svg) },
        });
        return version;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
      }
    }
    throw new HttpException('Enregistrement concurrent, réessayez', HttpStatus.CONFLICT);
  }

  // ─── Variantes et mises en situation (LOGO-05, LOGO-20) ───

  async variants(logoId: string, versionId?: string) {
    const spec = await this.editableSpec(logoId, versionId);
    const variants = Object.fromEntries(VARIANTS.map((v) => [v, renderVariant(spec, v).svg]));
    return { variants, mockups: renderMockups(spec) };
  }

  // ─── Exports (LOGO-21 à LOGO-24) ───

  async export(ctx: Ctx, logoId: string, dto: ExportLogoDto, idempotencyKey?: string) {
    const logo = await this.prisma.logo.findUniqueOrThrow({ where: { id: logoId } });
    const version = await this.resolveVersion(logoId, dto.versionId);
    if (logo.engine === LogoEngine.UPLOAD) {
      throw new BadRequestException('Export des logos importés pas encore disponible');
    }

    const paid = await this.credits.hasPaidAccess(ctx.workspaceId);
    const wantsMore = dto.formats.some((f) => f !== 'png') || dto.appIcons;
    if (!paid && wantsMore) {
      throw new HttpException(
        'Offre gratuite : export PNG 512 px avec filigrane uniquement. Passez à une offre payante pour le SVG, le PDF et le pack d’icônes.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const input: LogoExportInput = {
      type: 'LOGO_EXPORT',
      logoVersionId: version.id,
      workspaceId: ctx.workspaceId,
      formats: dto.formats,
      pngSizes: dto.pngSizes ?? [512, 1024, 2048],
      variants: dto.variants ?? ['color'],
      appIcons: dto.appIcons ?? false,
    };
    const job = await this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: logo.projectId,
      kind: JobKind.EXPORT_ZIP,
      input: input as unknown as Prisma.InputJsonValue,
      cost: 0,
      idempotencyKey,
      actorId: ctx.actorId,
    });
    return { ...job, watermarked: !paid };
  }

  // ─── Utilitaires ───

  private parseSpec(raw: unknown): LogoSpec {
    try {
      const spec = logoSpecSchema.parse(raw);
      assertLibraryAssets(spec);
      return spec;
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          message: 'Spécification de logo invalide',
          errors: err.issues.map((i) => `${i.path.join('.')} : ${i.message}`),
        });
      }
      throw new BadRequestException((err as Error).message);
    }
  }

  private async resolveVersion(logoId: string, versionId?: string) {
    const version = versionId
      ? await this.prisma.logoVersion.findFirst({ where: { id: versionId, logoId } })
      : await this.prisma.logoVersion.findFirst({ where: { logoId }, orderBy: { number: 'desc' } });
    if (!version) throw new BadRequestException('Version introuvable pour ce logo');
    return version;
  }

  private async editableSpec(logoId: string, versionId?: string): Promise<LogoSpec> {
    const version = await this.resolveVersion(logoId, versionId);
    const parsed = logoSpecSchema.safeParse(version.spec);
    if (!parsed.success)
      throw new BadRequestException('Variantes indisponibles pour un logo importé');
    return parsed.data;
  }
}
