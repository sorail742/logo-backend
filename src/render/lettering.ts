import { z } from 'zod';
import { HEX_COLOR } from './color';

// Effets de lettrage des maillots et des affiches (même contrat et même rendu que le front,
// src/lib/studio/lettering.ts) : relief, second contour (cranté ou non), contour, remplissage,
// texture (rayures, carbone, usé, griffes), trame de points et liseré intérieur (une ou plusieurs
// lignes), dessinés en calques vectoriels autour d'un même groupe de glyphes (`<use>`), découpés à
// la forme des lettres. Rendu identique navigateur (texte) et serveur (tracés).

const color = z.string().regex(HEX_COLOR, 'Couleur attendue au format #rrggbb');
const num = (min: number, max: number) => z.number().finite().min(min).max(max);

export const PATTERN_KINDS = ['stripes', 'carbon', 'distressed', 'claws'] as const;

export const textEffectsSchema = z.object({
  /** Second contour, autour du contour (style universitaire) ; `notched` : bord cranté. */
  outline2: z
    .object({ color, width: num(0, 1000), notched: z.boolean().optional() })
    .nullable()
    .optional(),
  /** Liseré intérieur : `lines` traits de `width` (séparés de `gap`), le premier à `inset` du bord. */
  inline: z
    .object({
      color,
      width: num(0, 1000),
      inset: num(0, 1000),
      lines: z.number().int().min(1).max(6).optional(),
      gap: num(0, 1000).optional(),
    })
    .nullable()
    .optional(),
  /** Relief : lettres répétées sur `depth` vers `angle` (degrés, 0 = droite, 90 = bas). */
  extrude: z
    .object({ color, depth: num(0, 2000), angle: num(-360, 360) })
    .nullable()
    .optional(),
  /** Trame de points dans les lettres, grossissant vers `angle` ; `size` : pas de la grille. */
  halftone: z
    .object({ color, size: num(0.5, 1000), angle: num(-360, 360) })
    .nullable()
    .optional(),
  /** Texture dans les lettres : rayures, carbone, usé, griffes ; `size` : pas ou largeur. */
  pattern: z
    .object({ color, kind: z.enum(PATTERN_KINDS), size: num(0.5, 1000), angle: num(-360, 360) })
    .nullable()
    .optional(),
});
export type TextEffects = z.infer<typeof textEffectsSchema>;

const n = (value: number) => Math.round(value * 100) / 100;

/** Points au-delà desquels la grille de la trame est élargie (poids du fichier). */
const MAX_DOTS = 6000;
/** Copies au plus pour le relief. */
const MAX_EXTRUDE_STEPS = 48;
/** Graine des textures : même dessin au navigateur et au serveur. */
const TEXTURE_SEED = 7;

export interface LetteringInput {
  /** Préfixe des identifiants (unique dans le document). */
  pid: string;
  /** Glyphes sans peinture : `<text>` du navigateur ou tracés du serveur. */
  glyphs: string;
  /** Valeur de `fill` (couleur ou `url(#…)`). */
  fill: string;
  stroke?: { color: string; width: number } | null;
  effects: TextEffects;
  /** Zone couverte par les lettres (repère de l'élément). */
  box: { x: number; y: number; width: number; height: number };
  /** Corps du texte (pas du relief). */
  size: number;
  defs: string[];
}

type Box = LetteringInput['box'];

export function hasEffects(effects: TextEffects | null | undefined): effects is TextEffects {
  return [
    effects?.outline2,
    effects?.inline,
    effects?.extrude,
    effects?.halftone,
    effects?.pattern,
  ].some(Boolean);
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points de la trame : grille en quinconce, rayon croissant dans la direction de l'angle. */
export function halftoneDots(box: Box, halftone: NonNullable<TextEffects['halftone']>) {
  const area = Math.max(1, box.width * box.height);
  const step = Math.max(halftone.size, Math.sqrt(area / MAX_DOTS));
  const rowStep = step * 0.866;
  const angle = (halftone.angle * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([x, y]) => x * ux + y * uy);
  const min = Math.min(...corners);
  const span = Math.max(1e-6, Math.max(...corners) - min);
  const dots: string[] = [];
  for (let row = 0; box.y + row * rowStep <= box.y + box.height + step; row++) {
    const y = box.y + row * rowStep;
    const shift = row % 2 ? step / 2 : 0;
    for (let x = box.x - shift; x <= box.x + box.width + step; x += step) {
      const t = (x * ux + y * uy - min) / span;
      const r = Math.min(1, Math.max(0, t)) * step * 0.62;
      if (r >= step * 0.06) dots.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"/>`);
    }
  }
  return dots.join('');
}

// ─── Textures (rayures, carbone, usé, griffes) ───

/** Pas d'une grille de `size`, élargi pour ne pas dépasser `limit` cellules. */
const gridStep = (box: Box, size: number, limit: number) =>
  Math.max(size, Math.sqrt(Math.max(1, box.width * box.height) / limit));

/** Rayures parallèles d'épaisseur moitié du pas, inclinées de `angle`. */
function stripes(box: Box, size: number, angle: number) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const half = Math.hypot(box.width, box.height) / 2 + size;
  const step = Math.max(size, (half * 2) / 400);
  const bars: string[] = [];
  for (let y = -half; y <= half; y += step) {
    bars.push(
      `<rect x="${n(cx - half)}" y="${n(cy + y)}" width="${n(half * 2)}" height="${n(step * 0.5)}"/>`,
    );
  }
  return `<g transform="rotate(${n(angle)} ${n(cx)} ${n(cy)})">${bars.join('')}</g>`;
}

