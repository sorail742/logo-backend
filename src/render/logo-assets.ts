import { mix, readableOn } from './color';
import { getFont } from './fonts';
import { getIcon } from './icons';
import { LOGO_VARIANTS, renderLogoSvg, type LogoVariant } from './logo';
import type { LogoSpec } from './logo-spec';
import { svgToPdf } from './pdf';
import { buildIco, svgToJpeg, svgToPng } from './raster';
import type { BrandAssets } from './compose';
import { MOCKUP_SCENES, MOCKUP_WIDTH, mockupSvg } from './mockups';
import { SOCIAL_KIT, socialKitSvg } from './social-kit';
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

export interface ExportOptions {
  formats: ExportFormat[];
  sizes: number[];
  iconPack: boolean;
  social: boolean;
  /** Mises en situation (devanture, t-shirt, mugs…), en JPG. */
  mockups?: boolean;
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
  transparent = false,
) {
  if (source.kind === 'spec') {
    return renderLogoSvg(source.spec, {
      variant,
      layout,
      watermark,
      ...(transparent && { withBackground: false }),
    }).svg;
  }
  if (variant === 'color') return source.svg;
  const recolored = recolorSvg(source.svg, variant === 'black' ? '#111111' : '#ffffff');
  return variant === 'white' && !transparent ? withBackground(recolored, '#111111') : recolored;
}

function withBackground(svg: string, color: string) {
  return frameSvg(svg, { ...svgSize(svg), background: color });
}

/**
 * Variantes automatiques (LOGO-20) ; un logo importé n'a que couleur, noir et blanc.
 * `transparent` : la version blanche sans son fond sombre (pose sur une création du Studio).
 */
export function renderVariants(source: LogoSource, transparent = false): RenderedVariant[] {
  return LOGO_VARIANTS.filter((def) => source.kind === 'spec' || !def.layout).map((def) => ({
    id: def.id,
    file: def.file,
    dark: def.variant === 'white',
    svg: optimizeSvg(renderVariant(source, def.variant, def.layout, null, transparent)),
  }));
}

/** Symbole seul du logo (icône d'app, profil, centre du cachet). */
export function markSvg(source: LogoSource) {
  return source.kind === 'spec'
    ? renderLogoSvg(iconSpec(source.spec), { layout: 'icon' }).svg
    : source.svg;
}

function background(source: LogoSource) {
  return source.kind === 'spec' ? source.spec.colors.background : source.background;
}

/** Logo, symbole et couleurs pour le kit réseaux sociaux (LOGO-23). */
/** Logo et symbole dans toutes leurs couleurs, pour les visuels composés (réseaux sociaux, mises en situation). */
function brandAssets(source: LogoSource): BrandAssets {
  if (source.kind === 'svg') {
    const size = svgSize(source.svg);
    const color = { svg: source.svg, ...size };
    const white = { svg: recolorSvg(source.svg, '#ffffff'), ...size };
    const black = { svg: recolorSvg(source.svg, '#111111'), ...size };
    const primary = readableOn(source.background) === '#ffffff' ? source.background : '#111827';
    return {
      logo: { color, white, black },
      mark: { color, white, black },
      colors: { primary, secondary: mix(primary, '#ffffff', 0.4), background: source.background },
      name: source.title,
    };
  }
  const { spec } = source;
  const layout = spec.layout === 'vertical' ? 'horizontal' : undefined;
  const icon = iconSpec(spec);
  return {
    logo: {
      color: renderLogoSvg(spec, { variant: 'color', withBackground: false, layout }),
      white: renderLogoSvg(spec, { variant: 'white', withBackground: false, layout }),
      black: renderLogoSvg(spec, { variant: 'black', layout }),
    },
    mark: {
      color: renderLogoSvg(icon, { layout: 'icon' }),
      white: renderLogoSvg(icon, { layout: 'icon', variant: 'white', withBackground: false }),
      black: renderLogoSvg(icon, { layout: 'icon', variant: 'black' }),
    },
    colors: spec.colors,
    name: spec.text,
  };
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

/** Visuels composés : kit réseaux sociaux (PNG) et mises en situation (JPG). */
function composedEntries(source: LogoSource, options: ExportOptions): ZipEntry[] {
  const input = brandAssets(source);
  const entries: ZipEntry[] = [];
  if (options.social) {
    for (const format of SOCIAL_KIT) {
      entries.push({
        path: `reseaux-sociaux/${format.file}.png`,
        data: svgToPng(socialKitSvg(input, format), {
          size: Math.max(format.width, format.height),
        }),
      });
    }
  }
  if (options.mockups) {
    for (const scene of MOCKUP_SCENES) {
      entries.push({
        path: `mises-en-situation/${scene.file}.jpg`,
        data: svgToJpeg(mockupSvg(input, scene), { size: MOCKUP_WIDTH, quality: 88 }),
      });
    }
  }
  return entries;
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

  const masters = variants.map((def) => optimizeSvg(renderVariant(source, def.variant, def.layout)));
  // PDF vectoriels produits en parallèle ; l'ordre des fichiers de l'archive ne change pas.
  const pdfs = options.formats.includes('pdf')
    ? await Promise.all(
        variants.map((def, i) => svgToPdf(masters[i], { title: `${title} — ${def.file}` })),
      )
    : [];

  variants.forEach((def, i) => {
    const base = `${slug}-${def.file}`;
    const master = masters[i];
    if (options.formats.includes('svg')) entries.push({ path: `svg/${base}.svg`, data: master });
    if (pdfs[i]) entries.push({ path: `pdf/${base}.pdf`, data: pdfs[i] });
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
  });

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

  if (options.social || options.mockups) entries.push(...composedEntries(source, options));

  entries.push({ path: 'LICENCES.txt', data: licencesText(source) });
  return entries.map((entry) => ({ ...entry, path: `${slug}/${entry.path}` }));
}
