/**
 * Signature visuelle — paraphe (SIG-20, SIG-21) : propositions en polices manuscrites sous
 * licence, ou tracé dessiné lissé puis vectorisé. Fond transparent.
 */
import { textToPath } from '../compose';
import type { RenderedLogo } from '../compose';

export const INK_COLORS = {
  blue: '#1F3A93',
  violet: '#5B2C83',
  red: '#B22222',
  black: '#111111',
} as const;
export type InkColor = keyof typeof INK_COLORS;

export const HANDWRITING_FONTS = [
  { id: 'great-vibes', weight: 400 },
  { id: 'dancing-script', weight: 600 },
  { id: 'pacifico', weight: 400 },
] as const;

export interface GeneratedHandwriting {
  mode: 'generated';
  text: string;
  fontId: string;
  weight: number;
  /** Paraphe souligné d'un trait de plume. */
  flourish: boolean;
  /** Inclinaison en degrés (négatif = penché vers la droite). */
  slant: number;
}

export interface DrawnHandwriting {
  mode: 'drawn';
  /** Tracés saisis : suites de points [x, y] dans le repère de la zone de dessin. */
  strokes: [number, number][][];
}

export type HandwritingSpec = GeneratedHandwriting | DrawnHandwriting;

/** Propositions à partir du nom : nom complet, initiale + nom, initiales (SIG-20). */
export function handwritingProposals(fullName: string): GeneratedHandwriting[] {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? fullName;
  const initials = parts.map((p) => p[0].toUpperCase()).join('');
  const short = parts.length > 1 ? `${parts[0][0].toUpperCase()}. ${last}` : last;
  const texts = [...new Set([fullName.trim(), short, initials.length > 1 ? initials : last])];

  const proposals: GeneratedHandwriting[] = [];
  for (const font of HANDWRITING_FONTS) {
    for (const [i, text] of texts.entries()) {
      proposals.push({
        mode: 'generated',
        text,
        fontId: font.id,
        weight: font.weight,
        flourish: i !== 0,
        slant: i === 2 ? -10 : -4,
      });
    }
  }
  return proposals;
}

const wrap = (w: number, h: number, body: string): RenderedLogo => ({
  width: Math.round(w),
  height: Math.round(h),
  svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" width="${Math.round(w)}" height="${Math.round(h)}">${body}</svg>`,
});

export function renderHandwriting(spec: HandwritingSpec, ink: InkColor): RenderedLogo {
  const color = INK_COLORS[ink];
  return spec.mode === 'drawn' ? renderDrawn(spec, color) : renderGenerated(spec, color);
}

function renderGenerated(spec: GeneratedHandwriting, color: string): RenderedLogo {
  const size = 120;
  const t = textToPath(spec.text, spec.fontId, spec.weight, size);
  const pad = size * 0.25;
  const skew = Math.tan((spec.slant * Math.PI) / 180);
  const extraW = Math.abs(skew) * t.box.h;
  const flourishH = spec.flourish ? size * 0.35 : 0;
  const w = t.box.w + extraW + pad * 2;
  const h = t.box.h + flourishH + pad * 2;

  // Trait de plume : courbe sous le texte, plus épaisse au centre (deux courbes fermées).
  const fx0 = pad;
  const fx1 = pad + t.box.w + extraW;
  const fy = pad + t.box.h + flourishH * 0.45;
  const thick = size * 0.035;
  const flourish = spec.flourish
    ? `<path fill="${color}" d="M${fx0} ${fy} C ${fx0 + (fx1 - fx0) * 0.3} ${fy + flourishH * 0.5}, ${fx0 + (fx1 - fx0) * 0.7} ${fy - flourishH * 0.4}, ${fx1} ${fy - flourishH * 0.2} C ${fx0 + (fx1 - fx0) * 0.7} ${fy - flourishH * 0.4 + thick}, ${fx0 + (fx1 - fx0) * 0.3} ${fy + flourishH * 0.5 + thick}, ${fx0} ${fy} Z"/>`
    : '';

  const tx = pad + (skew < 0 ? extraW : 0) - t.box.x;
  const ty = pad - t.box.y;
  return wrap(
    w,
    h,
    `<g transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) skewX(${spec.slant})"><path fill="${color}" d="${t.d}"/></g>${flourish}`,
  );
}

// ─── Tracé dessiné (SIG-21) ───

/** Lissage de Chaikin : arrondit un tracé saisi à la main. */
export function chaikin(points: [number, number][], iterations = 2): [number, number][] {
  let pts = points;
  for (let k = 0; k < iterations && pts.length > 2; k++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      next.push(
        [0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1],
        [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1],
      );
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

/** Simplification : retire les points trop proches (réduit le poids du fichier). */
function dedupe(points: [number, number][], minDist: number): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push(p);
  }
  return out;
}

function renderDrawn(spec: DrawnHandwriting, color: string): RenderedLogo {
  const all = spec.strokes.flat();
  if (all.length < 2) throw new Error('Tracé vide');
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const [minX, minY, maxX, maxY] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  const span = Math.max(maxX - minX, maxY - minY, 1);
  // Normalisation sur 600 unités de large, trait proportionnel.
  const k = 600 / span;
  const stroke = 9;
  const pad = stroke * 3;

  const paths = spec.strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const pts = chaikin(
        dedupe(
          s.map(([x, y]) => [(x - minX) * k + pad, (y - minY) * k + pad] as [number, number]),
          1.5,
        ),
      );
      if (pts.length === 1) return `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}h0.1`;
      return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L');
    });

  return wrap(
    (maxX - minX) * k + pad * 2,
    (maxY - minY) * k + pad * 2,
    `<path fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" d="${paths.join(' ')}"/>`,
  );
}