/** Tissage façon fibre de carbone : barres alternées horizontales et verticales. */
function carbon(box: Box, size: number) {
  const step = gridStep(box, size, 4000);
  const cells: string[] = [];
  for (let i = 0; i * step < box.width + step; i++) {
    for (let j = 0; j * step < box.height + step; j++) {
      const x = box.x + i * step;
      const y = box.y + j * step;
      cells.push(
        (i + j) % 2 === 0
          ? `<rect x="${n(x + step * 0.05)}" y="${n(y + step * 0.1)}" width="${n(step * 0.9)}" height="${n(step * 0.35)}"/>`
          : `<rect x="${n(x + step * 0.1)}" y="${n(y + step * 0.05)}" width="${n(step * 0.35)}" height="${n(step * 0.9)}"/>`,
      );
    }
  }
  return cells.join('');
}

/** Éclats irréguliers semés au hasard (déterministe) : aspect usé, vintage. */
function distressed(box: Box, size: number) {
  const random = seeded(TEXTURE_SEED);
  const area = Math.max(1, box.width * box.height);
  const count = Math.min(2500, Math.round((area / (size * size)) * 0.6));
  const specks: string[] = [];
  for (let k = 0; k < count; k++) {
    const cx = box.x + random() * box.width;
    const cy = box.y + random() * box.height;
    const r = size * (0.08 + random() * 0.32);
    const points = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2 + random();
      const d = r * (0.55 + random() * 0.45);
      return `${n(cx + Math.cos(a) * d)},${n(cy + Math.sin(a) * d)}`;
    });
    specks.push(`<polygon points="${points.join(' ')}"/>`);
  }
  return specks.join('');
}

