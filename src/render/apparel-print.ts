import { prefixIds, renderElement, shapeTextWidth } from './design';
import type { DesignElement, ImageElement, Paint, TextElement } from './design-doc';
import { getFont } from './fonts';
import type { TextEffects } from './lettering';

// Pièces à imprimer d'une tenue (pack atelier, cahier des charges §16.7) : les éléments d'une
// zone, adaptés à la taille et au joueur (nom, numéro), dans un repère en millimètres. Même
// conversion que l'éditeur (front, src/lib/apparel/render.ts : toStudioElement) ; le texte est
// rendu en tracés par le moteur du Studio, donc sans police à installer chez l'imprimeur.

const n = (value: number) => Math.round(value * 100) / 100;

/** Zone d'impression, déjà adaptée à la taille du vêtement. */
export interface PrintZone {
  key: string;
  view: string;
  label: string;
  offsetXMm: number;
  offsetYMm: number;
  maxWidthMm: number;
  maxHeightMm: number;
}

/** Contenu d'un élément textile utile à l'impression (sous-ensemble du contrat de l'API). */
export interface PrintContent {
  text?: string;
  fontId?: string;
  fontWeight?: number;
  fill?: string;
  textOutline?: { color: string; widthMm: number } | null;
  curve?: number;
  letterSpacing?: number;
  effects?: TextEffects | null;
  svg?: string;
  photo?: {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    adjust?: Exclude<ImageElement['adjust'], undefined>;
    crop?: Exclude<ImageElement['crop'], undefined>;
    straighten?: number;
    cutout?: string | null;
    outline?: Exclude<ImageElement['outline'], undefined>;
    glow?: Exclude<ImageElement['glow'], undefined>;
    flipX?: boolean;
    flipY?: boolean;
  };
}

export interface PrintElement {
  zoneKey: string;
  kind: string;
  content: PrintContent;
  widthMm: number;
  heightMm: number;
  offsetXMm: number;
  offsetYMm: number;
  rotationDeg: number;
}

/** Joueur de l'effectif : nom imprimé, numéro, taille, nombre de maillots. */
export interface PrintPlayer {
  displayName: string;
  number?: string | null;
  size: string;
  quantity: number;
}

/** Élément du Studio d'une pièce, avec sa condensation horizontale (noms longs, TEX-23). */
export interface PieceElement {
  el: DesignElement;
  scaleX: number;
}

/** Pièce à imprimer : le contenu d'une zone pour une taille (et un joueur), en mm. */
export interface PrintPiece {
  /** Nom de fichier : NUMERO_NOM_TAILLE_zone, ou commun_zone_taille. */
  key: string;
  /** Joueur (NUMERO_NOM_TAILLE) ; null pour une pièce commune à plusieurs maillots. */
  player: string | null;
  zone: PrintZone;
  sizes: string[];
  widthMm: number;
  heightMm: number;
  /** Coin de la pièce dans sa zone (plan de placement). */
  offsetXMm: number;
  offsetYMm: number;
  elements: PieceElement[];
  /** Nombre d'exemplaires à imprimer. */
  quantity: number;
  warnings: string[];
}

/** Condensation maximale d'un nom avant de réduire sa hauteur (TEX-23). */
export const MIN_CONDENSATION = 0.8;

const PLAYER_KINDS = new Set(['PLAYER_NAME', 'PLAYER_NUMBER']);

/** Hauteur de flèche d'un texte en arc (même géométrie que le Studio). */
export function arcSagitta(width: number, curve = 0) {
  const theta = Math.max(0.0001, (Math.min(100, Math.abs(curve)) / 100) * Math.PI);
  const radius = width / (2 * Math.sin(theta / 2));
  return curve ? radius * (1 - Math.cos(theta / 2)) : 0;
}

const solid = (color: string): Paint => ({ type: 'solid', color });

