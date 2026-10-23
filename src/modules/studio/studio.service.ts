import { Injectable, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { JobKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { zodProblem } from '../../common/validation/validation-problem';
import { designDocSchema, MAX_DOC_BYTES, type DesignDoc } from '../../render/design-doc';
import { sanitizeSvg } from '../../render/svg';
import { JobsService } from '../jobs/jobs.service';
import type {
  CreateStudioDesignDto,
  ExportStudioDesignDto,
  UpdateStudioDesignDto,
} from './studio.dto';
import { toStudioDesign, toStudioSummary } from './studio.presenter';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

/** Entrée d'une tâche DESIGN_EXPORT. */
export interface StudioExportInput {
  designId: string;
  format: 'pdf' | 'svg';
  pages: number[];
  cropMarks: boolean;
}

const SUMMARY_ORDER = [{ updatedAt: 'desc' as const }, { id: 'desc' as const }];

/** Studio de création : publications, affiches, flyers, cartes, présentations (documents). */
@Injectable()
export class StudioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
  ) {}

  /**
   * Valide un document reçu de l'éditeur : schéma, taille totale et SVG intégrés (nettoyés
   * comme un logo importé, §14.1). Erreurs au format problem+json.
   */
  parseDoc(raw: unknown): DesignDoc {
    if (JSON.stringify(raw).length > MAX_DOC_BYTES) {
      throw new PayloadTooLargeException(
        'Création trop lourde : réduisez le nombre ou la taille des images',
      );
    }
    const parsed = designDocSchema.safeParse(raw);
    if (!parsed.success) {
      throw zodProblem(parsed.error, 'Document de création invalide', 20);
    }
    const doc = parsed.data;
    for (const page of doc.pages) {
      for (const el of page.elements) {
        if (el.type !== 'svg') continue;
        const clean = sanitizeSvg(el.svg);
        if (!clean)
          throw new UnprocessableEntityException(`SVG non pris en charge dans l’élément ${el.id}`);
        el.svg = clean;
      }
    }
    return doc;
  }

  async list(projectId: string) {
    const rows = await this.prisma.studioDesign.findMany({
      where: { projectId },
      orderBy: SUMMARY_ORDER,
      take: 200,
    });
    return rows.map(toStudioSummary);
  }

  async create(ctx: Ctx, dto: CreateStudioDesignDto) {
    const doc = this.parseDoc(dto.doc);
    const design = await this.prisma.studioDesign.create({
      data: {
        projectId: ctx.projectId,
        name: dto.name.trim(),
        format: dto.format,
        width: Math.round(doc.width),
        height: Math.round(doc.height),
        doc: doc as unknown as Prisma.InputJsonValue,
        thumbnail: dto.thumbnail ?? null,
        createdById: ctx.actorId,
      },
    });
    return toStudioDesign(design);
  }

  async get(designId: string) {
    return toStudioDesign(
      await this.prisma.studioDesign.findUniqueOrThrow({ where: { id: designId } }),
    );
  }

  /** Sauvegarde (automatique côté éditeur) : nom, document, aperçu. */
  async update(designId: string, dto: UpdateStudioDesignDto) {
    const doc = dto.doc ? this.parseDoc(dto.doc) : undefined;
    const design = await this.prisma.studioDesign.update({
      where: { id: designId },
      data: {
        ...(dto.name && { name: dto.name.trim() }),
        ...(doc && {
          doc: doc as unknown as Prisma.InputJsonValue,
          width: Math.round(doc.width),
          height: Math.round(doc.height),
        }),
        ...(dto.thumbnail && { thumbnail: dto.thumbnail }),
      },
    });
    return toStudioSummary(design);
  }

  async duplicate(designId: string, actorId: string) {
    const source = await this.prisma.studioDesign.findUniqueOrThrow({ where: { id: designId } });
    const copy = await this.prisma.studioDesign.create({
      data: {
        projectId: source.projectId,
        name: `${source.name} (copie)`.slice(0, 120),
        format: source.format,
        width: source.width,
        height: source.height,
        doc: source.doc as Prisma.InputJsonValue,
        thumbnail: source.thumbnail,
        createdById: actorId,
      },
    });
    return toStudioDesign(copy);
  }

  async remove(designId: string) {
    await this.prisma.studioDesign.delete({ where: { id: designId } });
  }

  /** PDF (impression, traits de coupe) ou SVG vectorisé, produit par le worker (0 crédit). */
  async requestExport(
    ctx: Ctx,
    designId: string,
    dto: ExportStudioDesignDto,
    idempotencyKey: string,
  ) {
    const design = await this.prisma.studioDesign.findUniqueOrThrow({
      where: { id: designId },
      select: { doc: true },
    });
    const pageCount = (design.doc as unknown as DesignDoc).pages.length;
    const pages = [...new Set(dto.pages ?? [])].filter((i) => i < pageCount).sort((a, b) => a - b);
    const input: StudioExportInput = {
      designId,
      format: dto.format,
      pages,
      cropMarks: dto.cropMarks ?? false,
    };
    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.DESIGN_EXPORT,
      input: input as unknown as Prisma.InputJsonValue,
      cost: 0,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }
}
