import { Injectable } from '@nestjs/common';
import archiver from 'archiver';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { slugify } from '../../common/utils/slug.util';
import { FONTS, fontInfo, ICON_LICENSE } from '../../render/assets';
import { appIconPack, optimizeSvg, toJpg, toPdf, toPng, watermark } from '../../render/export';
import { renderVariant, Variant, VARIANTS } from '../../render/variants';
import { LogoSpec, logoSpecSchema } from '../../shared/logo-spec';
import { CreditsService } from '../credits/credits.service';
import { StorageService } from '../storage/storage.service';

export const EXPORT_FORMATS = ['svg', 'pdf', 'png', 'jpg'] as const;
export const PNG_SIZES = [512, 1024, 2048] as const;
/** Un lien de téléchargement reste valable 7 jours (§7.4). */
export const EXPORT_RETENTION_DAYS = 7;

export const logoExportInputSchema = z.object({
  type: z.literal('LOGO_EXPORT'),
  logoVersionId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  formats: z.array(z.enum(EXPORT_FORMATS)).min(1),
  pngSizes: z
    .array(z.union([z.literal(512), z.literal(1024), z.literal(2048)]))
    .default([512, 1024, 2048]),
  variants: z.array(z.enum(VARIANTS)).min(1).default(['color']),
  appIcons: z.boolean().default(false),
});
export type LogoExportInput = z.infer<typeof logoExportInputSchema>;

export interface ExportOutput {
  key: string;
  fileName: string;
  sizeBytes: number;
  files: string[];
  watermarked: boolean;
  expiresAt: string;
}

@Injectable()
export class LogoExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly credits: CreditsService,
  ) {}

  async runJob(jobId: string): Promise<ExportOutput> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const input = logoExportInputSchema.parse(job.input);
    const version = await this.prisma.logoVersion.findUniqueOrThrow({
      where: { id: input.logoVersionId },
    });
    const spec = logoSpecSchema.parse(version.spec);

    // Le filigrane dépend de l'offre au moment de l'export, pas de la génération (§7.4).
    const paid = await this.credits.hasPaidAccess(input.workspaceId);
    const files = paid ? await this.paidFiles(spec, input) : this.freeFiles(spec);
    files['LICENCES.txt'] = Buffer.from(licences(spec), 'utf8');

    const zip = await zipFiles(files);
    const base = slugify(spec.text) || 'logo';
    const fileName = `${base}-logo.zip`;
    const key = `exports/${input.workspaceId}/${jobId}/${fileName}`;
    await this.storage.put(key, zip, 'application/zip');

    const output: ExportOutput = {
      key,
      fileName,
      sizeBytes: zip.length,
      files: Object.keys(files).sort(),
      watermarked: !paid,
      expiresAt: new Date(Date.now() + EXPORT_RETENTION_DAYS * 86_400_000).toISOString(),
    };
    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { output: { ...output } },
    });
    return output;
  }

  /** Offre gratuite : PNG 512 px avec filigrane uniquement (LOGO-24). */
  private freeFiles(spec: LogoSpec): Record<string, Buffer> {
    const base = slugify(spec.text) || 'logo';
    return {
      [`logo/png/${base}-512-apercu.png`]: toPng(watermark(renderVariant(spec, 'color')), 512),
    };
  }

  private async paidFiles(spec: LogoSpec, input: LogoExportInput): Promise<Record<string, Buffer>> {
    const base = slugify(spec.text) || 'logo';
    const files: Record<string, Buffer> = {};
    for (const variant of input.variants) {
      const logo = renderVariant(spec, variant);
      const name = `${base}-${variantLabel(variant)}`;
      if (input.formats.includes('svg'))
        files[`logo/svg/${name}.svg`] = Buffer.from(optimizeSvg(logo.svg), 'utf8');
      if (input.formats.includes('pdf')) files[`logo/pdf/${name}.pdf`] = await toPdf(logo);
      if (input.formats.includes('png')) {
        for (const size of input.pngSizes)
          files[`logo/png/${name}-${size}.png`] = toPng(logo.svg, size);
      }
      // Le JPG n'a pas de transparence : la variante blanche n'y a pas de sens.
      if (input.formats.includes('jpg') && variant !== 'white')
        files[`logo/jpg/${name}.jpg`] = await toJpg(logo.svg, 2048);
    }
    if (input.appIcons) {
      // Symbole blanc sur la couleur principale (LOGO-22).
      const icon = renderVariant({ ...spec, layout: 'icon' }, 'white');
      const pack = appIconPack(icon, spec.colors.primary);
      for (const [name, data] of Object.entries(pack)) files[`icones-app/${name}`] = data;
    }
    return files;
  }
}

function variantLabel(v: Variant): string {
  return {
    color: 'couleur',
    black: 'noir',
    white: 'blanc',
    icon: 'icone',
    horizontal: 'horizontal',
    vertical: 'vertical',
  }[v];
}

/** LICENCES.txt : chaque police et icône utilisée avec sa licence (§14.2). */
export function licences(spec: LogoSpec): string {
  const fonts = [...new Set([spec.font.id, spec.taglineFont?.id].filter(Boolean) as string[])]
    .map((id) => fontInfo(id))
    .filter(Boolean)
    .map(
      (f) =>
        `- Police « ${f!.family} » — SIL Open Font License 1.1 (OFL) — https://fonts.google.com/specimen/${f!.family.replace(/ /g, '+')}`,
    );
  const icons = spec.icon
    ? [
        `- Icône « ${spec.icon.id} » — ${ICON_LICENSE.name}, licence ${ICON_LICENSE.license} — ${ICON_LICENSE.url}`,
      ]
    : [];
  return [
    'LICENCES DES ÉLÉMENTS UTILISÉS',
    '',
    'Ce logo est composé d’éléments sous licence libre issus de la bibliothèque de la plateforme.',
    'Le texte est converti en tracés : les fichiers s’affichent sans installer les polices.',
    '',
    ...fonts,
    ...icons,
    '',
    'Les droits d’usage commercial du logo sont cédés selon les conditions générales d’utilisation,',
    'dans la limite des licences ci-dessus. Un dépôt de marque auprès de l’OAPI est recommandé.',
    '',
    `(${FONTS.length} polices et la bibliothèque Tabler Icons sont disponibles sur la plateforme.)`,
    '',
  ].join('\n');
}

export function zipFiles(files: Record<string, Buffer>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on('data', (c: Buffer) => chunks.push(c));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.pipe(out);
    for (const [name, data] of Object.entries(files)) archive.append(data, { name });
    void archive.finalize();
  });
}
