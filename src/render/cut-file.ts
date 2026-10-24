import ClipperLib from 'clipper-lib';
import { textGlyphs } from './design';
import type { PrintPiece } from './apparel-print';
import type { SheetPage } from './gang-sheet';

// Fichiers de découpe du flex et du flocage (cahier des charges §16.7) : contours fermés, un
// calque par couleur de film, sans image ni dégradé. Le texte devient des polygones (courbes
// aplaties au 1/50 de mm), réunis par couleur ; le contour d'un numéro est le texte élargi de son
// épaisseur (décalage arrondi, Clipper), découpé dans son propre film et posé sous le remplissage.

type Point = [number, number];
export type Polygon = Point[];

/** Calque de découpe d'une couleur de film : polygones dans le repère de la pièce (mm). */
export interface CutLayer {
  color: string;
  polygons: Polygon[];
}

const SCALE = 1000; // Clipper travaille en entiers : 1 unité = 1 µm.
const TOLERANCE = 0.02; // Aplatissement des courbes, en mm.

const n = (value: number) => Math.round(value * 1000) / 1000;

// ─── Tracés SVG → polygones ───

/** Commandes d'un tracé produit par opentype (M, L, Q, C, Z en coordonnées absolues). */
function tokens(d: string) {
  return d.match(/[MLQCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
}

function segments(length: number) {
  return Math.max(2, Math.min(64, Math.ceil(length / (TOLERANCE * 40))));
}

/** Point d'une courbe de Bézier (quadratique ou cubique) au paramètre t, par de Casteljau. */
function bezier(controls: Point[], t: number): Point {
  let points = controls;
  while (points.length > 1) {
    const previous = points;
    points = previous
      .slice(1)
      .map(([x, y], k) => [
        previous[k][0] + (x - previous[k][0]) * t,
        previous[k][1] + (y - previous[k][1]) * t,
      ]);
  }
  return points[0];
}

/** Ajoute une courbe aplatie (depuis le dernier point) au polygone en cours. */
function flatten(current: Polygon, controls: Point[]) {
  let length = 0;
  for (let k = 1; k < controls.length; k++) {
    length += Math.hypot(controls[k][0] - controls[k - 1][0], controls[k][1] - controls[k - 1][1]);
  }
  const steps = segments(length);
  for (let s = 1; s <= steps; s++) current.push(bezier(controls, s / steps));
}

/** Nombre de valeurs lues par commande. */
const ARITY: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const COMMAND = /^[MLQCZ]$/i;

/** Polygones d'un tracé (courbes de Bézier aplaties). */
export function pathPolygons(d: string): Polygon[] {
  const list = tokens(d);
  const polygons: Polygon[] = [];
  let current: Polygon = [];
  const close = () => {
    if (current.length > 2) polygons.push(current);
    current = [];
  };
  let command = '';
  let i = 0;
  while (i < list.length) {
    const explicit = COMMAND.test(list[i]);
    if (explicit) {
      command = list[i].toUpperCase();
      i += 1;
    }
    const arity = ARITY[command] ?? 0;
    // Valeur orpheline (après Z, ou avant toute commande) : ignorée.
    if (!arity && !explicit) {
      i += 1;
      continue;
    }
    const values = list.slice(i, i + arity).map(Number);
    i += arity;
    const points: Point[] = [];
    for (let k = 0; k < values.length; k += 2) points.push([values[k], values[k + 1]]);
    if (command === 'M') {
      close();
      current = [points[0]];
      // Les paires suivantes d'un M sont des L implicites.
      command = 'L';
    } else if (command === 'L') {
      current.push(points[0]);
    } else if (command === 'Z') {
      close();
    } else {
      flatten(current, [current.at(-1) ?? [0, 0], ...points]);
    }
  }
  close();
  return polygons;
}

// ─── Transformations ───

type Matrix = [number, number, number, number, number, number];

const multiply = (m: Matrix, k: Matrix): Matrix => [
  m[0] * k[0] + m[2] * k[1],
  m[1] * k[0] + m[3] * k[1],
  m[0] * k[2] + m[2] * k[3],
  m[1] * k[2] + m[3] * k[3],
  m[0] * k[4] + m[2] * k[5] + m[4],
  m[1] * k[4] + m[3] * k[5] + m[5],
];
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const rotate = (deg: number): Matrix => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
};
const scale = (sx: number, sy: number): Matrix => [sx, 0, 0, sy, 0, 0];
const apply = (m: Matrix, [x, y]: Point): Point => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

// ─── Booléens et décalages (Clipper) ───

const toClipper = (polygons: Polygon[]) =>
  polygons.map((poly) =>
    poly.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })),
  );
const fromClipper = (paths: { X: number; Y: number }[][]): Polygon[] =>
  paths.map((path) => path.map(({ X, Y }) => [X / SCALE, Y / SCALE] as Point));

/** Réunion des polygones (règle non nulle, comme le remplissage des glyphes). */
export function union(polygons: Polygon[]): Polygon[] {
  if (!polygons.length) return [];
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(toClipper(polygons), ClipperLib.PolyType.ptSubject, true);
  const solution: { X: number; Y: number }[][] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return fromClipper(solution);
}

