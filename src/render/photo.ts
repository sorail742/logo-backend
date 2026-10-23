// Retouche photo non destructive : réglages (exposition, tons, couleur, courbes, netteté,
// vignette, grain), recadrage, redressement et détourage d'une image du Studio. Chaque réglage
// est traduit en primitives de filtre SVG : l'éditeur (navigateur) et l'export (resvg, PDF tramé)
// produisent la même image. Même module côté front (src/lib/render/photo.ts).

export interface CurvePoint {
  /** Entrée et sortie, de 0 à 1. */
  x: number;
  y: number;
}

export interface PhotoCurves {
  rgb?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

export type PhotoTone = 'color' | 'mono' | 'sepia' | 'duotone';

/** Réglages d'une photo ; une valeur absente est neutre. Échelles de -100 à 100 sauf mention. */
export interface PhotoAdjust {
  /** Exposition, en IL (-3 à 3). */
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  /** Tons moyens (gamma). */
  brightness?: number;
  temperature?: number;
  tint?: number;
  /** Rotation de teinte, en degrés (-180 à 180). */
  hue?: number;
  saturation?: number;
  vibrance?: number;
  /** Voile mat (0 à 100). */
  fade?: number;
  /** Contraste local. */
  clarity?: number;
  /** Netteté (0 à 100). */
  sharpen?: number;
  /** Flou, en px du document (0 à 100). */
  blur?: number;
  /** Vignette : négative, sombre ; positive, claire. */
  vignette?: number;
  /** Grain argentique (0 à 100). */
  grain?: number;
  tone?: PhotoTone;
  /** Bichromie : couleur des ombres puis des hautes lumières. */
  duotone?: [string, string];
  invert?: boolean;
  curves?: PhotoCurves;
}

export const ADJUST_RANGES = {
  exposure: [-3, 3],
  contrast: [-100, 100],
  highlights: [-100, 100],
  shadows: [-100, 100],
  whites: [-100, 100],
  blacks: [-100, 100],
  brightness: [-100, 100],
  temperature: [-100, 100],
  tint: [-100, 100],
  hue: [-180, 180],
  saturation: [-100, 100],
  vibrance: [-100, 100],
  fade: [0, 100],
  clarity: [-100, 100],
  sharpen: [0, 100],
  blur: [0, 100],
  vignette: [-100, 100],
  grain: [0, 100],
} as const;

export type AdjustKey = keyof typeof ADJUST_RANGES;
export const ADJUST_KEYS = Object.keys(ADJUST_RANGES) as AdjustKey[];

/** Recadrage dans l'image d'origine, en proportions (0 à 1). */
export interface PhotoCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Ce que le rendu d'une photo lit de l'élément (même forme que l'élément image du Studio). */
export interface PhotoFrame {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  fit: 'cover' | 'contain';
  focusX?: number;
  focusY?: number;
  crop?: PhotoCrop | null;
  /** Redressement, en degrés (-45 à 45). */
  straighten?: number;
}

const r4 = (value: number) => Number(value.toFixed(4));
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ─── Courbes ───

function cleanPoints(points: CurvePoint[] | undefined): CurvePoint[] {
  const sorted = (points ?? [])
    .map((p) => ({ x: clamp(p.x), y: clamp(p.y) }))
    .sort((a, b) => a.x - b.x)
    .filter((p, i, list) => i === 0 || p.x - list[i - 1].x > 1e-4);
  return sorted;
}

/** Spline cubique monotone (Fritsch–Carlson) : la courbe ne dépasse jamais ses points. */
export function curveFunction(points: CurvePoint[] | undefined): (x: number) => number {
  const pts = cleanPoints(points);
  if (pts.length === 0) return (x) => x;
  if (pts.length === 1) return () => pts[0].y;
  const count = pts.length;
  const secants: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    secants.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }
  const tangents = pts.map((_, i) => {
    if (i === 0) return secants[0];
    if (i === count - 1) return secants[count - 2];
    const [a, b] = [secants[i - 1], secants[i]];
    return a * b <= 0 ? 0 : (a + b) / 2;
  });
  for (let i = 0; i < count - 1; i++) {
    const m = secants[i];
    if (m === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / m;
    const b = tangents[i + 1] / m;
    const norm = a * a + b * b;
    if (norm > 9) {
      const tau = 3 / Math.sqrt(norm);
      tangents[i] = tau * a * m;
      tangents[i + 1] = tau * b * m;
    }
  }
  return (x) => {
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[count - 1].x) return pts[count - 1].y;
    let i = 0;
    while (x > pts[i + 1].x) i++;
    const h = pts[i + 1].x - pts[i].x;
    const t = (x - pts[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * pts[i].y +
      (t3 - 2 * t2 + t) * h * tangents[i] +
      (-2 * t3 + 3 * t2) * pts[i + 1].y +
      (t3 - t2) * h * tangents[i + 1]
    );
  };
}

// ─── Tons ───

/** Nombre de points des tables de tons (interpolation linéaire entre eux). */
export const LUT_SIZE = 65;

const value = (adjust: PhotoAdjust, key: AdjustKey) => adjust[key] ?? 0;

/** Courbe de tons commune aux trois canaux (exposition, niveaux, gamma, contraste, voile). */
function toneFunction(adjust: PhotoAdjust): (x: number) => number {
  const exposure = 2 ** value(adjust, 'exposure');
  const black = (-value(adjust, 'blacks') / 100) * 0.12;
  const white = 1 - (value(adjust, 'whites') / 100) * 0.12;
  const gamma = 2 ** (-value(adjust, 'brightness') / 100);
  const contrast = value(adjust, 'contrast') / 100;
  const fade = value(adjust, 'fade') / 100;
  const master = curveFunction(adjust.curves?.rgb);
  return (input) => {
    let x = input * exposure;
    x = (x - black) / (white - black);
    x = clamp(x) ** gamma;
    if (contrast > 0) {
      const s = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
      x += contrast * (s - x);
    } else if (contrast < 0) {
      x = 0.5 + (x - 0.5) * (1 + contrast * 0.7);
    }
    x = fade * 0.25 + clamp(x) * (1 - fade * 0.3);
    return master(clamp(x));
  };
}

/**
 * Hautes lumières et ombres, sur la luminance : l'écart est ajouté aux trois canaux, la teinte
 * reste celle d'origine. Table de la luminance corrigée ; null si les deux réglages sont nuls.
 */
export function lightTable(adjust: PhotoAdjust): number[] | null {
  const highlights = (value(adjust, 'highlights') / 100) * 0.35;
  const shadows = (value(adjust, 'shadows') / 100) * 0.35;
  if (!highlights && !shadows) return null;
  let previous = 0;
  return Array.from({ length: LUT_SIZE }, (_, i) => {
    const x = i / (LUT_SIZE - 1);
    const bell = 4 * x * (1 - x);
    const y =
      x +
      highlights * bell * smoothstep(0.35, 0.75, x) +
      shadows * bell * (1 - smoothstep(0.25, 0.65, x));
    previous = Math.max(previous, clamp(y));
    return r4(previous);
  });
}

/** Tables de tons par canal ; null si elles sont neutres. */
export function toneTables(adjust: PhotoAdjust): { r: number[]; g: number[]; b: number[] } | null {
  const tone = toneFunction(adjust);
  const channel = (points: CurvePoint[] | undefined) => {
    const curve = curveFunction(points);
    let previous = 0;
    return Array.from({ length: LUT_SIZE }, (_, i) => {
      // Courbe croissante : un léger dépassement numérique ne doit pas inverser les tons.
      const y = Math.max(previous, clamp(curve(tone(i / (LUT_SIZE - 1)))));
      previous = y;
      return r4(y);
    });
  };
  const tables = {
    r: channel(adjust.curves?.r),
    g: channel(adjust.curves?.g),
    b: channel(adjust.curves?.b),
  };
  const identity = (table: number[]) =>
    table.every((y, i) => Math.abs(y - i / (LUT_SIZE - 1)) < 5e-4);
  return identity(tables.r) && identity(tables.g) && identity(tables.b) ? null : tables;
}

// ─── Couleur ───

type Matrix = number[]; // 4 × 5, lignes R, G, B, A

const IDENTITY: Matrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
const LUMA = [0.2126, 0.7152, 0.0722];

/** Produit de deux matrices de couleur : `a` appliquée après `b`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let sum = col === 4 ? a[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) sum += a[row * 5 + k] * b[k * 5 + col];
      out.push(sum);
    }
  }
  return out;
}

function saturationMatrix(s: number): Matrix {
  const [lr, lg, lb] = LUMA;
  return [
    lr + (1 - lr) * s,
    lg - lg * s,
    lb - lb * s,
    0,
    0,
    lr - lr * s,
    lg + (1 - lg) * s,
    lb - lb * s,
    0,
    0,
    lr - lr * s,
    lg - lg * s,
    lb + (1 - lb) * s,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

/** Rotation de teinte (formule de feColorMatrix type="hueRotate"). */
function hueMatrix(degrees: number): Matrix {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213,
    0.715 - c * 0.715 - s * 0.715,
    0.072 - c * 0.072 + s * 0.928,
    0,
    0,
    0.213 - c * 0.213 + s * 0.143,
    0.715 + c * 0.285 + s * 0.14,
    0.072 - c * 0.072 - s * 0.283,
    0,
    0,
    0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 + s * 0.715,
    0.072 + c * 0.928 + s * 0.072,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
  ];
}

const MONO: Matrix = [
  LUMA[0],
  LUMA[1],
  LUMA[2],
  0,
  0,
  LUMA[0],
  LUMA[1],
  LUMA[2],
  0,
  0,
  LUMA[0],
  LUMA[1],
  LUMA[2],
  0,
  0,
  0,
  0,
  0,
  1,
  0,
];

const SEPIA: Matrix = [
  0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0,
];

/** Balance des blancs : température (bleu ↔ ambre) et teinte (vert ↔ magenta). */
function whiteBalance(adjust: PhotoAdjust): Matrix | null {
  const t = value(adjust, 'temperature') / 100;
  const m = value(adjust, 'tint') / 100;
  if (!t && !m) return null;
  const r = 1 + 0.18 * t + 0.06 * m;
  const g = 1 + 0.02 * t - 0.14 * m;
  const b = 1 - 0.2 * t + 0.06 * m;
  return [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0];
}

/** Saturation, vibrance (saturation douce), teinte et virage (N&B, sépia, bichromie). */
function colorMatrix(adjust: PhotoAdjust): Matrix | null {
  const saturation =
    1 + value(adjust, 'saturation') / 100 + (value(adjust, 'vibrance') / 100) * 0.5;
  let matrix = IDENTITY;
  if (Math.abs(saturation - 1) > 1e-3)
    matrix = multiply(saturationMatrix(Math.max(0, saturation)), matrix);
  if (value(adjust, 'hue')) matrix = multiply(hueMatrix(value(adjust, 'hue')), matrix);
  if (adjust.tone === 'mono' || adjust.tone === 'duotone') matrix = multiply(MONO, matrix);
  if (adjust.tone === 'sepia') matrix = multiply(SEPIA, matrix);
  return matrix === IDENTITY ? null : matrix;
}

function hexChannels(hex: string): [number, number, number] {
  const value6 = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  return [0, 2, 4].map((i) => Number.parseInt(value6.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

const matrixValues = (matrix: Matrix) => matrix.map(r4).join(' ');
const tableValues = (table: number[]) => table.join(' ');

/** Rend la couleur opaque (couleurs « dé-prémultipliées ») : flous sans halo sur les bords. */
const OPAQUE = '1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 0 1';

/** Le réglage modifie-t-il l'image ? */
export function isNeutral(adjust: PhotoAdjust | null | undefined): boolean {
  if (!adjust) return true;
  return (
    ADJUST_KEYS.every((key) => !adjust[key]) &&
    (!adjust.tone || adjust.tone === 'color') &&
    !adjust.invert &&
    !['rgb', 'r', 'g', 'b'].some((k) => (adjust.curves?.[k as keyof PhotoCurves]?.length ?? 0) > 0)
  );
}

const LUMA_ROWS = `${LUMA.join(' ')} 0 0 ${LUMA.join(' ')} 0 0 ${LUMA.join(' ')} 0 0 0 0 0 0 1`;

/** Chaîne de primitives : chaque étape lit le résultat de la précédente. */
class FilterChain {
  readonly parts: string[] = [];
  current = 'SourceGraphic';
  /** Une étape a pu modifier l'alpha : il faut restaurer celui d'origine. */
  restoreAlpha = false;

  /** Ajoute une primitive (sans `in` ni `result`) appliquée au résultat courant. */
  step(name: string, primitive: string) {
    this.parts.push(primitive.replace(/^<(\w+)/, `<$1 in="${this.current}" result="${name}"`));
    this.current = name;
  }

  raw(markup: string) {
    this.parts.push(markup);
  }
}

const transfer = (r: number[], g = r, b = r) =>
  `<feComponentTransfer><feFuncR type="table" tableValues="${tableValues(r)}"/><feFuncG type="table" tableValues="${tableValues(g)}"/><feFuncB type="table" tableValues="${tableValues(b)}"/></feComponentTransfer>`;

function lightStep(chain: FilterChain, table: number[]) {
  const source = chain.current;
  chain.raw(
    `<feColorMatrix in="${source}" type="matrix" values="${LUMA_ROWS}" result="light-y"/>` +
      transfer(table).replace(
        '<feComponentTransfer>',
        '<feComponentTransfer in="light-y" result="light-f">',
      ) +
      transfer([1, 0]).replace(
        '<feComponentTransfer>',
        '<feComponentTransfer in="light-y" result="light-i">',
      ) +
      // Écart de luminance centré sur 0,5 (alpha 1), puis ajouté aux trois canaux.
      `<feComposite in="light-f" in2="light-i" operator="arithmetic" k1="0" k2="0.5" k3="0.5" k4="0" result="light-d"/>` +
      `<feComposite in="${source}" in2="light-d" operator="arithmetic" k1="0" k2="1" k3="2" k4="-1" result="light"/>`,
  );
  chain.current = 'light';
  chain.restoreAlpha = true;
}

/** Masque flou net (unsharp mask) avec flou normalisé : pas de halo sur les bords de l'image. */
function unsharp(chain: FilterChain, name: string, radius: number, amount: number) {
  const source = chain.current;
  chain.raw(
    `<feGaussianBlur in="${source}" stdDeviation="${r4(radius)}" result="${name}-b"/>` +
      `<feColorMatrix in="${name}-b" type="matrix" values="${OPAQUE}" result="${name}-n"/>` +
      `<feComposite in="${source}" in2="${name}-n" operator="arithmetic" k1="0" k2="${r4(1 + amount)}" k3="${r4(-amount)}" k4="0" result="${name}"/>`,
  );
  chain.current = name;
  chain.restoreAlpha = true;
}

/**
 * Filtre SVG des réglages (unités de l'espace de l'image, en px du document). `size` : côté de
 * référence pour le contraste local. Renvoie null si les réglages sont neutres.
 */
export function adjustFilter(id: string, adjust: PhotoAdjust, size: number): string | null {
  if (isNeutral(adjust)) return null;
  const chain = new FilterChain();
  const balance = whiteBalance(adjust);
  if (balance)
    chain.step('balance', `<feColorMatrix type="matrix" values="${matrixValues(balance)}"/>`);
  const tables = toneTables(adjust);
  if (tables) chain.step('tone', transfer(tables.r, tables.g, tables.b));
  const light = lightTable(adjust);
  if (light) lightStep(chain, light);
  const color = colorMatrix(adjust);
  if (color) chain.step('color', `<feColorMatrix type="matrix" values="${matrixValues(color)}"/>`);
  if (adjust.tone === 'duotone') {
    const [dark, bright] = (adjust.duotone ?? ['#1b1f3b', '#f6d365']).map(hexChannels);
    chain.step(
      'duotone',
      transfer(
        [r4(dark[0]), r4(bright[0])],
        [r4(dark[1]), r4(bright[1])],
        [r4(dark[2]), r4(bright[2])],
      ),
    );
  }
  if (adjust.invert) chain.step('invert', transfer([1, 0]));

  const clarity = value(adjust, 'clarity') / 100;
  if (clarity) unsharp(chain, 'clarity', Math.max(2, size * 0.02), clarity * 0.45);
  const sharpen = value(adjust, 'sharpen') / 100;
  if (sharpen) unsharp(chain, 'sharpen', 0.8, sharpen * 1.6);
  const blur = value(adjust, 'blur');
  if (blur) {
    chain.step('blur-b', `<feGaussianBlur stdDeviation="${r4(blur * 0.5)}"/>`);
    chain.step('blur', `<feColorMatrix type="matrix" values="${OPAQUE}"/>`);
    chain.restoreAlpha = true;
  }
  const grain = value(adjust, 'grain') / 100;
  if (grain) {
    const g = grain * 0.32;
    const source = chain.current;
    chain.raw(
      `<feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch" result="noise-t"/>` +
        `<feColorMatrix in="noise-t" type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1" result="noise"/>` +
        `<feComposite in="${source}" in2="noise" operator="arithmetic" k1="0" k2="1" k3="${r4(g)}" k4="${r4(-g / 2)}" result="grain"/>`,
    );
    chain.current = 'grain';
    chain.restoreAlpha = true;
  }
  if (chain.restoreAlpha) {
    // Couleurs ramenées à l'opacité, puis découpées par l'alpha d'origine : bords nets.
    chain.step('flat', `<feColorMatrix type="matrix" values="${OPAQUE}"/>`);
    chain.raw(`<feComposite in="flat" in2="SourceAlpha" operator="in"/>`);
  }
  return `<filter id="${id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">${chain.parts.join('')}</filter>`;
}

// ─── Cadrage ───

export interface PhotoPlacement {
  /** Zone recadrée, dans le repère de l'élément. */
  region: { x: number; y: number; width: number; height: number };
  /** Image entière (le recadrage la découpe), dans le repère de l'élément. */
  image: { x: number; y: number; width: number; height: number };
  /** Transformation de redressement autour du centre du cadre ; null sans redressement. */
  transform: string | null;
  /** Agrandissement dû au redressement (1 sans redressement). */
  zoom: number;
}

/**
 * Position de la photo dans son cadre : zone recadrée en recouvrement (cadrée par le point de
 * focus) ou contenue ; un redressement agrandit l'image juste assez pour couvrir le cadre.
 */
export function photoPlacement(el: PhotoFrame): PhotoPlacement {
  const crop = el.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const cw = Math.max(1e-6, crop.width) * el.naturalWidth;
  const ch = Math.max(1e-6, crop.height) * el.naturalHeight;
  const scale =
    el.fit === 'cover'
      ? Math.max(el.width / cw, el.height / ch)
      : Math.min(el.width / cw, el.height / ch);
  const width = cw * scale;
  const height = ch * scale;
  const fx = el.fit === 'cover' ? (el.focusX ?? 0.5) : 0.5;
  const fy = el.fit === 'cover' ? (el.focusY ?? 0.5) : 0.5;
  const region = { x: (el.width - width) * fx, y: (el.height - height) * fy, width, height };
  const image = {
    x: region.x - crop.x * el.naturalWidth * scale,
    y: region.y - crop.y * el.naturalHeight * scale,
    width: el.naturalWidth * scale,
    height: el.naturalHeight * scale,
  };
  const angle = el.straighten ?? 0;
  if (!angle) return { region, image, transform: null, zoom: 1 };

  // Redressement autour du centre du cadre ; en recouvrement, agrandissement minimal pour que la
  // zone recadrée tournée contienne encore les quatre coins du cadre.
  const cx = el.width / 2;
  const cy = el.height / 2;
  let zoom = 1;
  if (el.fit === 'cover') {
    const a = (-angle * Math.PI) / 180;
    const [cos, sin] = [Math.cos(a), Math.sin(a)];
    for (const [px, py] of [
      [0, 0],
      [el.width, 0],
      [0, el.height],
      [el.width, el.height],
    ]) {
      const qx = cos * (px - cx) - sin * (py - cy);
      const qy = sin * (px - cx) + cos * (py - cy);
      const limitX = qx >= 0 ? region.x + region.width - cx : cx - region.x;
      const limitY = qy >= 0 ? region.y + region.height - cy : cy - region.y;
      zoom = Math.max(
        zoom,
        Math.abs(qx) / Math.max(1e-6, limitX),
        Math.abs(qy) / Math.max(1e-6, limitY),
      );
    }
  }
  const transform = `translate(${r4(cx)} ${r4(cy)}) rotate(${r4(angle)}) scale(${r4(zoom)}) translate(${r4(-cx)} ${r4(-cy)})`;
  return { region, image, transform, zoom };
}

// ─── Effets de détourage ───

export interface PhotoOutline {
  color: string;
  /** Épaisseur, en px du document. */
  width: number;
}

export interface PhotoGlow {
  color: string;
  size: number;
  opacity: number;
}

/** Contour « autocollant » et lueur autour de la forme visible (après détourage). */
export function effectsFilter(
  id: string,
  outline: PhotoOutline | null | undefined,
  glow: PhotoGlow | null | undefined,
  box: { width: number; height: number },
): string | null {
  const nodes: string[] = [];
  const parts: string[] = [];
  if (glow && glow.size > 0 && glow.opacity > 0) {
    parts.push(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="${r4(glow.size / 2)}" result="glow-a"/><feFlood flood-color="${glow.color}" flood-opacity="${r4(glow.opacity)}"/><feComposite in2="glow-a" operator="in" result="glow"/>`,
    );
    nodes.push('glow');
  }
  if (outline && outline.width > 0) {
    parts.push(
      `<feMorphology in="SourceAlpha" operator="dilate" radius="${r4(outline.width)}" result="line-a"/><feFlood flood-color="${outline.color}"/><feComposite in2="line-a" operator="in" result="line"/>`,
    );
    nodes.push('line');
  }
  if (!nodes.length) return null;
  const pad = Math.ceil((outline?.width ?? 0) + (glow?.size ?? 0) * 1.5 + 4);
  const merge = [...nodes, 'SourceGraphic'].map((n) => `<feMergeNode in="${n}"/>`).join('');
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="${-pad}" y="${-pad}" width="${r4(box.width + pad * 2)}" height="${r4(box.height + pad * 2)}" color-interpolation-filters="sRGB">${parts.join('')}<feMerge>${merge}</feMerge></filter>`;
}

/** Vignette : dégradé radial posé sur la zone recadrée. */
export function vignetteGradient(id: string, amount: number, region: PhotoPlacement['region']) {
  const strength = Math.min(1, Math.abs(amount) / 100) * 0.75;
  const color = amount > 0 ? '#ffffff' : '#000000';
  const r = Math.hypot(region.width, region.height) / 2;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${r4(region.x + region.width / 2)}" cy="${r4(region.y + region.height / 2)}" r="${r4(r)}"><stop offset="0.45" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="${r4(strength)}"/></radialGradient>`;
}

// ─── Préréglages ───

export interface PhotoPreset {
  id: string;
  adjust: PhotoAdjust;
}

/** Filtres prêts à l'emploi (vignettes de la galerie de l'éditeur). */
export const PHOTO_PRESETS: readonly PhotoPreset[] = [
  { id: 'original', adjust: {} },
  { id: 'auto', adjust: { contrast: 12, vibrance: 18, clarity: 12, sharpen: 20 } },
  { id: 'vivid', adjust: { contrast: 18, saturation: 25, vibrance: 20, clarity: 10 } },
  { id: 'warm', adjust: { temperature: 35, tint: 5, vibrance: 10, fade: 6 } },
  { id: 'cool', adjust: { temperature: -35, tint: -4, contrast: 8 } },
  { id: 'golden', adjust: { temperature: 45, highlights: -20, shadows: 18, saturation: 8 } },
  { id: 'matte', adjust: { fade: 45, contrast: -12, saturation: -15 } },
  { id: 'vintage', adjust: { tone: 'sepia', fade: 30, vignette: -40, grain: 30, contrast: 6 } },
  { id: 'mono', adjust: { tone: 'mono', contrast: 18, clarity: 15 } },
  { id: 'noir', adjust: { tone: 'mono', contrast: 55, blacks: -30, vignette: -45, grain: 20 } },
  { id: 'fade-mono', adjust: { tone: 'mono', fade: 40, contrast: -10 } },
  {
    id: 'dramatic',
    adjust: {
      contrast: 40,
      highlights: -35,
      shadows: 25,
      clarity: 35,
      vibrance: -10,
      vignette: -35,
    },
  },
  {
    id: 'cinema',
    adjust: {
      contrast: 22,
      temperature: -12,
      tint: 6,
      fade: 18,
      saturation: -10,
      curves: {
        r: [
          { x: 0, y: 0.02 },
          { x: 1, y: 0.97 },
        ],
        b: [
          { x: 0, y: 0.08 },
          { x: 1, y: 0.92 },
        ],
      },
    },
  },
  { id: 'bright', adjust: { exposure: 0.4, shadows: 30, highlights: -10, vibrance: 12 } },
  {
    id: 'duotone-sunset',
    adjust: { tone: 'duotone', duotone: ['#3a0f4e', '#ffb347'], contrast: 15 },
  },
  {
    id: 'duotone-ocean',
    adjust: { tone: 'duotone', duotone: ['#062a3d', '#7fe7dc'], contrast: 15 },
  },
];
