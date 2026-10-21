/**
 * Cachet (SIG-22 à SIG-24) : rond, ovale ou rectangulaire ; texte le long du bord (nom en haut,
 * ville et pays en bas) ; centre avec sigle, qualité ou icône ; couleur et effet d'encre.
 * Tout le texte est en tracés : fichiers prêts pour la fabrication d'un tampon.
 */
import { loadFont } from '../assets';
import { iconMarkup } from '../assets';
import { textToPath } from '../compose';
import type { RenderedLogo } from '../compose';
import { INK_COLORS, InkColor } from './handwritten';

export const STAMP_SHAPES = ['round', 'oval', 'rect'] as const;
export type StampShape = (typeof STAMP_SHAPES)[number];

export interface StampSpec {
  shape: StampShape;
  /** Texte du haut (nom de la structure). */
  topText: string;
  /** Texte du bas (ville, pays). */
  bottomText?: string | null;
  /** Centre : sigle, icône de la bibliothèque, ou rien. */
  center: { kind: 'acronym'; text: string } | { kind: 'icon'; iconId: string } | { kind: 'none' };
  /** Qualité du signataire (« Le Président »), sous le centre. */
  title?: string | null;
  ink: InkColor;
  inkEffect: boolean;
  fontId: string;
}

/** Textes du cachet soumis à la liste des termes officiels (§6.4). */
export function stampTexts(spec: StampSpec): string[] {
  return [
    spec.topText,
    spec.bottomText ?? '',
    spec.title ?? '',
    spec.center.kind === 'acronym' ? spec.center.text : '',
  ].filter(Boolean);
}

interface Pt {
  x: number;
  y: number;
}

/** Polyligne échantillonnée d'un arc d'ellipse, avec longueurs cumulées. */
function ellipseArc(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  steps = 720,
) {
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return { pts, cum, length: cum[cum.length - 1] };
}

