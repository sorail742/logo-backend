import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JobKind, JobStatus, Prisma, type BrandKit } from '@prisma/client';
import { argon2id, hash, verify } from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { randomToken } from '../../common/utils/crypto.util';
import { slugify } from '../../common/utils/slug.util';
import { kitFonts, kitPalette, type KitContent } from '../../render/brand-kit';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { workspacePlan } from '../billing/plan-features';
import { JobsService } from '../jobs/jobs.service';
import { logoSource, parseSpec } from '../logos/logo-source';
import { TYPED_NAME_MEANING } from '../projects/projects.service';
import { kitLogo, parseKitContent, toBrandKitDto, type KitFiles } from './brand-kit.presenter';
import type { ShareKitDto } from './brand-kits.dto';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

/** Entrée des tâches BRAND_GUIDE et EXPORT_ZIP, figée au moment de la demande (offre comprise). */
export interface KitJobInput {
  kitId: string;
  /** Archive : filigrane de l'offre gratuite, sans charte ni supports (§7.4). */
  watermark?: string | null;
}

/** Contenu d'une version du kit, à sa création ou à sa restauration. */
type KitVersionData = Pick<
  Prisma.BrandKitUncheckedCreateInput,
  'logoVersionId' | 'sloganId' | 'palette' | 'fonts' | 'content' | 'restoredFrom'
>;

/** Durée de validité des liens de téléchargement servis avec le kit (§14.1). */
const FILE_URL_TTL_S = 15 * 60;
const KIT_WATERMARK = 'APERÇU';

