import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AssetKind, JobKind, JobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import type { PrintContent, PrintElement } from '../../render/apparel-print';
import type { SheetFormatKey } from '../../render/gang-sheet';
import { createZip } from '../../render/zip';
import { JobsService } from '../jobs/jobs.service';
import { EXPORT_RETENTION_DAYS } from '../logos/logo-export.service';
import { REFERENCE_SIZE } from './apparel-defaults';
import type { PresetRules } from './apparel-rules';
import type { ProductionExportDto } from './apparel.dto';
import {
  buildProductionPack,
  SUPPORTS,
  TECHNIQUE_SUPPORT,
  type PrintSupport,
} from './production-pack';

interface Ctx {
  workspaceId: string;
  projectId: string;
  actorId: string;
}

/** Entrée d'une tâche PRODUCTION_PACK. */
export interface ProductionPackInput {
  designId: string;
  exportId: string;
  support: PrintSupport;
  mirror: boolean;
  sheetFormat?: SheetFormatKey;
  rollWidthMm?: number;
  rollPageMm?: number;
  cutMarks?: boolean;
  entryIds?: string[];
  copies: number;
  copiesSize?: string;
}

/** Résultat enregistré dans GenerationJob.result (lien signé exposé par GET /jobs/:jid). */
export interface ProductionPackResult {
  assetId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  pieces: number;
  sheets: number;
  warnings: string[];
  expiresAt: string;
}

/**
 * Pack atelier (cahier des charges §16.7-16.8) : la demande est validée ici puis le worker
 * produit l'archive (fichiers du support, un fichier par joueur, planches, fiche technique,
 * gabarits 1:1).
 */
@Injectable()
export class ProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  async request(ctx: Ctx, designId: string, dto: ProductionExportDto, idempotencyKey: string) {
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id: designId },
      include: {
        roster: { include: { entries: { select: { id: true } } } },
        _count: { select: { elements: true } },
      },
    });
    if (!design._count.elements)
      throw new BadRequestException('Ajoutez au moins un élément à la tenue avant le pack atelier');
    const known = new Set(design.roster?.entries.map((e) => e.id) ?? []);
    const unknown = (dto.entryIds ?? []).filter((id) => !known.has(id));
    if (unknown.length)
      throw new BadRequestException('Joueurs absents de l’effectif de cette tenue');

    const support = dto.support ?? TECHNIQUE_SUPPORT[design.technique];
    const mirror = dto.mirror ?? SUPPORTS[support].mirror;
    const exported = await this.prisma.productionExport.create({
      data: { designId, technique: design.technique, mirrored: mirror },
    });
    const input: ProductionPackInput = {
      designId,
      support,
      mirror,
      exportId: exported.id,
      sheetFormat: dto.sheetFormat,
      rollWidthMm: dto.rollWidthMm,
      rollPageMm: dto.rollPageMm,
      cutMarks: dto.cutMarks,
      entryIds: dto.entryIds?.length ? dto.entryIds : undefined,
      copies: dto.copies ?? 1,
      copiesSize: dto.copiesSize,
    };
    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.PRODUCTION_PACK,
      input: input as unknown as Prisma.InputJsonValue,
      cost: 0,
      actorId: ctx.actorId,
      idempotencyKey,
    });
  }

  async runJob(jobId: string): Promise<ProductionPackResult> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { project: { select: { workspaceId: true } } },
    });
    const input = job.input as unknown as ProductionPackInput;
    const design = await this.prisma.apparelDesign.findUniqueOrThrow({
      where: { id: input.designId },
      include: {
        template: { include: { sizes: { orderBy: { sortOrder: 'asc' } }, zones: true } },
        rulePreset: true,
        elements: { orderBy: { zIndex: 'asc' } },
        roster: { include: { entries: { orderBy: { number: 'asc' } } } },
      },
    });
    const entries = (design.roster?.entries ?? []).filter(
      (e) => !input.entryIds || input.entryIds.includes(e.id),
    );
    const rules = (design.rulePreset?.rules ?? null) as PresetRules | null;
    const sheet = input.sheetFormat
      ? { format: input.sheetFormat, rollWidthMm: input.rollWidthMm, rollPageMm: input.rollPageMm }
      : undefined;

    try {
      const pack = await buildProductionPack({
        design: {
          name: design.name,
          technique: design.technique,
          garmentColor: design.garmentColor,
          template: design.template.name,
          proofUrl: design.proofToken
            ? `${this.config.getOrThrow<string>('APP_URL')}/bat/${design.proofToken}`
            : null,
          approvedAt: design.approvedAt,
        },
        zones: design.template.zones,
        sizes: design.template.sizes,
        referenceSize: REFERENCE_SIZE,
        elements: design.elements.map((el): PrintElement => ({
          zoneKey: el.zoneKey,
          kind: el.kind,
          content: el.content as unknown as PrintContent,
          widthMm: el.widthMm,
          heightMm: el.heightMm,
          offsetXMm: el.offsetXMm,
          offsetYMm: el.offsetYMm,
          rotationDeg: el.rotationDeg,
        })),
        players: entries.map((e) => ({
          displayName: e.displayName,
          playerName: e.playerName,
          number: e.number,
          size: e.size,
          quantity: e.quantity,
          role: e.role,
        })),
        copies: input.copies,
        copiesSize: input.copiesSize,
        support: input.support,
        mirror: input.mirror,
        cutMarks: input.cutMarks,
        minNameHeightMm: rules?.names?.height?.min,
        sheet,
      });

      const slug = slugify(design.name) || 'tenue';
      const fileName = `${slug}-pack-atelier.zip`;
      const data = createZip(
        pack.entries.map((e) => ({ path: `${slug}/${e.path}`, data: e.data })),
      );
      const base = `apparel/${job.project.workspaceId}/${design.id}/${jobId}`;
      const storageKey = `${base}/${fileName}`;
      const techPackKey = `${base}/${slug}-fiche-technique.pdf`;
      await this.storage.put(storageKey, data, 'application/zip');
      await this.storage.put(techPackKey, pack.techSheet, 'application/pdf');
      const asset = await this.prisma.asset.create({
        data: {
          storageKey,
          kind: AssetKind.EXPORT,
          name: fileName,
          mimeType: 'application/zip',
          sizeBytes: data.length,
          tags: [`apparel:${design.id}`, `job:${jobId}`],
        },
      });
      await this.prisma.productionExport.update({
        where: { id: input.exportId },
        data: { status: JobStatus.SUCCEEDED, zipKey: storageKey, techPackKey },
      });
      const result: ProductionPackResult = {
        storageKey,
        fileName,
        assetId: asset.id,
        sizeBytes: data.length,
        pieces: pack.pieces,
        sheets: pack.sheets,
        warnings: pack.warnings.slice(0, 50),
        expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
      };
      await this.prisma.generationJob.update({
        where: { id: jobId },
        data: { result: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    } catch (error) {
      await this.prisma.productionExport.update({
        where: { id: input.exportId },
        data: { status: JobStatus.FAILED },
      });
      throw error;
    }
  }
}
