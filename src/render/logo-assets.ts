import { readableOn } from './color';
import { getFont } from './fonts';
import { getIcon } from './icons';
import { LOGO_VARIANTS, renderLogoSvg, type LogoVariant } from './logo';
import type { LogoSpec } from './logo-spec';
import { svgToPdf } from './pdf';
import { buildIco, svgToJpeg, svgToPng } from './raster';
import { frameSvg, optimizeSvg, recolorSvg, svgSize } from './svg';
import type { ZipEntry } from './zip';

// Variantes et exports d'un logo (§5.4) : SVG optimisés, PDF vectoriels, PNG, JPG,
// pack d'icônes d'app et formats réseaux sociaux, rangés dans une archive.

/** Logo composé (spec) ou importé (SVG nettoyé, sans spec exploitable pour les dispositions). */
export type LogoSource =
  | { kind: 'spec'; spec: LogoSpec }
  | { kind: 'svg'; svg: string; title: string; background: string };

export interface RenderedVariant {
  id: string;
  file: string;
  dark: boolean;
  svg: string;
}

export const EXPORT_FORMATS = ['svg', 'pdf', 'png', 'jpg'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const PNG_SIZES = [512, 1024, 2048] as const;

/** Pack d'icônes d'application (LOGO-22), en plus de favicon.ico 16/32/48. */
export const APP_ICON_SIZES = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'android-chrome-192.png', size: 192 },
  { file: 'android-chrome-512.png', size: 512 },
  { file: 'ios-1024.png', size: 1024 },
] as const;

/** Formats réseaux sociaux (LOGO-23), en résolution double pour les bannières. */
export const SOCIAL_FORMATS = [
  { file: 'photo-de-profil-400.png', width: 400, height: 400, profile: true },
  { file: 'facebook-couverture-1640x624.png', width: 1640, height: 624, profile: false },
  { file: 'linkedin-banniere-1584x396.png', width: 1584, height: 396, profile: false },
] as const;

export interface ExportOptions {
  formats: ExportFormat[];
  sizes: number[];
  iconPack: boolean;
  social: boolean;
  /** Filigrane sur les PNG (offre gratuite, LOGO-24). */
  watermark: string | null;
}

function iconSpec(spec: LogoSpec): LogoSpec {
  return { ...spec, iconFrame: spec.iconFrame === 'none' ? 'circle' : spec.iconFrame };
}

function renderVariant(
  source: LogoSource,
  variant: LogoVariant,
  layout?: (typeof LOGO_VARIANTS)[number]['layout'],
  watermark?: string | null,
) {
  if (source.kind === 'spec') return renderLogoSvg(source.spec, { variant, layout, watermark }).svg;
  if (variant === 'color') return source.svg;
  const recolored = recolorSvg(source.svg, variant === 'black' ? '#111111' : '#ffffff');
  return variant === 'white' ? withBackground(recolored, '#111111') : recolored;
}

function withBackground(svg: string, color: string) {
  return frameSvg(svg, { ...svgSize(svg), background: color });
}

/** Variantes automatiques (LOGO-20) ; un logo importé n'a que couleur, noir et blanc. */
export function renderVariants(source: LogoSource): RenderedVariant[] {
  return LOGO_VARIANTS.filter((def) => source.kind === 'spec' || !def.layout).map((def) => ({
    id: def.id,
    file: def.file,
    dark: def.variant === 'white',
    svg: optimizeSvg(renderVariant(source, def.variant, def.layout)),
  }));
}

function markSvg(source: LogoSource) {
  return source.kind === 'spec'
    ? renderLogoSvg(iconSpec(source.spec), { layout: 'icon' }).svg
    : source.svg;
}

function background(source: LogoSource) {
  return source.kind === 'spec' ? source.spec.colors.background : source.background;
}