/** Polygones élargis de `delta` mm (angles arrondis), réunis. */
export function inflate(polygons: Polygon[], delta: number): Polygon[] {
  if (!polygons.length || delta <= 0) return polygons;
  const offset = new ClipperLib.ClipperOffset(2, TOLERANCE * SCALE);
  offset.AddPaths(
    toClipper(polygons),
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  const solution: { X: number; Y: number }[][] = [];
  offset.Execute(solution, delta * SCALE);
  return fromClipper(solution);
}

// ─── Calques d'une pièce ───

type TextElement = Extract<PrintPiece['elements'][number]['el'], { type: 'text' }>;

/** Ce qui ne se découpe pas dans un texte : dégradé, liseré, trame, texture, relief. */
function textSkipped(el: TextElement) {
  const skipped: string[] = [];
  if (el.fill.type !== 'solid') {
    skipped.push(`dégradé du texte « ${el.text} » (le flex est d’une seule couleur)`);
  }
  const e = el.effects;
  if ([e?.inline, e?.halftone, e?.pattern, e?.extrude, e?.glow].some(Boolean)) {
    skipped.push(
      `effets du texte « ${el.text} » (liseré, trame, texture, bandes, relief ou néon : non découpables)`,
    );
  }
  return skipped;
}

/** Glyphes d'un texte réunis, dans le repère de la pièce (centre, rotation, condensation). */
function textBody(el: TextElement, scaleX: number) {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const base = multiply(
    multiply(multiply(translate(cx, cy), rotate(el.rotation ?? 0)), scale(scaleX, 1)),
    translate(-el.width / 2, -el.height / 2),
  );
  const glyphs = textGlyphs(el).flatMap(({ d, at }) => {
    const m = at ? multiply(base, multiply(translate(at.x, at.y), rotate(at.deg))) : base;
    return pathPolygons(d).map((poly) => poly.map((p) => apply(m, p)));
  });
  return union(glyphs);
}

/** Films d'un texte : remplissage, contour et second contour (texte élargi de leur épaisseur). */
function textLayers(el: TextElement, scaleX: number): CutLayer[] {
  const body = textBody(el, scaleX);
  const layers: CutLayer[] = [
    { color: el.fill.type === 'solid' ? el.fill.color : '#111111', polygons: body },
  ];
  const stroke = el.stroke?.width ? el.stroke : null;
  if (stroke) layers.push({ color: stroke.color, polygons: inflate(body, stroke.width) });
  const outline2 = el.effects?.outline2;
  if (outline2?.width) {
    const width = (stroke?.width ?? 0) + outline2.width;
    layers.push({ color: outline2.color, polygons: inflate(body, width) });
  }
  return layers;
}

const NOT_CUTTABLE: Record<string, string> = {
  image: 'photo (impossible à découper : utiliser le DTF ou le papier transfert)',
  svg: 'logo (à vectoriser par couleur dans le logiciel de découpe)',
};

/**
 * Calques de découpe d'une pièce : pour chaque texte, le remplissage, puis son contour et son
 * second contour (texte élargi). Logos, photos et effets non découpables sont signalés.
 */
export function pieceCutLayers(piece: PrintPiece): { layers: CutLayer[]; skipped: string[] } {
  const byColor = new Map<string, Polygon[]>();
  const skipped: string[] = [];
  for (const { el, scaleX } of piece.elements) {
    if (el.type !== 'text') {
      if (NOT_CUTTABLE[el.type]) skipped.push(NOT_CUTTABLE[el.type]);
      continue;
    }
    skipped.push(...textSkipped(el));
    for (const { color, polygons } of textLayers(el, scaleX)) {
      const key = color.toLowerCase();
      byColor.set(key, [...(byColor.get(key) ?? []), ...polygons]);
    }
  }
  const layers = [...byColor.entries()].map(([color, polygons]) => ({
    color,
    polygons: union(polygons),
  }));
  return { layers, skipped: [...new Set(skipped)] };
}

// ─── Écriture ───

/** Polygones d'une couleur posés sur une planche (placement, rotation, miroir). */
export function sheetPolygons(
  sheet: SheetPage,
  layersOf: (piece: PrintPiece) => CutLayer[],
  color: string,
  mirror: boolean,
): Polygon[] {
  const out: Polygon[] = [];
  for (const p of sheet.placements) {
    const layer = layersOf(p.piece).find((l) => l.color === color);
    if (!layer) continue;
    let m: Matrix = p.rotated
      ? multiply(translate(p.x + p.piece.heightMm, p.y), rotate(90))
      : translate(p.x, p.y);
    if (mirror) m = multiply(multiply(translate(sheet.widthMm, 0), scale(-1, 1)), m);
    for (const poly of layer.polygons) out.push(poly.map((pt) => apply(m, pt)));
  }
  return out;
}

const pointText = ([x, y]: Point) => `${n(x)} ${n(y)}`;
const pathData = (polygons: Polygon[]) =>
  polygons.map((poly) => `M${poly.map(pointText).join('L')}Z`).join('');

/** Fichier de découpe SVG (mm) : contours fermés, aperçu de la couleur du film. */
export function cutSvg(widthMm: number, heightMm: number, polygons: Polygon[], color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMm} ${heightMm}" width="${widthMm}mm" height="${heightMm}mm"><path d="${pathData(polygons)}" fill="${color}" fill-rule="nonzero" stroke="#000000" stroke-width="0.1"/></svg>`;
}

/**
 * Fichier DXF R12 (unités : mm) : une polyligne fermée par contour, sur un calque nommé d'après
 * la couleur ; l'axe Y du DXF monte, la page est donc retournée.
 */
export function cutDxf(heightMm: number, polygons: Polygon[], layer: string) {
  const lines: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '0',
    'ENDSEC',
  ];
  lines.push('0', 'SECTION', '2', 'ENTITIES');
  for (const poly of polygons) {
    lines.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
    for (const [x, y] of poly)
      lines.push('0', 'VERTEX', '8', layer, '10', String(n(x)), '20', String(n(heightMm - y)));
    lines.push('0', 'SEQEND', '8', layer);
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}
