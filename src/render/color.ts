// Couleurs et contraste (§5.5). Mêmes règles que l'aperçu du front (src/lib/render/color.ts).

export type LogoStyle = 'MINIMAL' | 'MODERN' | 'CLASSIC' | 'INSTITUTIONAL' | 'PLAYFUL' | 'AFRICAN';

export interface LogoColors {
  primary: string;
  secondary: string;
  text: string;
  background: string;
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function normalizeHex(hex: string) {
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value.toLowerCase()}` : '#000000';
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((i) => Number.parseInt(value.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

export function rgbToHex(r: number, g: number, b: number) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function channel(v: number) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Ratio de contraste WCAG entre deux couleurs. */
export function contrastRatio(a: string, b: string) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export function mix(a: string, b: string, amount: number) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(...(ca.map((v, i) => v + (cb[i] - v) * amount) as [number, number, number]));
}

/** Assombrit ou éclaircit la couleur jusqu'à atteindre le ratio voulu (4,5:1 par défaut, §5.5). */
export function ensureContrast(color: string, background: string, ratio = 4.5) {
  if (contrastRatio(color, background) >= ratio) return normalizeHex(color);
  const target = luminance(background) > 0.5 ? '#000000' : '#ffffff';
  for (let step = 0.05; step <= 1; step += 0.05) {
    const candidate = mix(color, target, step);
    if (contrastRatio(candidate, background) >= ratio) return candidate;
  }
  return target;
}

export function readableOn(background: string) {
  return contrastRatio('#ffffff', background) >= contrastRatio('#111111', background)
    ? '#ffffff'
    : '#111111';
}

/** Palettes proposées par style (LOGO-03) : primaire, secondaire, texte, fond. */
export const STYLE_PALETTES: Record<LogoStyle, LogoColors[]> = {
  MINIMAL: [
    { primary: '#111827', secondary: '#6b7280', text: '#111827', background: '#ffffff' },
    { primary: '#0f766e', secondary: '#99f6e4', text: '#0f172a', background: '#ffffff' },
  ],
  MODERN: [
    { primary: '#4f46e5', secondary: '#06b6d4', text: '#0f172a', background: '#ffffff' },
    { primary: '#e11d48', secondary: '#f59e0b', text: '#1f2937', background: '#ffffff' },
    { primary: '#7c3aed', secondary: '#22c55e', text: '#111827', background: '#ffffff' },
  ],
  CLASSIC: [
    { primary: '#7c2d12', secondary: '#b45309', text: '#1c1917', background: '#fffbeb' },
    { primary: '#1e3a8a', secondary: '#a16207', text: '#111827', background: '#ffffff' },
  ],
  INSTITUTIONAL: [
    { primary: '#1d4ed8', secondary: '#15803d', text: '#0f172a', background: '#ffffff' },
    { primary: '#166534', secondary: '#ca8a04', text: '#052e16', background: '#ffffff' },
  ],
  PLAYFUL: [
    { primary: '#f97316', secondary: '#8b5cf6', text: '#1f2937', background: '#ffffff' },
    { primary: '#ec4899', secondary: '#14b8a6', text: '#111827', background: '#ffffff' },
  ],
  AFRICAN: [
    { primary: '#ce1126', secondary: '#fcd116', text: '#14532d', background: '#fffdf5' },
    { primary: '#b45309', secondary: '#15803d', text: '#1c1917', background: '#fff7ed' },
    { primary: '#009460', secondary: '#e9a400', text: '#3b1d0a', background: '#ffffff' },
  ],
};

/** Palette à partir de 2 à 4 couleurs choisies par l'utilisateur (LOGO-03). */
export function paletteFromList(palette: string[]): LogoColors {
  return {
    primary: normalizeHex(palette[0]),
    secondary: normalizeHex(palette[1] ?? palette[0]),
    text: normalizeHex(palette[2] ?? '#111827'),
    background: normalizeHex(palette[3] ?? '#ffffff'),
  };
}

/**
 * Couleurs dominantes de pixels RGBA (LOGO-07) : regroupement grossier, fond quasi blanc
 * et pixels transparents ignorés, couleurs trop proches fusionnées.
 */
export function extractPalette(data: Uint8Array | Uint8ClampedArray, count = 4): string[] {
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 3 < data.length; i += 16) {
    if (data[i + 3] < 128) continue;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (r > 245 && g > 245 && b > 245) continue;
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }
  const result: string[] = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.n - a.n)) {
    const hex = rgbToHex(bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n);
    if (result.every((existing) => contrastRatio(existing, hex) > 1.4)) result.push(hex);
    if (result.length === count) break;
  }
  return result;
}
