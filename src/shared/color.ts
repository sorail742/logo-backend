/** Outils de couleur partagés (contraste WCAG, conversions pour la charte : HEX, RGB, CMJN). */

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`.toUpperCase();
}

/** Conversion CMJN naïve (sans profil ICC), indicative pour la charte. */
export function rgbToCmyk([r, g, b]: [number, number, number]): [number, number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return [0, 0, 0, 100];
  const pct = (c: number) => Math.round(((1 - c - k) / (1 - k)) * 100);
  return [pct(rr), pct(gg), pct(bb), Math.round(k * 100)];
}

export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return NaN;
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  if (Number.isNaN(la) || Number.isNaN(lb)) return NaN;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Mélange linéaire de deux couleurs (t = 0 → a, t = 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const [ra, rb] = [hexToRgb(a), hexToRgb(b)];
  if (!ra || !rb) return a;
  return rgbToHex([0, 1, 2].map((i) => ra[i] + (rb[i] - ra[i]) * t) as [number, number, number]);
}

/**
 * Renvoie `color` si son contraste avec `background` atteint `min` (4,5:1 par défaut, §5.5),
 * sinon la couleur assombrie ou éclaircie au plus près qui l'atteint.
 */
export function ensureContrast(color: string, background: string, min = 4.5): string {
  if (contrastRatio(color, background) >= min) return color.toUpperCase();
  const target = relativeLuminance(background) > 0.18 ? '#000000' : '#FFFFFF';
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidate = mix(color, target, t);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return target;
}