/** Trois griffures effilées qui traversent les lettres dans la direction de `angle`. */
function claws(box: Box, size: number, angle: number) {
  const a = (angle * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const vx = -uy;
  const vy = ux;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // Griffure à peu près de la hauteur des lettres : pointes effilées visibles.
  const length = Math.min(Math.hypot(box.width, box.height) * 0.7, box.height * 0.95);
  const samples = 12;
  const slashes = [-1, 0, 1].map((k) => {
    const offset = k * size * 1.4;
    const side = (sign: number) =>
      Array.from({ length: samples + 1 }, (_, i) => {
        const t = i / samples;
        const along = (t - 0.5) * length;
        const bend = Math.sin(Math.PI * t) * size * 0.6;
        const half = size * 0.42 * Math.sin(Math.PI * t);
        const x = cx + ux * along + vx * (offset + bend + sign * half);
        const y = cy + uy * along + vy * (offset + bend + sign * half);
        return `${n(x)} ${n(y)}`;
      });
    const left = side(1);
    const right = side(-1).reverse();
    return `<path d="M${left.join('L')}L${right.join('L')}Z"/>`;
  });
  return slashes.join('');
}

/** Formes d'une texture, dans la zone des lettres. */
export function patternShapes(box: Box, pattern: NonNullable<TextEffects['pattern']>) {
  switch (pattern.kind) {
    case 'stripes':
      return stripes(box, pattern.size, pattern.angle);
    case 'carbon':
      return carbon(box, pattern.size);
    case 'distressed':
      return distressed(box, pattern.size);
    case 'claws':
      return claws(box, pattern.size, pattern.angle);
    default:
      return '';
  }
}

// ─── Calques ───

const ROUND = 'stroke-linejoin="round" stroke-linecap="round"';

/** Relief : copies décalées, de la plus profonde à la plus proche. */
function extrudeLayers(
  ref: string,
  extrude: NonNullable<TextEffects['extrude']>,
  outer: number,
  size: number,
) {
  const angle = (extrude.angle * Math.PI) / 180;
  const steps = Math.min(
    MAX_EXTRUDE_STEPS,
    Math.max(1, Math.ceil(extrude.depth / Math.max(0.5, size * 0.015))),
  );
  const width =
    outer > 0 ? ` stroke="${extrude.color}" stroke-width="${n(outer * 2)}" ${ROUND}` : '';
  const layers: string[] = [];
  for (let i = steps; i >= 1; i--) {
    const d = (extrude.depth * i) / steps;
    const shift = `translate(${n(Math.cos(angle) * d)} ${n(Math.sin(angle) * d)})`;
    layers.push(`<use ${ref} transform="${shift}" fill="${extrude.color}"${width}/>`);
  }
  return layers.join('');
}

/** Contour : trait centré sur le bord, dont la moitié `halfWidth` dépasse des lettres. */
const outlineLayer = (ref: string, color: string, halfWidth: number) =>
  `<use ${ref} fill="${color}" stroke="${color}" stroke-width="${n(halfWidth * 2)}" ${ROUND}/>`;

/** Contour cranté : trait en tirets à angles vifs, créneaux sur le bord extérieur. */
function notchedLayer(ref: string, color: string, halfWidth: number, notch: number) {
  const dash = `${n(Math.max(notch, 0.5) * 1.6)} ${n(Math.max(notch, 0.5))}`;
  return `<use ${ref} fill="${color}" stroke="${color}" stroke-width="${n(halfWidth * 2)}" stroke-dasharray="${dash}" stroke-linejoin="miter" stroke-linecap="butt"/>`;
}

/**
 * Liseré : `lines` anneaux de `width`, le premier à `inset` du bord, séparés de `gap` (masque :
 * pour chaque anneau, du plus profond au plus proche du bord, blanc jusqu'à son bord intérieur
 * puis noir jusqu'à son bord extérieur).
 */
function inlineLayer(
  ref: string,
  pid: string,
  inline: NonNullable<TextEffects['inline']>,
  rect: string,
  defs: string[],
) {
  const lines = Math.max(1, Math.round(inline.lines ?? 1));
  const gap = inline.gap ?? inline.width;
  const rings: string[] = [];
  for (let k = lines - 1; k >= 0; k--) {
    const inset = inline.inset + k * (inline.width + gap);
    rings.push(
      `<use ${ref} fill="none" stroke="#fff" stroke-width="${n((inset + inline.width) * 2)}" ${ROUND}/>`,
    );
    if (inset > 0) {
      rings.push(`<use ${ref} fill="none" stroke="#000" stroke-width="${n(inset * 2)}" ${ROUND}/>`);
    }
  }
  defs.push(`<mask id="${pid}-inline" maskUnits="userSpaceOnUse" ${rect}>${rings.join('')}</mask>`);
  return `<g clip-path="url(#${pid}-clip)"><rect ${rect} fill="${inline.color}" mask="url(#${pid}-inline)"/></g>`;
}

/** Calques d'un texte avec effets, du fond vers le dessus. */
export function letteringLayers(input: LetteringInput) {
  const { pid, effects, box, defs } = input;
  const ref = `href="#${pid}-g"`;
  const outline = input.stroke && input.stroke.width > 0 ? input.stroke : null;
  const inner = outline?.width ?? 0;
  const outer = inner + (effects.outline2?.width ?? 0);
  const pad = outer * 2 + (effects.extrude?.depth ?? 0) + input.size;
  const rect = `x="${n(box.x - pad)}" y="${n(box.y - pad)}" width="${n(box.width + pad * 2)}" height="${n(box.height + pad * 2)}"`;
  const { extrude, outline2, halftone, inline, pattern } = effects;
  defs.push(`<g id="${pid}-g">${input.glyphs}</g>`);
  if (halftone || inline || pattern) {
    // Un clipPath ne peut pas viser un groupe par <use> : glyphes recopiés.
    defs.push(`<clipPath id="${pid}-clip">${input.glyphs}</clipPath>`);
  }
  const clipped = (color: string, shapes: string) =>
    `<g clip-path="url(#${pid}-clip)" fill="${color}">${shapes}</g>`;
  let second = '';
  if (outline2 && outline2.width > 0) {
    second = outline2.notched
      ? notchedLayer(ref, outline2.color, outer, outline2.width)
      : outlineLayer(ref, outline2.color, outer);
  }
  return [
    extrude && extrude.depth > 0 ? extrudeLayers(ref, extrude, outer, input.size) : '',
    second,
    outline ? outlineLayer(ref, outline.color, inner) : '',
    `<use ${ref} fill="${input.fill}"/>`,
    pattern ? clipped(pattern.color, patternShapes(box, pattern)) : '',
    halftone ? clipped(halftone.color, halftoneDots(box, halftone)) : '',
    inline && inline.width > 0 ? inlineLayer(ref, pid, inline, rect, defs) : '',
  ].join('');
}
