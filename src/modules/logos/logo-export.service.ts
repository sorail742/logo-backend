import { Injectable } from '@nestjs/common';
import { AssetKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { slugify } from '../../common/utils/slug.util';
import { buildExportEntries, EXPORT_FORMATS, PNG_SIZES } from '../../render/logo-assets';
import { createZip } from '../../render/zip';
import { logoSource } from './logo-source';

/** Durée de mise à disposition d'un export avant purge nocturne. */
export const EXPORT_RETENTION_DAYS = 7;

/** Entrée d'une tâche LOGO_EXPORT, figée au moment de la demande (offre comprise). */
export const logoExportInputSchema = z.object({
  logoId: z.string().uuid(),
  versionId: z.string().uuid(),
  formats: z.array(z.enum(EXPORT_FORMATS)).min(1),
  sizes: z
    .array(
      z
        .number()
        .int()
        .refine((n) => (PNG_SIZES as readonly number[]).includes(n)),
    )
    .min(1),
  iconPack: z.boolean(),
  social: z.boolean(),
  watermark: z.string().nullable(),
  /** Vrai si l'offre a réduit la demande (offre gratuite : PNG 512 px filigrané, LOGO-24). */
  restricted: z.boolean(),
});
export type LogoExportInput = z.infer<typeof logoExportInputSchema>;

/** Résultat enregistré dans GenerationJob.result. */
export interface LogoExportResult {
  assetId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  files: number;
  restricted: boolean;
  expiresAt: string;
}

/** Exports de logo (LOGO-20 à 24), produits par le worker et déposés dans le stockage. */
@Injectable()
export class LogoExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async runJob(jobId: string): Promise<LogoExportResult> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        project: {
          select: { workspaceId: true, title: true, chosenName: { select: { value: true } } },
        },
      },
    });
    const input = logoExportInputSchema.parse(job.input);
    const version = await this.prisma.logoVersion.findUniqueOrThrow({
      where: { id: input.versionId },
      include: { logo: { select: { engine: true } } },
    });

    const slug = slugify(job.project.chosenName?.value ?? job.project.title) || 'logo';
    const entries = await buildExportEntries(logoSource(version.logo, version), slug, input);
    const zip = createZip(entries);

    const fileName = `${slug}-logo-v${version.number}.zip`;
    const storageKey = `exports/${job.project.workspaceId}/${jobId}/${fileName}`;
    await this.storage.put(storageKey, zip, 'application/zip');
    const asset = await this.prisma.asset.create({
      data: {
        kind: AssetKind.EXPORT,
        name: fileName,
        storageKey,
        mimeType: 'application/zip',
        sizeBytes: zip.length,
        tags: [`logo:${input.logoId}`, `job:${jobId}`],
      },
    });

    const result: LogoExportResult = {
      assetId: asset.id,
      storageKey,
      fileName,
      sizeBytes: zip.length,
      files: entries.length,
      restricted: input.restricted,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
    };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { result: result as unknown as Prisma.InputJsonValue },
    });
    return result;
  }
}
