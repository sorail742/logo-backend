import { optimize, type CustomPlugin, type XastElement, type XastParent } from 'svgo';

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Taille maximale d'un SVG importé (§14.1). */
export const MAX_IMPORT_SVG_BYTES = 1_000_000;

/** Éléments conservés dans un SVG importé : formes, texte, styles et effets, rien d'actif. */
const ALLOWED_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'image',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'feBlend',
  'feColorMatrix',
  'feComponentTransfer',
  'feComposite',
  'feFlood',
  'feFuncA',
  'feFuncB',
  'feFuncG',
  'feFuncR',
  'feGaussianBlur',
  'feMerge',
  'feMergeNode',
  'feMorphology',
  'feOffset',
]);

const SAFE_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const EXTERNAL_URL = /url\(\s*['"]?(?!#)[^)]*\)/gi;
const HAS_EXTERNAL_URL = /url\(\s*['"]?(?!#)/i;
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href', 'src']);

function detach(node: XastElement, parent: XastParent) {
  node.children = [];
  parent.children = parent.children.filter((child) => child !== node);
}

/** CSS sans @import ni ressource externe (attribut style ou élément style). */
function cleanCss(css: string) {
  return css.replace(/@import[^;]*;?/gi, '').replace(EXTERNAL_URL, 'none');
}

/** Plugin SVGO de nettoyage : liste blanche d'éléments, ni script, ni événement, ni lien externe. */
const sanitizePlugin: CustomPlugin = {
  name: 'sanitize',
  fn: () => ({
    doctype: { enter: (_node, parent) => void (parent.children = []) },
    instruction: {
      enter: (node, parent) => void (parent.children = parent.children.filter((c) => c !== node)),
    },
    element: {
      enter: (node, parent) => {
        // Un lien devient un simple groupe : son contenu graphique est conservé.
        if (node.name === 'a') node.name = 'g';
        if (!ALLOWED_ELEMENTS.has(node.name)) return detach(node, parent);
        for (const [name, raw] of Object.entries(node.attributes)) {
          const attr = name.toLowerCase();
          const value = raw.trim();
          if (attr.startsWith('on') || /javascript:|vbscript:/i.test(value)) {
            delete node.attributes[name];
          } else if (LINK_ATTRIBUTES.has(attr)) {
            const internal = value.startsWith('#') && node.name !== 'image';
            const image = node.name === 'image' && SAFE_IMAGE.test(value);
            if (!internal && !image) delete node.attributes[name];
          } else if (HAS_EXTERNAL_URL.test(value)) {
            node.attributes[name] = cleanCss(value);
          }
        }
        const linked = node.attributes.href ?? node.attributes['xlink:href'];
        if ((node.name === 'image' || node.name === 'use') && !linked) return detach(node, parent);
      },
    },
    text: {
      enter: (node, parent) => {
        if (parent.type === 'element' && parent.name === 'style') node.value = cleanCss(node.value);
      },
    },
    cdata: {
      enter: (node, parent) => {
        if (parent.type === 'element' && parent.name === 'style') node.value = cleanCss(node.value);
      },
    },
  }),
};

/**
 * Nettoie un SVG importé (§14.1, LOGO-07) puis l'optimise. Renvoie null si le fichier n'est pas
 * un SVG exploitable. Les DTD sont refusées en amont (entités, inclusions externes).
 */
export function sanitizeSvg(source: string): string | null {
  if (Buffer.byteLength(source) > MAX_IMPORT_SVG_BYTES) return null;
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) return null;
  try {
    const { data } = optimize(source, {
      multipass: true,
      plugins: [
        sanitizePlugin,
        { name: 'preset-default', params: { overrides: { removeUselessDefs: false } } },
      ],
    });
    if (!/^<svg[\s>]/.test(data.trim())) return null;
    return data;
  } catch {
    return null;
  }
}

/** Optimisation SVGO des SVG produits par le moteur (§5.5). */
export function optimizeSvg(svg: string): string {
  return optimize(svg, {
    multipass: true,
    floatPrecision: 2,
    plugins: [{ name: 'preset-default', params: { overrides: { cleanupIds: false } } }],
  }).data;
}

/** Remplace toutes les couleurs d'un SVG par une seule (variantes noir et blanc d'un logo importé). */
export function recolorSvg(svg: string, color: string): string {
  const paint = (value: string) =>
    /^(none|transparent)$/i.test(value.trim()) || /^url\(/i.test(value.trim()) ? value : color;
  const plugin: CustomPlugin = {
    name: 'recolor',
    fn: () => ({
      element: {
        enter: (node) => {
          if (node.name === 'svg') node.attributes.fill ??= color;
          for (const attr of ['fill', 'stroke', 'stop-color', 'flood-color', 'color']) {
            if (node.attributes[attr] !== undefined)
              node.attributes[attr] = paint(node.attributes[attr]);
          }
          if (node.attributes.style) {
            node.attributes.style = node.attributes.style.replace(
              /(fill|stroke|stop-color|flood-color|color)\s*:\s*([^;]+)/gi,
              (_m, prop: string, value: string) => `${prop}:${paint(value)}`,
            );
          }
        },
      },
      text: {
        enter: (node, parent) => {
          if (parent.type === 'element' && parent.name === 'style') {
            node.value = node.value.replace(
              /(fill|stroke|stop-color|flood-color|color)\s*:\s*([^;}]+)/gi,
              (_m, prop: string, value: string) => `${prop}:${paint(value)}`,
            );
          }
        },
      },
    }),
  };
  return optimize(svg, { plugins: [plugin] }).data;
}

/** Dimensions intrinsèques d'un SVG (viewBox, sinon width / height). */
export function svgSize(svg: string): { width: number; height: number } {
  const root = svg.match(/<svg\b[^>]*>/)?.[0] ?? '';
  const viewBox = root.match(/viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  const width = Number(root.match(/\bwidth="([\d.]+)(px)?"/)?.[1] ?? 512);
  const height = Number(root.match(/\bheight="([\d.]+)(px)?"/)?.[1] ?? 512);
  return { width, height };
}

/**
 * Place un SVG dans un cadre de taille fixe (icônes d'app, formats réseaux) : centré, mis à
 * l'échelle avec une marge, sur fond plein ou transparent.
 */
export function frameSvg(
  svg: string,
  frame: {
    width: number;
    height: number;
    padding?: number;
    background?: string | null;
    fill?: number;
  },
): string {
  const { width: vw, height: vh } = svgSize(svg);
  const padding = frame.padding ?? 0;
  const maxW = frame.width * (frame.fill ?? 1 - padding * 2);
  const maxH = frame.height * (frame.fill ?? 1 - padding * 2);
  const scale = Math.min(maxW / vw, maxH / vh);
  const w = vw * scale;
  const h = vh * scale;
  const x = (frame.width - w) / 2;
  const y = (frame.height - h) / 2;
  const inner = svg
    .replace(/^<\?xml[^>]*>\s*/, '')
    .replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
      const kept = attrs.replace(/\s(x|y|width|height)="[^"]*"/g, '');
      const viewBox = /viewBox=/.test(kept) ? '' : ` viewBox="0 0 ${vw} ${vh}"`;
      return `<svg${kept}${viewBox} x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}">`;
    });
  const background = frame.background
    ? `<rect width="${frame.width}" height="${frame.height}" fill="${frame.background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${frame.width} ${frame.height}" width="${frame.width}" height="${frame.height}">${background}${inner}</svg>`;
}
