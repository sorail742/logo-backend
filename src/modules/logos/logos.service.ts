import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JobKind, LogoEngine, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { extractPalette, normalizeHex } from '../../render/color';
import { EXPORT_FORMATS, PNG_SIZES, renderVariants } from '../../render/logo-assets';
import { DEFAULT_SPEC, type LogoSpec } from '../../render/logo-spec';
import { perceptualHash, pngSize, svgToPixels } from '../../render/raster';
import { sanitizeSvg, svgSize } from '../../render/svg';
import type { LogoGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { workspacePlan } from '../billing/plan-features';
import { JobsService } from '../jobs/jobs.service';
import { ModerationService } from '../moderation/moderation.service';
import type { LogoExportInput } from './logo-export.service';
import { CURRENT_VERSION, logoSource, parseSpec, specToSvg, toLogoDto } from './logo-source';
import {
  ExportLogoDto,
  GenerateLogosDto,
  ImportLogoDto,
  ListLogosDto,
  SaveVersionDto,
  UpdateLogoDto,
} from './logos.dto';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

const MAX_PNG_BYTES = 2_000_000;
const VERSION_FIELDS = {
  id: true,
  number: true,
  label: true,
  spec: true,
  createdAt: true,
} as const;

@Injectable()
export class LogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly moderation: ModerationService,
  ) {}

  /** Lance un lot de 8 propositions (LOGO-01 à 06) : 202 + jobId. */
  async generate(ctx: Ctx, dto: GenerateLogosDto, idempotencyKey: string | undefined) {
    if (dto.engine === 'IMAGE_VECTORIZE') {
      // Moteur B (§5.1, « Devrait ») : dépend du choix d'un fournisseur d'images (§15.4).
      throw new NotImplementedException(
        'Le moteur image + vectorisation n’est pas encore disponible',
      );
    }
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      include: { brief: true, chosenName: true },
    });

    let reference: LogoSpec | undefined;
    if (dto.referenceLogoId) {
      const version = await this.prisma.logoVersion.findFirst({
        where: { logo: { id: dto.referenceLogoId, projectId: ctx.projectId } },
        orderBy: { number: 'desc' },
      });
      if (!version) throw new BadRequestException('Logo de référence introuvable dans ce projet');
      reference = parseSpec(version.spec);
    }

    // LOGO-04 : le nom et le sigle retenus ; le slogan choisi en signature s'il existe.
    const slogan = await this.prisma.slogan.findFirst({
      where: { projectId: ctx.projectId, isChosen: true },
      select: { text: true },
    });
    const name = project.chosenName;
    const input: LogoGenerationInput = {
      entityType: project.entityType,
      text: (name?.value ?? project.title).slice(0, 40),
      tagline: (slogan?.text ?? '').slice(0, 60),
      type: dto.type,
      style: dto.style,
      palette: dto.palette?.map(normalizeHex),
      brief: project.brief && {
        sector: project.brief.sector,
        mission: project.brief.mission,
        values: project.brief.values,
        mustInclude: project.brief.mustInclude,
      },
      count: 8,
      feedback: dto.feedback,
      reference,
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

  /** Import d'un logo existant (LOGO-07) : SVG nettoyé ou PNG encapsulé, palette extraite. */
  async importLogo(projectId: string, dto: ImportLogoDto) {
    if (!dto.svg === !dto.pngDataUrl) {
      throw new BadRequestException('Fournissez soit un SVG, soit une image PNG');
    }
    let svg: string;
    if (dto.svg) {
      const clean = sanitizeSvg(dto.svg);
      if (!clean) throw new UnprocessableEntityException('SVG invalide ou non pris en charge');
      svg = clean;
    } else {
      const base64 = dto.pngDataUrl!.slice('data:image/png;base64,'.length);
      const png = Buffer.from(base64, 'base64');
      const size = pngSize(png);
      if (!size || png.length > MAX_PNG_BYTES) {
        throw new UnprocessableEntityException('Image PNG invalide ou trop lourde (2 Mo au plus)');
      }
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size.width} ${size.height}" width="${size.width}" height="${size.height}"><image width="${size.width}" height="${size.height}" href="data:image/png;base64,${png.toString('base64')}"/></svg>`;
    }
    const { width, height } = svgSize(svg);
    if (!(width > 0 && height > 0))
      throw new UnprocessableEntityException('Dimensions du logo illisibles');

    let palette = dto.palette?.map(normalizeHex) ?? [];
    if (palette.length < 2) {
      const pixels = svgToPixels(svg, { size: 256 });
      palette = [...palette, ...extractPalette(pixels.data, 4)].slice(0, 4);
    }
    const [primary = '#111827', secondary = '#6b7280', text = '#111827'] = palette;

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { chosenName: { select: { value: true } } },
    });
    // La spec permet de retravailler le logo dans l'éditeur ; le SVG importé reste la version 1.
    const spec: LogoSpec = {
      ...DEFAULT_SPEC,
      text: (project.chosenName?.value ?? project.title).slice(0, 40),
      colors: { primary, secondary, text, background: '#ffffff' },
    };

    const logo = await this.prisma.logo.create({
      data: {
        projectId,
        type: 'ICON_TEXT',
        engine: LogoEngine.UPLOAD,
        style: 'MODERN',
        isFavorite: true,
        phash: perceptualHash(svg),
        versions: {
          create: {
            number: 1,
            label: 'Logo importé',
            spec: spec as unknown as Prisma.InputJsonValue,
            svg,
          },
        },
      },
      include: CURRENT_VERSION,
    });
    return { ...toLogoDto(logo), palette };
  }

  async list(projectId: string, dto: ListLogosDto) {
    const logos = await this.prisma.logo.findMany({
      where: { projectId, ...(dto.favorites && { isFavorite: true }) },
      include: CURRENT_VERSION,
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return logos.map((logo) => toLogoDto(logo));
  }

  /** Détail : version courante avec son SVG. */
  async get(logoId: string) {
    const logo = await this.prisma.logo.findUniqueOrThrow({
      where: { id: logoId },
      include: {
        versions: {
          orderBy: { number: 'desc' },
          take: 1,
          select: { ...VERSION_FIELDS, svg: true },
        },
      },
    });
    return toLogoDto(logo, true);
  }

  async update(logoId: string, dto: UpdateLogoDto) {
    const logo = await this.prisma.logo.update({
      where: { id: logoId },
      data: dto,
      include: CURRENT_VERSION,
    });
    return toLogoDto(logo);
  }

  versions(logoId: string) {
    return this.prisma.logoVersion.findMany({
      where: { logoId },
      select: VERSION_FIELDS,
      orderBy: { number: 'desc' },
    });
  }

  /** Enregistre une édition (LOGO-10 à 13) : spec validée, SVG recomposé côté serveur. */
  async saveVersion(logoId: string, dto: SaveVersionDto) {
    const spec = parseSpec(dto.spec);
    const blocked = await this.moderation.findBlocked(`${spec.text} ${spec.tagline}`, 'NAME');
    if (blocked.length) {
      throw new UnprocessableEntityException({
        message: 'Ce texte contient un terme non autorisé',
        terms: blocked,
      });
    }
    const svg = specToSvg(spec);
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.logoVersion.aggregate({ where: { logoId }, _max: { number: true } });
      return tx.logoVersion.create({
        data: {
          logoId,
          number: (last._max.number ?? 0) + 1,
          label: dto.label ?? null,
          spec: spec as unknown as Prisma.InputJsonValue,
          svg,
        },
        select: VERSION_FIELDS,
      });
    });
  }

  /** Variantes automatiques (LOGO-20) : couleur, noir, blanc, icône seule, horizontale, verticale. */
  async variants(logoId: string, versionId?: string) {
    const { logo, version } = await this.version(logoId, versionId);
    return { versionId: version.id, variants: renderVariants(logoSource(logo, version)) };
  }

  /**
   * Demande d'export (LOGO-21 à 24), produit par le worker. L'offre gratuite est réduite à un
   * PNG 512 px filigrané ; la réponse le signale par `restricted`.
   */
  async requestExport(ctx: Ctx, logoId: string, dto: ExportLogoDto, idempotencyKey: string) {
    const { version } = await this.version(logoId, dto.versionId);
    const plan = await workspacePlan(this.prisma, ctx.workspaceId);
    const requested = {
      formats: dto.formats ?? [...EXPORT_FORMATS],
      sizes: [...new Set(dto.sizes ?? [...PNG_SIZES])].sort((a, b) => a - b),
      iconPack: dto.iconPack ?? true,
      social: dto.social ?? true,
    };
    const input: LogoExportInput = plan.features.watermark
      ? {
          logoId,
          versionId: version.id,
          formats: ['png'],
          sizes: [Math.min(plan.features.maxPngSize ?? 512, 512)],
          iconPack: false,
          social: false,
          watermark: 'APERÇU',
          restricted: true,
        }
      : { logoId, versionId: version.id, ...requested, watermark: null, restricted: false };

    const job = await this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.LOGO_EXPORT,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.LOGO_EXPORT,
      idempotencyKey,
      actorId: ctx.actorId,
    });
    return { ...job, restricted: input.restricted };
  }

  private async version(logoId: string, versionId?: string) {
    const logo = await this.prisma.logo.findUniqueOrThrow({
      where: { id: logoId },
      select: { engine: true },
    });
    const version = await this.prisma.logoVersion.findFirst({
      where: { logoId, ...(versionId && { id: versionId }) },
      orderBy: { number: 'desc' },
    });
    if (!version) throw new NotFoundException('Version introuvable');
    return { logo, version };
  }
}