/** Logo centré sur un fond aux couleurs de la marque (LOGO-23). */
function socialSvg(source: LogoSource, format: (typeof SOCIAL_FORMATS)[number]) {
  if (source.kind === 'svg') {
    return frameSvg(source.svg, {
      width: format.width,
      height: format.height,
      background: source.background,
      fill: 0.6,
    });
  }
  const { spec } = source;
  if (format.profile) {
    return frameSvg(markSvg(source), {
      width: format.width,
      height: format.height,
      background: spec.colors.background,
      fill: 0.86,
    });
  }
  const color = spec.colors.primary;
  const variant = readableOn(color) === '#ffffff' ? 'white' : 'color';
  const logo = renderLogoSvg(spec, {
    variant,
    withBackground: false,
    layout: spec.layout === 'vertical' ? 'horizontal' : undefined,
  }).svg;
  return frameSvg(logo, {
    width: format.width,
    height: format.height,
    background: color,
    fill: 0.6,
  });
}

/** LICENCES.txt : chaque police et icône avec sa licence (§14.2). */
export function licencesText(source: LogoSource) {
  const lines = ['LICENCES DES ÉLÉMENTS UTILISÉS', ''];
  if (source.kind === 'spec') {
    const font = getFont(source.spec.fontId);
    lines.push(`Police : ${font.name} — SIL Open Font License 1.1 (https://openfontlicense.org)`);
    if (source.spec.tagline) lines.push('Police : Montserrat — SIL Open Font License 1.1 (slogan)');
    const icon = source.spec.iconId ? getIcon(source.spec.iconId) : null;
    if (icon) lines.push(`Icône : ${icon.id} — Lucide, licence ISC (https://lucide.dev/license)`);
    lines.push(
      '',
      'Le texte est converti en tracés : les fichiers s’affichent sans police installée.',
    );
  } else {
    lines.push('Logo importé par le titulaire du compte, qui en garantit les droits.');
  }
  lines.push(
    '',
    'Les droits d’usage commercial du logo sont cédés au titulaire du compte, dans la limite des licences ci-dessus.',
    'Nous recommandons un dépôt de marque auprès de l’OAPI pour sécuriser le nom et le logo.',
  );
  return lines.join('\n');
}

/** Fichiers de l'export (LOGO-21 à 24), chemins relatifs à la racine de l'archive. */
export async function buildExportEntries(
  source: LogoSource,
  slug: string,
  options: ExportOptions,
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const variants = LOGO_VARIANTS.filter((def) => source.kind === 'spec' || !def.layout);
  const title = source.kind === 'spec' ? source.spec.text : source.title;

  for (const def of variants) {
    const base = `${slug}-${def.file}`;
    const master = optimizeSvg(renderVariant(source, def.variant, def.layout));
    if (options.formats.includes('svg')) entries.push({ path: `svg/${base}.svg`, data: master });
    if (options.formats.includes('pdf')) {
      entries.push({
        path: `pdf/${base}.pdf`,
        data: await svgToPdf(master, { title: `${title} — ${def.file}` }),
      });
    }
    if (options.formats.includes('png')) {
      const png = options.watermark
        ? renderVariant(source, def.variant, def.layout, options.watermark)
        : master;
      for (const size of options.sizes) {
        entries.push({ path: `png/${base}-${size}.png`, data: svgToPng(png, { size }) });
      }
    }
    // JPG : variante couleur seulement, fond plein de la marque.
    if (options.formats.includes('jpg') && def.id === 'color') {
      const jpg = options.watermark
        ? renderVariant(source, 'color', undefined, options.watermark)
        : master;
      for (const size of options.sizes) {
        entries.push({
          path: `jpg/${base}-${size}.jpg`,
          data: svgToJpeg(jpg, { size, background: background(source) }),
        });
      }
    }
  }

  if (options.iconPack) {
    const mark = markSvg(source);
    entries.push({ path: 'icones-app/favicon.ico', data: buildIco(mark) });
    for (const { file, size } of APP_ICON_SIZES) {
      // iOS refuse la transparence : fond plein pour l'icône 1024 px
      const bg = file === 'ios-1024.png' ? background(source) : null;
      entries.push({
        path: `icones-app/${file}`,
        data: svgToPng(mark, { size, square: true, padding: 0.08, background: bg }),
      });
    }
  }

  if (options.social) {
    for (const format of SOCIAL_FORMATS) {
      entries.push({
        path: `reseaux-sociaux/${format.file}`,
        data: svgToPng(socialSvg(source, format), { size: format.width }),
      });
    }
  }

  entries.push({ path: 'LICENCES.txt', data: licencesText(source) });
  return entries.map((entry) => ({ ...entry, path: `${slug}/${entry.path}` }));
}
