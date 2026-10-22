import { Injectable } from '@nestjs/common';
import { AssetKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import { renderDesignPage } from '../../render/design';
import { designDocSchema } from '../../render/design-doc';
import { designToPdf } from '../../render/design-pdf';
import { createZip } from '../../render/zip';
import { EXPORT_RETENTION_DAYS } from '../logos/logo-export.service';
import type { StudioExportInput } from './studio.service';

/** Résultat enregistré dans GenerationJob.result (lien signé exposé par GET /jobs/:jid). */
export interface StudioExportResult {
  assetId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  pages: number;
  expiresAt: string;
}

/** Exports du Studio produits par le worker : PDF d'impression ou SVG vectorisé. */
@Injectable()
export class StudioExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async runJob(jobId: string): Promise<StudioExportResult> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: { project: { select: { workspaceId: true } } },
    });
    const input = job.input as unknown as StudioExportInput;
    const design = await this.prisma.studioDesign.findUniqueOrThrow({
      where: { id: input.designId },
    });
    const doc = designDocSchema.parse(design.doc);
    const pages = input.pages.length ? input.pages : doc.pages.map((_, i) => i);
    const slug = slugify(design.name) || 'creation';

    let data: Buffer;
    let fileName: string;
    let mimeType: string;
    if (input.format === 'pdf') {
      data = await designToPdf(doc, { title: design.name, pages, cropMarks: input.cropMarks });
      fileName = `${slug}.pdf`;
      mimeType = 'application/pdf';
    } else if (pages.length === 1) {
      data = Buffer.from(renderDesignPage(doc, pages[0]));
      fileName = `${slug}.svg`;
      mimeType = 'image/svg+xml';
    } else {
      data = createZip(
        pages.map((index) => ({
          path: `${slug}/${slug}-page-${index + 1}.svg`,
          data: renderDesignPage(doc, index),
        })),
      );
      fileName = `${slug}-svg.zip`;
      mimeType = 'application/zip';
    }

    const storageKey = `studio/${job.project.workspaceId}/${design.id}/${jobId}/${fileName}`;
    await this.storage.put(storageKey, data, mimeType);
    const asset = await this.prisma.asset.create({
      data: {
        kind: AssetKind.EXPORT,
        name: fileName,
        storageKey,
        mimeType,
        sizeBytes: data.length,
        tags: [`studio:${design.id}`, `job:${jobId}`],
      },
    });
    const result: StudioExportResult = {
      assetId: asset.id,
      storageKey,
      fileName,
      sizeBytes: data.length,
      pages: pages.length,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
    };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { result: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  }
}