/** Kit de marque (§7.1) : versions figées, charte PDF, archive ZIP, lien de partage. */
@Injectable()
export class BrandKitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly jobs: JobsService,
  ) {}

  async list(projectId: string, canDownload: boolean) {
    const kits = await this.prisma.brandKit.findMany({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    return this.present(kits, canDownload);
  }

  async get(kitId: string, canDownload: boolean) {
    const kit = await this.prisma.brandKit.findUniqueOrThrow({ where: { id: kitId } });
    return (await this.present([kit], canDownload))[0];
  }

  /** Nouvelle version assemblée à partir de l'état actuel du projet (KIT-01, KIT-06). */
  async create(ctx: Ctx) {
    const snapshot = await this.snapshot(ctx.projectId);
    const kit = await this.insert(ctx.projectId, snapshot);
    // Le logo retenu dans un kit payé n'est plus proposé à d'autres (§5.5).
    const plan = await workspacePlan(this.prisma, ctx.workspaceId);
    if (!plan.features.watermark) {
      await this.prisma.logo.updateMany({
        where: { versions: { some: { id: snapshot.logoVersionId } } },
        data: { isExclusive: true },
      });
    }
    return (await this.present([kit], true))[0];
  }

  /** Restaure une version : elle redevient la version courante, sous un nouveau numéro (KIT-06). */
  async restore(kitId: string) {
    const source = await this.prisma.brandKit.findUniqueOrThrow({ where: { id: kitId } });
    const kit = await this.insert(source.projectId, {
      logoVersionId: source.logoVersionId,
      sloganId: source.sloganId,
      palette: source.palette as Prisma.InputJsonValue,
      fonts: source.fonts as Prisma.InputJsonValue,
      content: source.content as Prisma.InputJsonValue,
      restoredFrom: source.version,
    });
    return (await this.present([kit], true))[0];
  }

  /**
   * Changement du nom final (NOM-33) : si le projet a déjà un kit, une nouvelle version porte
   * le nouveau nom ; les précédentes restent consultables.
   */
  async onNameChanged(projectId: string) {
    const count = await this.prisma.brandKit.count({ where: { projectId } });
    if (!count) return null;
    const snapshot = await this.snapshot(projectId).catch(() => null);
    return snapshot ? this.insert(projectId, snapshot) : null;
  }

  /** Lien de partage en lecture seule, mot de passe et expiration facultatifs (KIT-05). */
  async share(kitId: string, dto: ShareKitDto) {
    const kit = await this.prisma.brandKit.findUniqueOrThrow({ where: { id: kitId } });
    let data: Prisma.BrandKitUpdateInput;
    if (dto.enabled) {
      const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('La date d’expiration doit être dans le futur');
      }
      data = {
        shareToken: kit.shareToken ?? randomToken(18),
        sharePasswordHash: dto.password ? await hash(dto.password, { type: argon2id }) : null,
        shareExpiresAt: expiresAt,
      };
    } else {
      data = { shareToken: null, sharePasswordHash: null, shareExpiresAt: null };
    }
    const updated = await this.prisma.brandKit.update({ where: { id: kitId }, data });
    return (await this.present([updated], true))[0];
  }

  /** Page publique du kit (§13.7) : 404 si le lien n'existe plus, 401 sans le bon mot de passe. */
  async publicKit(token: string, password: string | undefined) {
    const kit = await this.prisma.brandKit.findUnique({
      where: { shareToken: token },
      include: {
        project: {
          select: {
            deletedAt: true,
            entityType: true,
            title: true,
            chosenName: { select: { value: true, acronym: true, meaning: true } },
          },
        },
      },
    });
    if (!kit || kit.project.deletedAt || (kit.shareExpiresAt && kit.shareExpiresAt < new Date())) {
      throw new NotFoundException({
        message: 'Ce lien de partage n’existe pas ou a expiré',
        code: 'NOT_FOUND',
      });
    }
    if (kit.sharePasswordHash) {
      if (!password) {
        throw new UnauthorizedException({
          message: 'Mot de passe requis',
          code: 'PASSWORD_REQUIRED',
        });
      }
      if (!(await verify(kit.sharePasswordHash, password).catch(() => false))) {
        throw new UnauthorizedException({
          message: 'Mot de passe incorrect',
          code: 'PASSWORD_INVALID',
        });
      }
    }
    const { project, ...row } = kit;
    const [dto] = await this.present([row], true);
    // Une version figée fait foi, même sans sigle ni origine ; repli sur le projet sinon.
    const content = parseKitContent(kit.content);
    const frozen = content.name !== undefined;
    return {
      ...dto,
      projectName: content.name ?? project.chosenName?.value ?? project.title,
      acronym: frozen ? (content.acronym ?? null) : (project.chosenName?.acronym ?? null),
      meaning: frozen ? (content.meaning ?? null) : (project.chosenName?.meaning ?? null),
      entityType: project.entityType,
    };
  }

  /**
   * Charte graphique PDF (KIT-02), produite par le worker : 3 crédits la première fois pour
   * une version du kit, puis régénérable sans coût (§7.4). Réservée aux offres payantes.
   */
  async requestGuide(ctx: Ctx, kitId: string, idempotencyKey: string | undefined) {
    const plan = await workspacePlan(this.prisma, ctx.workspaceId);
    if (!plan.features.brandGuidePdf) {
      throw new ForbiddenException({
        message: 'La charte graphique PDF est incluse dans le Pack Identité et les offres payantes',
        code: 'PLAN_REQUIRED',
      });
    }
    const running = await this.prisma.generationJob.findFirst({
      where: {
        projectId: ctx.projectId,
        kind: JobKind.BRAND_GUIDE,
        status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] },
        input: { path: ['kitId'], equals: kitId },
      },
      select: { id: true },
    });
    if (running) return { jobId: running.id, costCredits: 0 };

    const paid = (await this.paidGuides(ctx.projectId)).has(kitId);
    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.BRAND_GUIDE,
      input: { kitId } satisfies KitJobInput as unknown as Prisma.InputJsonValue,
      cost: paid ? 0 : CREDIT_COSTS.BRAND_GUIDE_PDF,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }

  /** Archive ZIP rangée (KIT-03), sans coût ; filigranée et réduite en offre gratuite. */
  async requestZip(ctx: Ctx, kitId: string, idempotencyKey: string) {
    const plan = await workspacePlan(this.prisma, ctx.workspaceId);
    const input: KitJobInput = { kitId, watermark: plan.features.watermark ? KIT_WATERMARK : null };
    const job = await this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.EXPORT_ZIP,
      input: input as unknown as Prisma.InputJsonValue,
      cost: 0,
      idempotencyKey,
      actorId: ctx.actorId,
    });
    return { ...job, restricted: input.watermark !== null };
  }

  /**
   * Kits d'un projet dont la charte est déjà payée : produite au moins une fois, ou restaurés
   * depuis une version dont la charte l'est (même contenu, §7.4).
   */
  async paidGuides(projectId: string) {
    const [jobs, kits] = await Promise.all([
      this.prisma.generationJob.findMany({
        where: { projectId, kind: JobKind.BRAND_GUIDE, status: JobStatus.SUCCEEDED },
        select: { input: true },
      }),
      this.prisma.brandKit.findMany({
        where: { projectId },
        orderBy: { version: 'asc' },
        select: { id: true, version: true, restoredFrom: true },
      }),
    ]);
    const paid = new Set(jobs.map((job) => (job.input as unknown as KitJobInput).kitId));
    const byVersion = new Map(kits.map((kit) => [kit.version, kit.id]));
    for (const kit of kits) {
      const source = kit.restoredFrom !== null ? byVersion.get(kit.restoredFrom) : undefined;
      if (source && paid.has(source)) paid.add(kit.id);
    }
    return paid;
  }

  /** Contenu d'une nouvelle version : nom retenu, logo favori, slogans choisis. */
  private async snapshot(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { chosenName: true },
    });
    const logo = await this.prisma.logo.findFirst({
      where: { projectId },
      orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
      select: { engine: true, versions: { orderBy: { number: 'desc' }, take: 1 } },
    });
    const version = logo?.versions[0];
    if (!logo || !version) {
      throw new UnprocessableEntityException({
        message: 'Un logo est nécessaire pour assembler le kit',
        code: 'LOGO_REQUIRED',
      });
    }
    const slogans = await this.prisma.slogan.findMany({
      where: { projectId, isChosen: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, kind: true, text: true },
    });
    const chosen = (kind: string) => slogans.find((s) => s.kind === kind) ?? null;
    const name = project.chosenName;
    const content: KitContent = {
      name: name?.value ?? project.title,
      acronym: name?.acronym ?? null,
      meaning: name && name.meaning !== TYPED_NAME_MEANING ? name.meaning : null,
      entityType: project.entityType,
      slogan: chosen('SLOGAN')?.text ?? null,
      devise: chosen('DEVISE')?.text ?? null,
      mission: chosen('MISSION')?.text ?? null,
    };
    const source = logoSource(logo, version);
    return {
      logoVersionId: version.id,
      sloganId: chosen('SLOGAN')?.id ?? null,
      palette: kitPalette(parseSpec(version.spec).colors) as unknown as Prisma.InputJsonValue,
      fonts: kitFonts(source) as unknown as Prisma.InputJsonValue,
      content: content as unknown as Prisma.InputJsonValue,
      restoredFrom: null as number | null,
    };
  }

  private insert(projectId: string, data: KitVersionData) {
    return this.prisma.$transaction(async (tx) => {
      const last = await tx.brandKit.aggregate({ where: { projectId }, _max: { version: true } });
      return tx.brandKit.create({
        data: { projectId, version: (last._max.version ?? 0) + 1, ...data },
      });
    });
  }

  /** Logos, liens de téléchargement et coût de la charte de chaque kit. */
  private async present(kits: BrandKit[], canDownload: boolean) {
    const versionIds = kits.map((k) => k.logoVersionId).filter((id): id is string => !!id);
    const [versions, paid, assets] = await Promise.all([
      this.prisma.logoVersion.findMany({
        where: { id: { in: versionIds } },
        select: {
          id: true,
          number: true,
          spec: true,
          svg: true,
          logo: { select: { engine: true } },
        },
      }),
      kits.length ? this.paidGuides(kits[0].projectId) : new Set<string>(),
      this.prisma.asset.findMany({
        where: {
          storageKey: {
            in: kits
              .flatMap((k) => [k.guidePdfKey, k.zipKey])
              .filter((key): key is string => !!key),
          },
        },
        select: { storageKey: true },
      }),
    ]);
    const stored = new Set(assets.map((a) => a.storageKey));
    return Promise.all(
      kits.map(async (kit) => {
        const version = versions.find((v) => v.id === kit.logoVersionId);
        const files: KitFiles = { guidePdfUrl: null, zipUrl: null };
        if (canDownload) {
          const slug = slugify(parseKitContent(kit.content).name ?? '') || 'marque';
          if (kit.guidePdfKey && stored.has(kit.guidePdfKey)) {
            files.guidePdfUrl = await this.storage.signedUrl(kit.guidePdfKey, {
              expiresIn: FILE_URL_TTL_S,
              fileName: `charte-${slug}-v${kit.version}.pdf`,
              inline: true,
            });
          }
          if (kit.zipKey && stored.has(kit.zipKey)) {
            files.zipUrl = await this.storage.signedUrl(kit.zipKey, {
              expiresIn: FILE_URL_TTL_S,
              fileName: `${slug}-kit-v${kit.version}.zip`,
            });
          }
        }
        return toBrandKitDto(kit, version ? kitLogo(version) : null, files, {
          guideCost: paid.has(kit.id) ? 0 : CREDIT_COSTS.BRAND_GUIDE_PDF,
        });
      }),
    );
  }
}