function pointAt(arc: ReturnType<typeof ellipseArc>, s: number): { p: Pt; angle: number } {
  let i = arc.cum.findIndex((c) => c >= s);
  if (i <= 0) i = 1;
  const [a, b] = [arc.pts[i - 1], arc.pts[i]];
  const seg = arc.cum[i] - arc.cum[i - 1] || 1;
  const t = (s - arc.cum[i - 1]) / seg;
  return {
    p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}

/** Pose chaque glyphe sur l'arc, centré, en réduisant la taille si le texte est trop long. */
function textOnArc(
  text: string,
  fontId: string,
  size: number,
  arc: ReturnType<typeof ellipseArc>,
  color: string,
): string {
  const font = loadFont(fontId, 700);
  const tracking = 0.12;
  const measure = (sz: number) => {
    const scale = sz / font.unitsPerEm;
    const glyphs = font.stringToGlyphs(text);
    const advances = glyphs.map((g) => (g.advanceWidth ?? 0) * scale + tracking * sz);
    return { glyphs, advances, total: advances.reduce((a, b) => a + b, 0) - tracking * sz };
  };
  let sz = size;
  let m = measure(sz);
  const maxLen = arc.length * 0.9;
  if (m.total > maxLen) {
    sz = (size * maxLen) / m.total;
    m = measure(sz);
  }

  let s = (arc.length - m.total) / 2;
  const parts: string[] = [];
  m.glyphs.forEach((g, i) => {
    const adv = m.advances[i];
    const { p, angle } = pointAt(arc, s + adv / 2);
    const d = g.getPath(0, 0, sz).toPathData(2);
    if (d)
      parts.push(
        `<path transform="translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${angle.toFixed(2)}) translate(${(-(adv - tracking * sz) / 2).toFixed(2)} 0)" d="${d}"/>`,
      );
    s += adv;
  });
  return `<g fill="${color}">${parts.join('')}</g>`;
}

/** Texte droit centré, réduit pour tenir dans `maxW`. */
function straightText(
  text: string,
  fontId: string,
  size: number,
  cx: number,
  baselineY: number,
  maxW: number,
  color: string,
): string {
  const t = textToPath(text, fontId, 700, size, 0.08);
  const k = Math.min(1, maxW / t.box.w);
  const tx = cx - (t.box.w * k) / 2 - t.box.x * k;
  return `<path fill="${color}" transform="translate(${tx.toFixed(2)} ${baselineY.toFixed(2)}) scale(${k.toFixed(4)})" d="${t.d}"/>`;
}

function centerBlock(
  spec: StampSpec,
  cx: number,
  cy: number,
  maxW: number,
  maxH: number,
  color: string,
): string {
  const out: string[] = [];
  const hasTitle = !!spec.title;
  const mainH = hasTitle ? maxH * 0.62 : maxH;
  const mainCy = hasTitle ? cy - maxH * 0.16 : cy;

  if (spec.center.kind === 'acronym' && spec.center.text) {
    const t = textToPath(spec.center.text.toUpperCase(), spec.fontId, 700, 100, 0.04);
    const k = Math.min(maxW / t.box.w, (mainH * 0.7) / t.box.h);
    out.push(
      `<path fill="${color}" transform="translate(${(cx - (t.box.w * k) / 2 - t.box.x * k).toFixed(2)} ${(mainCy - (t.box.h * k) / 2 - t.box.y * k).toFixed(2)}) scale(${k.toFixed(4)})" d="${t.d}"/>`,
    );
  } else if (spec.center.kind === 'icon') {
    const s = Math.min(maxW, mainH) * 0.8;
    out.push(
      `<g transform="translate(${(cx - s / 2).toFixed(2)} ${(mainCy - s / 2).toFixed(2)}) scale(${(s / 24).toFixed(4)})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(spec.center.iconId)}</g>`,
    );
  }
  if (hasTitle)
    out.push(straightText(spec.title!, spec.fontId, 34, cx, cy + maxH * 0.42, maxW, color));
  return out.join('');
}

/** Effet d'encre : légère irrégularité du tracé et manques aléatoires. */
const INK_FILTER = `<filter id="ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  3.2 0 0 0 -1.05" result="mask"/><feComposite in="SourceGraphic" in2="mask" operator="in" result="speckled"/><feDisplacementMap in="speckled" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G"/></filter>`;

export function renderStamp(spec: StampSpec): RenderedLogo {
  const color = INK_COLORS[spec.ink];
  let w: number;
  let h: number;
  let body: string;

  if (spec.shape === 'rect') {
    w = 640;
    h = 380;
    const inset = 26;
    body =
      `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="10" fill="none" stroke="${color}" stroke-width="9"/>` +
      `<rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" rx="6" fill="none" stroke="${color}" stroke-width="3"/>` +
      straightText(
        spec.topText.toUpperCase(),
        spec.fontId,
        40,
        w / 2,
        inset + 58,
        w - inset * 2 - 40,
        color,
      ) +
      `<line x1="${inset + 30}" y1="${inset + 78}" x2="${w - inset - 30}" y2="${inset + 78}" stroke="${color}" stroke-width="2"/>` +
      centerBlock(spec, w / 2, h / 2 + 14, w - inset * 2 - 80, 150, color) +
      (spec.bottomText
        ? `<line x1="${inset + 30}" y1="${h - inset - 64}" x2="${w - inset - 30}" y2="${h - inset - 64}" stroke="${color}" stroke-width="2"/>` +
          straightText(
            spec.bottomText.toUpperCase(),
            spec.fontId,
            30,
            w / 2,
            h - inset - 24,
            w - inset * 2 - 40,
            color,
          )
        : '');
  } else {
    const oval = spec.shape === 'oval';
    w = oval ? 680 : 520;
    h = oval ? 460 : 520;
    const [cx, cy] = [w / 2, h / 2];
    const [rx1, ry1] = [w / 2 - 10, h / 2 - 10]; // anneau extérieur
    const band = 66;
    const [rx2, ry2] = [rx1 - band, ry1 - band]; // anneau intérieur
    const cap = band * 0.5;
    const gap = (band - cap) / 2;

    // Haut : ligne de base côté intérieur, lettres vers l'extérieur ; bas : l'inverse, lettres droites.
    const top = ellipseArc(cx, cy, rx2 + gap + 4, ry2 + gap + 4, Math.PI * 1.08, Math.PI * 1.92);
    const bottom = ellipseArc(cx, cy, rx1 - gap - 4, ry1 - gap - 4, Math.PI * 0.92, Math.PI * 0.08);
    const sep = (t: number) => {
      const r = (rx1 + rx2) / 2;
      const ry = (ry1 + ry2) / 2;
      return `<circle cx="${(cx + r * Math.cos(t)).toFixed(1)}" cy="${(cy + ry * Math.sin(t)).toFixed(1)}" r="6" fill="${color}"/>`;
    };

    body =
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx1}" ry="${ry1}" fill="none" stroke="${color}" stroke-width="9"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx2}" ry="${ry2}" fill="none" stroke="${color}" stroke-width="3"/>` +
      textOnArc(spec.topText.toUpperCase(), spec.fontId, cap, top, color) +
      (spec.bottomText
        ? textOnArc(spec.bottomText.toUpperCase(), spec.fontId, cap * 0.85, bottom, color) +
          sep(Math.PI) +
          sep(0)
        : '') +
      centerBlock(spec, cx, cy, rx2 * 1.3, ry2 * 1.25, color);
  }

  const content = spec.inkEffect
    ? `<defs>${INK_FILTER}</defs><g filter="url(#ink)" opacity="0.93">${body}</g>`
    : body;
  return {
    width: w,
    height: h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${content}</svg>`,
  };
}