/** Élément du Studio équivalent, dans le repère de la zone (mm). */
export function toDesignElement(el: PrintElement, id: string): DesignElement | null {
  const box = {
    id,
    x: el.offsetXMm,
    y: el.offsetYMm,
    width: el.widthMm,
    height: el.heightMm,
    rotation: el.rotationDeg ?? 0,
    opacity: 1,
  };
  const c = el.content;
  if (c.photo) {
    const p = c.photo;
    return {
      ...box,
      type: 'image',
      src: p.src,
      naturalWidth: p.naturalWidth,
      naturalHeight: p.naturalHeight,
      fit: 'contain',
      mask: 'none',
      adjust: p.adjust,
      crop: p.crop,
      straighten: p.straighten,
      cutout: p.cutout,
      outline: p.outline,
      glow: p.glow,
      flipX: p.flipX,
      flipY: p.flipY,
    };
  }
  if (c.svg) return { ...box, type: 'svg', svg: c.svg, source: 'logo' };
  if (!c.text?.trim()) return null;
  const font = getFont(c.fontId ?? 'montserrat');
  const metrics = font.ascent + font.descent;
  return {
    ...box,
    type: 'text',
    text: c.text,
    lines: [c.text],
    fontId: font.id,
    fontWeight: c.fontWeight ?? 700,
    fontSize: Math.max(1, (el.heightMm - arcSagitta(el.widthMm, c.curve)) / metrics),
    lineHeight: metrics,
    letterSpacing: c.letterSpacing ?? 0,
    align: 'center',
    uppercase: false,
    curve: c.curve,
    fill: solid(c.fill ?? '#111111'),
    stroke:
      c.textOutline && c.textOutline.widthMm > 0
        ? { color: c.textOutline.color, width: c.textOutline.widthMm }
        : null,
    effects: c.effects ?? null,
  };
}

/** Débord des effets autour de la boîte d'un élément (contours, relief, halo), en mm. */
export function effectMargin(el: DesignElement) {
  if (el.type === 'image') return (el.outline?.width ?? 0) + (el.glow?.size ?? 0);
  if (el.type !== 'text') return 0;
  const e = el.effects;
  // Approches et jambages qui sortent de la boîte : 8 % du corps.
  const overhang = el.fontSize * 0.08;
  const outer = (el.stroke?.width ?? 0) + (e?.outline2?.width ?? 0);
  return outer + (e?.extrude?.depth ?? 0) + (e?.glow?.size ?? 0) + overhang;
}

/**
 * Ajuste un texte à une largeur (sa boîte par défaut) : condensé jusqu'à 80 %, puis réduit en
 * hauteur (centré dans la boîte d'origine). Renvoie l'élément et sa condensation.
 */
export function fitTextElement(
  el: TextElement,
  maxWidth = el.width,
): { el: TextElement; scaleX: number } {
  if (el.curve) return { el, scaleX: 1 };
  const natural = shapeTextWidth(el);
  if (natural <= maxWidth) return { el, scaleX: 1 };
  const scaleX = maxWidth / natural;
  if (scaleX >= MIN_CONDENSATION) return { el, scaleX };
  const k = maxWidth / (natural * MIN_CONDENSATION);
  const height = el.height * k;
  return {
    el: { ...el, fontSize: el.fontSize * k, height, y: el.y + (el.height - height) / 2 },
    scaleX: MIN_CONDENSATION,
  };
}

