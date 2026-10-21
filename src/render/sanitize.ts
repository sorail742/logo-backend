/**
 * Logos importés (LOGO-07, §14.1) : nettoyage des SVG (scripts, gestionnaires d'événements,
 * liens externes, foreignObject) et extraction de la palette.
 */
import sharp from 'sharp';
import { rgbToHex } from '../shared/color';

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const DANGEROUS_ELEMENTS = [
  'script',
  'foreignObject',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'handler',
  'listener',
];

/**
 * Nettoyage par liste de refus sur un SVG texte. Les SVG importés ne sont jamais servis tels
 * quels au navigateur : ils sont réaffichés via <img> ou rasterisés, ce qui neutralise le reste.
 */
export function sanitizeSvg(input: string): string {
  const raw = stripBom(input);
  // Avant tout nettoyage : entité ou sous-ensemble DTD interne refusés (XXE, « billion laughs »).
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(raw)) throw new Error('Entités XML interdites');
  let svg = raw
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (!/<svg[\s>]/i.test(svg)) throw new Error('Fichier SVG invalide');

  for (const tag of DANGEROUS_ELEMENTS) {
    svg = svg.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '');
    svg = svg.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), '');
  }
  // Gestionnaires d'événements (onload, onclick…).
  svg = svg.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Liens externes et pseudo-protocoles : seules les références internes (#id) et data:image sont gardées.
  svg = svg.replace(/\s+(?:xlink:)?href\s*=\s*("([^"]*)"|'([^']*)')/gi, (m, _q, d1, d2) => {
    const v = String(d1 ?? d2 ?? '').trim();
    return v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(v) ? m : '';
  });
  svg = svg.replace(/url\(\s*['"]?\s*(?!#)[^)]*\)/gi, 'none');
  svg = svg.replace(/javascript:/gi, '');
  return svg.trim();
}

/** Couleurs HEX les plus utilisées d'un SVG (fill, stroke, stop-color, style). */
export function svgPalette(svg: string, max = 4): string[] {
  const counts = new Map<string, number>();
  const re = /(?:fill|stroke|stop-color|color)\s*[:=]\s*["']?\s*(#[0-9a-f]{3}\b|#[0-9a-f]{6}\b)/gi;
  for (const m of svg.matchAll(re)) {
    let c = m[1].toUpperCase();
    if (c.length === 4) c = '#' + [...c.slice(1)].map((x) => x + x).join('');
    if (c === '#FFFFFF' || c === '#000000') continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

/** Type réel d'un fichier par signature binaire (§14.1). */
export function sniffImage(buf: Buffer): 'png' | 'svg' | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  const head = stripBom(buf.subarray(0, 1024).toString('utf8')).trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return 'svg';
  return null;
}

/** Palette d'un PNG : quantification grossière, pixels opaques, hors blanc et noir. */
export async function pngPalette(buf: Buffer, max = 4): Promise<string[]> {
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<string, number>();
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3] < 200) continue;
    const q = [data[i], data[i + 1], data[i + 2]].map((v) =>
      Math.min(255, Math.round(v / 32) * 32),
    ) as [number, number, number];
    const lum = (q[0] + q[1] + q[2]) / 3;
    if (lum > 235 || lum < 20) continue;
    const hex = rgbToHex(q);
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}