/** Boîte englobante d'un élément tourné (repère de la zone). */
function bounds(el: DesignElement) {
  const a = ((el.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const w = el.width * cos + el.height * sin;
  const h = el.width * sin + el.height * cos;
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
}

/** Clé de fichier : NUMERO_NOM_TAILLE, sans accents ni caractères spéciaux. */
export function playerKey(player: PrintPlayer) {
  const clean = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()
      .replaceAll(' ', '-');
  return [player.number, player.displayName, player.size]
    .map((part) => clean(part ?? ''))
    .filter(Boolean)
    .join('_');
}

/**
 * Éléments d'une zone pour un joueur : son nom et son numéro remplacent ceux du modèle ; chaque
 * élément garde son modèle (largeur affichée dans l'éditeur).
 */
function personalize(elements: PrintElement[], player: PrintPlayer | null) {
  return elements.flatMap((el) => {
    if (!player || !PLAYER_KINDS.has(el.kind)) return [{ source: el, model: el }];
    const text = el.kind === 'PLAYER_NAME' ? player.displayName : (player.number ?? '');
    // Un membre du staff sans numéro n'a pas de numéro imprimé.
    return text.trim() ? [{ source: { ...el, content: { ...el.content, text } }, model: el }] : [];
  });
}

/** Éléments mis à l'échelle de la taille (zones proportionnelles). */
function scaled(elements: PrintElement[], k: number) {
  if (k === 1) return elements;
  return elements.map((el) => ({
    ...el,
    widthMm: el.widthMm * k,
    heightMm: el.heightMm * k,
    offsetXMm: el.offsetXMm * k,
    offsetYMm: el.offsetYMm * k,
    content: el.content.textOutline
      ? {
          ...el.content,
          textOutline: { ...el.content.textOutline, widthMm: el.content.textOutline.widthMm * k },
        }
      : el.content,
  }));
}

/**
 * Pièce d'une zone : éléments convertis, noms ajustés, boîte serrée autour du dessin (effets
 * compris, 2 mm de marge de découpe).
 */
export function buildPiece(input: {
  key: string;
  player: string | null;
  zone: PrintZone;
  sizes: string[];
  elements: PrintElement[];
  scale: number;
  playerData: PrintPlayer | null;
  quantity: number;
  minNameHeightMm?: number;
}): PrintPiece | null {
  const warnings: string[] = [];
  const pairs = personalize(input.elements, input.playerData);
  const sources = scaled(
    pairs.map((p) => p.source),
    input.scale,
  );
  const models = scaled(
    pairs.map((p) => p.model),
    input.scale,
  );
  const converted = sources
    .map((source, i) => ({ source, model: models[i], el: toDesignElement(source, `e${i}`) }))
    .filter(
      (item): item is { source: PrintElement; model: PrintElement; el: DesignElement } =>
        item.el !== null,
    )
    .map(({ source, model, el }) => {
      // Seuls le nom et le numéro changent d'un joueur à l'autre : ils sont ajustés s'ils
      // dépassent à la fois leur boîte et le texte du modèle tel qu'il est affiché.
      if (el.type !== 'text' || !PLAYER_KINDS.has(source.kind)) return { el, scaleX: 1 };
      const shown = toDesignElement(model, 'm');
      const allowed = Math.max(el.width, shown?.type === 'text' ? shapeTextWidth(shown) : 0);
      const fitted = fitTextElement(el, allowed);
      if (
        source.kind === 'PLAYER_NAME' &&
        input.minNameHeightMm &&
        fitted.el.height < input.minNameHeightMm - 0.5
      ) {
        warnings.push(
          `Nom « ${el.text} » réduit à ${Math.round(fitted.el.height)} mm de haut (minimum ${input.minNameHeightMm} mm)`,
        );
      }
      return fitted;
    });
  if (!converted.length) return null;
  const pad = 2 + Math.max(...converted.map(({ el }) => effectMargin(el)));
  const boxes = converted.map(({ el }) => bounds(el));
  const x0 = Math.min(...boxes.map((b) => b.x)) - pad;
  const y0 = Math.min(...boxes.map((b) => b.y)) - pad;
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return {
    key: input.key,
    player: input.player,
    zone: input.zone,
    sizes: input.sizes,
    widthMm: n(x1 - x0),
    heightMm: n(y1 - y0),
    offsetXMm: n(x0),
    offsetYMm: n(y0),
    elements: converted.map(({ el, scaleX }) => ({
      el: { ...el, x: el.x - x0, y: el.y - y0 },
      scaleX,
    })),
    quantity: input.quantity,
    warnings,
  };
}

/** Dessin d'un élément ; un nom condensé est resserré autour du centre de sa boîte. */
export function renderPieceElement({ el, scaleX }: PieceElement) {
  const markup = renderElement(el);
  if (scaleX === 1) return markup;
  const cx = el.x + el.width / 2;
  return `<g transform="translate(${n(cx)} 0) scale(${n(scaleX * 1000) / 1000} 1) translate(${n(-cx)} 0)">${markup}</g>`;
}

/** Contenu d'une pièce (repère en mm, origine au coin), identifiants préfixés par `prefix`. */
export function pieceMarkup(piece: PrintPiece, prefix: string) {
  return prefixIds(piece.elements.map(renderPieceElement).join(''), prefix);
}

/** Pièce seule en SVG à l'échelle 1:1 (unités en mm), en miroir si demandé. */
export function pieceSvg(piece: PrintPiece, options: { mirror?: boolean } = {}) {
  const { widthMm: w, heightMm: h } = piece;
  const body = pieceMarkup(piece, 'p');
  const content = options.mirror
    ? `<g transform="translate(${w} 0) scale(-1 1)">${body}</g>`
    : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">${content}</svg>`;
}

/** Couleurs à imprimer d'une pièce (HEX), photos signalées à part. */
export function pieceColors(piece: PrintPiece) {
  const colors = new Set<string>();
  let photo = false;
  let gradient = false;
  const add = (color?: string | null) => color && colors.add(color.toLowerCase());
  for (const { el } of piece.elements) {
    if (el.type === 'image') photo = true;
    if (el.type === 'svg') for (const c of el.svg.match(/#[0-9a-f]{6}\b/gi) ?? []) add(c);
    if (el.type !== 'text') continue;
    if (el.fill.type === 'solid') add(el.fill.color);
    else gradient ||= el.fill.type !== 'none';
    add(el.stroke?.color);
    const e = el.effects;
    for (const layer of [e?.outline2, e?.inline, e?.extrude, e?.halftone, e?.pattern, e?.glow])
      add(layer?.color);
    for (const band of e?.pattern?.colors ?? []) add(band);
    // Halo néon et reflet holographique : transparences, comme un dégradé.
    gradient ||= Boolean(e?.glow) || e?.pattern?.kind === 'holo';
  }
  return { colors: [...colors], photo, gradient };
}
