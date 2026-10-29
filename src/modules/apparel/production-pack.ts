import type { PrintTechnique } from '@prisma/client';
import {
  buildPiece,
  pieceColors,
  pieceMarkup,
  pieceSvg,
  playerKey,
  type PrintElement,
  type PrintPiece,
  type PrintPlayer,
  type PrintZone,
} from '../../render/apparel-print';
import {
  cutDxf,
  cutSvg,
  pieceCutLayers,
  sheetPolygons,
  type CutLayer,
} from '../../render/cut-file';
import { getFont } from '../../render/fonts';
import { packPieces, sheetSvg, type SheetOptions } from '../../render/gang-sheet';
import { createPdf, drawSvg, MM, registerTextFonts, writeText } from '../../render/pdf';
import { pngWithDpi, svgToPng } from '../../render/raster';
import {
  placementTemplatePdf,
  techSheetPdf,
  type PlacementZone,
  type TechSheetData,
} from '../../render/tech-sheet';
import type { ZipEntry } from '../../render/zip';
import { relativeLuminance } from '../../shared/color';
import { resolveZone, type Size, type Zone } from './apparel-rules';

// Pack atelier (cahier des charges §16.7-16.8) : à partir d'une tenue et de son effectif, tous
// les fichiers à envoyer à l'imprimeur, sans retouche. Ce n'est pas le maillot qui est imprimé,
// mais le support intermédiaire posé ensuite sous la presse : film DTF, papier transfert, papier
// sublimation, flex ou flocage découpés, films de sérigraphie. Chaque support applique ses règles
// (miroir, planche, découpe par couleur, séparation), à l'échelle 1:1 et à 300 dpi.

export const PRINT_SUPPORTS = [
  'DTF_FILM',
  'TRANSFER_LIGHT',
  'TRANSFER_DARK',
  'SUBLIMATION_PAPER',
  'FLEX',
  'FLOCK',
  'SCREEN_FILM',
  'DTG',
  'EMBROIDERY',
] as const;
export type PrintSupport = (typeof PRINT_SUPPORTS)[number];

type SupportKind = 'transfer' | 'cut' | 'film' | 'direct' | 'embroidery';

interface SupportSpec {
  label: string;
  folder: string;
  kind: SupportKind;
  /** Miroir conseillé : support posé face contre le tissu. */
  mirror: boolean;
  sheet: SheetOptions;
  cutMarks: boolean;
  instructions: string[];
}

const PRESS_NOTE =
  'Températures et temps indicatifs : suivez toujours la fiche du fournisseur du support.';

export const SUPPORTS: Record<PrintSupport, SupportSpec> = {
  DTF_FILM: {
    label: 'Film DTF',
    folder: 'DTF',
    kind: 'transfer',
    mirror: false,
    sheet: { format: 'ROLL', rollWidthMm: 580, rollPageMm: 500 },
    cutMarks: false,
    instructions: [
      'PNG 300 dpi, fond transparent, couleurs sRGB : le logiciel RIP de l’atelier ajoute la sous-couche blanche et la poudre.',
      'Fichiers sans miroir : la plupart des ateliers DTF inversent eux-mêmes si besoin. Ne cochez « miroir » que si votre atelier le demande.',
      'Planche : 1 cm d’espace entre les visuels pour la découpe, 8 mm de marge aux bords.',
    ],
  },
  TRANSFER_LIGHT: {
    label: 'Papier transfert pour textile clair',
    folder: 'PAPIER-TRANSFERT',
    kind: 'transfer',
    mirror: true,
    sheet: { format: 'A4' },
    cutMarks: true,
    instructions: [
      'Imprimer en miroir sur la face blanche du papier (imprimante jet d’encre ou laser selon le papier).',
      'Découper au ras du visuel en suivant les repères de coupe, poser face imprimée contre le tissu, puis presser.',
      'Pour textile blanc ou clair uniquement : le papier clair est transparent, la couleur du tissu ressort.',
    ],
  },
  TRANSFER_DARK: {
    label: 'Papier transfert pour textile foncé',
    folder: 'PAPIER-TRANSFERT-FONCE',
    kind: 'transfer',
    mirror: false,
    sheet: { format: 'A4' },
    cutMarks: true,
    instructions: [
      'Imprimer sans miroir : le papier pour textile foncé a une couche blanche opaque et se pose face visible.',
      'Découper au ras du visuel, retirer le support, poser l’image face visible sur le tissu, couvrir du papier de protection et presser.',
    ],
  },
  SUBLIMATION_PAPER: {
    label: 'Papier sublimation',
    folder: 'SUBLIMATION',
    kind: 'transfer',
    mirror: true,
    sheet: { format: 'A3' },
    cutMarks: false,
    instructions: [
      'Imprimer en miroir avec des encres de sublimation, poser face imprimée contre le tissu.',
      'Polyester blanc ou clair uniquement (au moins 65 % de polyester), presse vers 200 °C pendant 45 à 55 s.',
      'Fixer le papier avec du ruban thermique pour éviter les images fantômes.',
    ],
  },
  FLEX: {
    label: 'Flex thermocollant (découpe)',
    folder: 'FLEX',
    kind: 'cut',
    mirror: true,
    sheet: { format: 'ROLL', rollWidthMm: 500, rollPageMm: 1000 },
    cutMarks: false,
    instructions: [
      'Un fichier par couleur de flex : contours fermés, en miroir, à découper face mate vers la lame (support brillant contre le tapis).',
      'Échenillage : retirer le flex inutile autour des lettres, puis presser vers 150 à 170 °C pendant 15 à 20 s.',
      'Lettrage à contours : presser d’abord le contour le plus large, puis les couches suivantes, le remplissage en dernier.',
      'SVG et PDF à l’échelle 1:1 ; DXF en millimètres pour les logiciels de plotter.',
    ],
  },
  FLOCK: {
    label: 'Flocage velours (découpe)',
    folder: 'FLOCAGE',
    kind: 'cut',
    mirror: true,
    sheet: { format: 'ROLL', rollWidthMm: 500, rollPageMm: 1000 },
    cutMarks: false,
    instructions: [
      'Mêmes fichiers que le flex : un fichier par couleur, contours fermés, en miroir.',
      'Le velours est plus épais : évitez les détails de moins de 2 mm.',
    ],
  },
  SCREEN_FILM: {
    label: 'Films de sérigraphie',
    folder: 'SERIGRAPHIE',
    kind: 'film',
    mirror: false,
    sheet: { format: 'A3' },
    cutMarks: false,
    instructions: [
      'Un film positif par couleur, noir sur transparent, lisible côté encre (sans miroir), avec repères de calage.',
      'Les zones des autres couleurs sont épargnées (défonce) : pas d’encre superposée.',
      'Les noms et numéros changent à chaque maillot : ils sont fournis à part, pour le flex ou le transfert.',
    ],
  },
  DTG: {
    label: 'Impression directe (DTG)',
    folder: 'DTG',
    kind: 'direct',
    mirror: false,
    sheet: { format: 'A3' },
    cutMarks: false,
    instructions: [
      'PNG 300 dpi, fond transparent, à la taille réelle : à imprimer directement sur le vêtement.',
      'Sur textile foncé, l’imprimante dépose une sous-couche blanche : prévoir le prétraitement.',
    ],
  },
  EMBROIDERY: {
    label: 'Broderie',
    folder: 'BRODERIE',
    kind: 'embroidery',
    mirror: false,
    sheet: { format: 'A3' },
    cutMarks: false,
    instructions: [
      'SVG simplifiés à la taille réelle, à transmettre au numériseur pour le fichier machine (DST, PES).',
      'Texte d’au moins 5 mm de haut, nombre de couleurs de fil limité.',
    ],
  },
};

/** Support conseillé pour la technique de la tenue. */
export const TECHNIQUE_SUPPORT: Record<PrintTechnique, PrintSupport> = {
  DTF: 'DTF_FILM',
  DTG: 'DTG',
  SUBLIMATION: 'SUBLIMATION_PAPER',
  HEAT_TRANSFER_VINYL: 'FLEX',
  FLOCK: 'FLOCK',
  SCREEN_PRINT: 'SCREEN_FILM',
  EMBROIDERY: 'EMBROIDERY',
};

const TECHNIQUE_LABELS: Record<PrintTechnique, string> = {
  DTF: 'DTF',
  DTG: 'Impression directe (DTG)',
  SUBLIMATION: 'Sublimation',
  HEAT_TRANSFER_VINYL: 'Flex thermocollant',
  FLOCK: 'Flocage velours',
  SCREEN_PRINT: 'Sérigraphie',
  EMBROIDERY: 'Broderie',
};

const VIEW_LABELS: Record<string, string> = {
  FRONT: 'Devant',
  BACK: 'Dos',
  LEFT_SLEEVE: 'Manche gauche',
  RIGHT_SLEEVE: 'Manche droite',
  OTHER: 'Autre',
};

const DPI = 300;
/** Au-delà, la planche n'est livrée qu'en PDF vectoriel (mémoire du rendu matriciel). */
const MAX_PNG_PIXELS = 42_000_000;

export interface PackPlayer extends PrintPlayer {
  playerName?: string;
  role?: string | null;
}

export interface PackInput {
  design: {
    name: string;
    technique: PrintTechnique;
    garmentColor: string;
    template: string;
    proofUrl: string | null;
    approvedAt: Date | null;
  };
  zones: (Zone & { label: string })[];
  sizes: Size[];
  referenceSize: string;
  elements: PrintElement[];
  /** Effectif (vide : `copies` vêtements identiques de la taille `copiesSize`). */
  players: PackPlayer[];
  copies: number;
  copiesSize?: string;
  support: PrintSupport;
  mirror: boolean;
  sheet?: SheetOptions;
  cutMarks?: boolean;
  minNameHeightMm?: number;
  now?: Date;
}

export interface PackResult {
  entries: ZipEntry[];
  techSheet: Buffer;
  warnings: string[];
  pieces: number;
  sheets: number;
}

const PLAYER_KINDS = new Set(['PLAYER_NAME', 'PLAYER_NUMBER']);
const mm = (value: number) => Math.round(value);

/** Rectangle d'une zone dans le repère du vêtement : X depuis l'axe (vue de face), Y sous le col. */
function zoneRect(zone: PrintZone) {
  const axis = zone.view === 'BACK' ? -zone.offsetXMm : zone.offsetXMm;
  return {
    x: axis - zone.maxWidthMm / 2,
    y: zone.offsetYMm,
    width: zone.maxWidthMm,
    height: zone.maxHeightMm,
  };
}

/** Position d'une pièce, en clair : distance au col et décalage par rapport à l'axe. */
function placementText(piece: PrintPiece) {
  const rect = zoneRect(piece.zone);
  const top = rect.y + piece.offsetYMm;
  const center = rect.x + piece.offsetXMm + piece.widthMm / 2;
  const side = center > 0 ? 'à droite' : 'à gauche';
  const axis =
    Math.abs(center) < 3
      ? 'centrée sur l’axe'
      : `centre ${mm(Math.abs(center))} mm ${side} de l’axe`;
  return `haut à ${mm(top)} mm du col, ${axis}`;
}

interface CommonGroup {
  zone: PrintZone;
  k: number;
  elements: PrintElement[];
  quantity: number;
  sizes: string[];
}

interface CollectState {
  input: PackInput;
  sizes: Map<string, Size>;
  ref: Size;
  zones: Map<string, Zone & { label: string }>;
  byZone: Map<string, PrintElement[]>;
  pieces: PrintPiece[];
  common: Map<string, CommonGroup>;
}

/** Vêtements à produire : l'effectif, ou `copies` vêtements identiques sans effectif. */
function garmentsOf(input: PackInput, ref: Size): PackPlayer[] {
  if (input.players.length) return input.players;
  return [
    { displayName: '', size: input.copiesSize ?? ref.label, quantity: Math.max(1, input.copies) },
  ];
}

/** Pièces d'un vêtement : nominatives tout de suite, communes regroupées par zone et échelle. */
function addGarment(state: CollectState, garment: PackPlayer, roster: boolean) {
  const size = state.sizes.get(garment.size) ?? state.ref;
  const pk = roster ? playerKey(garment) : null;
  for (const [zoneKey, elements] of state.byZone) {
    const zone = state.zones.get(zoneKey);
    if (zone) addZone(state, garment, pk, size, zone, elements);
  }
}

/** Une zone d'un vêtement : pièce du joueur, ou exemplaire de plus pour la pièce commune. */
function addZone(
  state: CollectState,
  garment: PackPlayer,
  pk: string | null,
  size: Size,
  zone: Zone & { label: string },
  elements: PrintElement[],
) {
  const resolved = resolveZone(zone, size, state.ref);
  const k = zone.maxWidthMm ? resolved.maxWidthMm / zone.maxWidthMm : 1;
  const printZone: PrintZone = { ...resolved, label: zone.label };
  if (pk && elements.some((el) => PLAYER_KINDS.has(el.kind))) {
    const piece = buildPiece({
      elements,
      key: `${pk}_${zone.key}`,
      player: pk,
      zone: printZone,
      sizes: [size.label],
      scale: k,
      playerData: garment,
      quantity: garment.quantity,
      minNameHeightMm: state.input.minNameHeightMm,
    });
    if (piece) state.pieces.push(piece);
    return;
  }
  const key = `${zone.key}@${k.toFixed(4)}`;
  const group = state.common.get(key) ?? { k, elements, zone: printZone, quantity: 0, sizes: [] };
  group.quantity += garment.quantity;
  if (!group.sizes.includes(size.label)) group.sizes.push(size.label);
  state.common.set(key, group);
}

/** Pièces de la tenue : une par joueur pour les zones nominatives, communes pour les autres. */
export function collectPieces(input: PackInput) {
  const sizes = new Map(input.sizes.map((s) => [s.label, s]));
  const ref = sizes.get(input.referenceSize) ?? input.sizes[Math.floor(input.sizes.length / 2)];
  const byZone = new Map<string, PrintElement[]>();
  for (const el of input.elements) byZone.set(el.zoneKey, [...(byZone.get(el.zoneKey) ?? []), el]);
  const roster = input.players.length > 0;
  const garments = garmentsOf(input, ref);
  const state: CollectState = {
    input,
    sizes,
    ref,
    byZone,
    zones: new Map(input.zones.map((z) => [z.key, z])),
    pieces: [],
    common: new Map(),
  };
  for (const garment of garments) addGarment(state, garment, roster);
  for (const group of state.common.values()) {
    const piece = buildPiece({
      key: `commun_${group.zone.key}_${group.sizes.join('-')}`,
      player: null,
      zone: group.zone,
      sizes: group.sizes,
      elements: group.elements,
      scale: group.k,
      playerData: null,
      quantity: group.quantity,
      minNameHeightMm: input.minNameHeightMm,
    });
    if (piece) state.pieces.push(piece);
  }
  return { ref, garments, roster, pieces: state.pieces };
}

/** PNG à 300 dpi d'un SVG en mm (null au-delà de la limite de pixels). */
function png300(svg: string, widthMm: number, heightMm: number, background: string | null = null) {
  const width = Math.round((widthMm / 25.4) * DPI);
  const height = Math.round((heightMm / 25.4) * DPI);
  if (width * height > MAX_PNG_PIXELS) return null;
  return pngWithDpi(svgToPng(svg, { size: Math.max(width, height), background }), DPI);
}

/** PDF à l'échelle 1:1 : une page par SVG (mm), règle de 10 cm et légende dans une bande sous le dessin. */
async function scalePdf(
  title: string,
  pages: { svg: string; widthMm: number; heightMm: number; caption: string }[],
) {
  const band = 16;
  const first = pages[0];
  const pdf = createPdf({ size: [first.widthMm * MM, (first.heightMm + band) * MM], title });
  registerTextFonts(pdf.doc);
  pages.forEach((page, i) => {
    const w = Math.max(page.widthMm, 130);
    if (i) pdf.doc.addPage({ size: [w * MM, (page.heightMm + band) * MM], margin: 0 });
    drawSvg(pdf.doc, page.svg, 0, 0, page.widthMm * MM, page.heightMm * MM, 'stretch');
    const y = (page.heightMm + 4) * MM;
    pdf.doc.save().lineWidth(0.5).strokeColor('#000000');
    pdf.doc
      .moveTo(2 * MM, y)
      .lineTo(102 * MM, y)
      .stroke();
    for (let t = 0; t <= 10; t++)
      pdf.doc
        .moveTo((2 + t * 10) * MM, y)
        .lineTo((2 + t * 10) * MM, y + (t % 5 ? 2 : 3.5) * MM)
        .stroke();
    pdf.doc.restore();
    writeText(pdf.doc, `${page.caption} · règle de contrôle : 10 cm`, 2 * MM, y + 5 * MM, {
      size: 6.5,
      color: '#4b5563',
      width: (w - 4) * MM,
      lineBreak: false,
    });
  });
  return pdf.done();
}

/** Film de sérigraphie d'une couleur : la couleur en noir, les autres épargnées, repères de calage. */
function filmSvg(piece: PrintPiece, color: string, all: string[]) {
  const margin = 20;
  let art = pieceSvg(piece);
  const recolor = (hex: string) => {
    const lower = hex.toLowerCase();
    if (lower === color) return '#000000';
    return all.includes(lower) ? '#ffffff' : hex;
  };
  art = art.replace(/#[0-9a-f]{6}\b/gi, recolor);
  const inner = art.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  const W = piece.widthMm + margin * 2;
  const H = piece.heightMm + margin * 2;
  const target = (x: number, y: number) =>
    `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="#000" stroke-width="0.3"/><path d="M${x - 7} ${y}h14M${x} ${y - 7}v14" stroke="#000" stroke-width="0.3"/>`;
  const marks = [
    target(W / 2, 8),
    target(W / 2, H - 8),
    target(8, H / 2),
    target(W - 8, H / 2),
  ].join('');
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">${marks}<g transform="translate(${margin} ${margin})">${inner}</g></svg>`,
    widthMm: W,
    heightMm: H,
  };
}

const hexName = (hex: string) => hex.replace('#', '').toUpperCase();

/** Liste courte pour une alerte : les quatre premiers, puis le nombre restant. */
const listOf = (items: string[]) =>
  items.length > 4
    ? `${items.slice(0, 4).join(', ')} et ${items.length - 4} autres`
    : items.join(', ');

/** État du pack en cours de construction. */
interface PackContext {
  input: PackInput;
  spec: SupportSpec;
  pieces: PrintPiece[];
  root: string;
  mirror: boolean;
  sheet: SheetOptions;
  cutMarks: boolean;
  entries: ZipEntry[];
  warnings: string[];
  oversized: Set<string>;
  sheets: number;
}

const mirrorNote = (ctx: PackContext) => (ctx.mirror ? ' — miroir' : '');

const longDate = (date: Date) =>
  date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Photos sous 300 dpi à la taille réelle. */
function lowResolution(piece: PrintPiece) {
  return piece.elements.flatMap(({ el }) => {
    if (el.type !== 'image') return [];
    const dpi = el.naturalWidth / (el.width / 25.4);
    return dpi < DPI - 1
      ? [`${piece.key} : photo à ${Math.round(dpi)} dpi à la taille réelle (300 dpi conseillés).`]
      : [];
  });
}

/** Contrôles d'impression : photos sous 300 dpi, contenus impossibles pour le support. */
function checkPieces(ctx: PackContext) {
  // Pas d'encre blanche sur papier transfert clair ni en sublimation : le blanc reste la couleur du tissu.
  const light = ctx.input.support === 'TRANSFER_LIGHT' || ctx.input.support === 'SUBLIMATION_PAPER';
  const whiteOnLight: string[] = [];
  for (const piece of ctx.pieces) {
    ctx.warnings.push(...lowResolution(piece));
    const info = pieceColors(piece);
    if (light && info.colors.some((hex) => relativeLuminance(hex) > 0.9)) {
      whiteOnLight.push(piece.key);
    }
    if (ctx.spec.kind === 'film' && (info.photo || info.gradient)) {
      ctx.warnings.push(
        `${piece.key} : photo ou dégradé — en sérigraphie, prévoir une trame (demi-teintes) à l’atelier.`,
      );
    }
  }
  if (whiteOnLight.length) {
    ctx.warnings.push(
      `Le blanc ne s’imprime pas sur ce support (il prend la couleur du tissu) : ${listOf(whiteOnLight)}. Utilisez le papier pour textile foncé, le DTF ou le flex.`,
    );
  }
}

/** Pièces seules : SVG vectoriel (et PNG 300 dpi pour les supports imprimés). */
function addPieceFiles(ctx: PackContext) {
  const { kind } = ctx.spec;
  const printed = kind === 'transfer' || kind === 'direct';
  for (const piece of ctx.pieces) {
    const svg = pieceSvg(piece, { mirror: ctx.mirror });
    ctx.entries.push({ path: `${ctx.root}/pieces/${piece.key}.svg`, data: svg });
    if (!printed && !(kind === 'film' && piece.player)) continue;
    const png = png300(svg, piece.widthMm, piece.heightMm);
    if (png) ctx.entries.push({ path: `${ctx.root}/pieces/${piece.key}.png`, data: png });
  }
}

/** Un fichier par joueur : NUMERO_NOM_TAILLE.pdf, ses pièces à l'échelle 1:1. */
async function addPlayerFiles(ctx: PackContext) {
  const players = [...new Set(ctx.pieces.map((p) => p.player).filter((p): p is string => !!p))];
  for (const player of players) {
    const pages = ctx.pieces
      .filter((p) => p.player === player)
      .map((p) => ({
        svg: pieceSvg(p, { mirror: ctx.mirror }),
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        caption: `${p.key} — ${p.zone.label} — ${mm(p.widthMm)} × ${mm(p.heightMm)} mm${mirrorNote(ctx)}`,
      }));
    ctx.entries.push({
      path: `${ctx.root}/joueurs/${player}.pdf`,
      data: await scalePdf(`${ctx.input.design.name} — ${player}`, pages),
    });
  }
}

function addOversized(ctx: PackContext, list: PrintPiece[]) {
  for (const p of list) ctx.oversized.add(`${p.key} (${mm(p.widthMm)} × ${mm(p.heightMm)} mm)`);
}

/** Planches de transfert : tous les exemplaires imbriqués, PDF vectoriel et PNG 300 dpi. */
async function addTransferSheets(ctx: PackContext) {
  const pack = packPieces(ctx.pieces, ctx.sheet);
  addOversized(ctx, pack.oversized);
  for (const [i, page] of pack.pages.entries()) {
    const svg = sheetSvg(page, { mirror: ctx.mirror, cutMarks: ctx.cutMarks });
    const name = `${ctx.root}/planches/planche-${i + 1}`;
    const count = `${page.placements.length} pièces`;
    const caption = `${ctx.spec.label} — planche ${i + 1}/${pack.pages.length} — ${count}${mirrorNote(ctx)}`;
    ctx.entries.push({
      path: `${name}.pdf`,
      data: await scalePdf(`${ctx.input.design.name} — planche ${i + 1}`, [
        { svg, caption, widthMm: page.widthMm, heightMm: page.heightMm },
      ]),
    });
    const png = png300(svg, page.widthMm, page.heightMm);
    if (png) ctx.entries.push({ path: `${name}.png`, data: png });
    else
      ctx.warnings.push(
        `Planche ${i + 1} : trop grande pour un PNG, utilisez le PDF vectoriel (ou les PNG des pièces).`,
      );
  }
  ctx.sheets += pack.pages.length;
}

/** Couches de découpe de chaque pièce, calculées une fois ; contenus non découpables signalés. */
function cutLayersOf(ctx: PackContext) {
  const layers = new Map<PrintPiece, CutLayer[]>();
  const skipped = new Set<string>();
  for (const piece of ctx.pieces) {
    const result = pieceCutLayers(piece);
    layers.set(piece, result.layers);
    for (const reason of result.skipped) skipped.add(`${piece.key} : ${reason}`);
  }
  ctx.warnings.push(...skipped);
  return (piece: PrintPiece) => layers.get(piece) ?? [];
}

/** Une couleur de film : ses contours imbriqués sur leurs planches (SVG, DXF, PDF 1:1). */
async function addCutColor(
  ctx: PackContext,
  layersOf: (piece: PrintPiece) => CutLayer[],
  color: string,
  folder: string,
) {
  const film = hexName(color);
  const withColor = ctx.pieces.filter((p) => layersOf(p).some((l) => l.color === color));
  const pack = packPieces(withColor, ctx.sheet);
  addOversized(ctx, pack.oversized);
  for (const [i, page] of pack.pages.entries()) {
    const polygons = sheetPolygons(page, layersOf, color, ctx.mirror);
    const svg = cutSvg(page.widthMm, page.heightMm, polygons, color);
    const name = `${folder}/planche-${i + 1}`;
    const count = `${polygons.length} contours`;
    const caption = `Film ${film} — planche ${i + 1}/${pack.pages.length} — ${count}${mirrorNote(ctx)}`;
    ctx.entries.push(
      { path: `${name}.svg`, data: svg },
      { path: `${name}.dxf`, data: cutDxf(page.heightMm, polygons, `FILM_${film}`) },
      {
        path: `${name}.pdf`,
        data: await scalePdf(`${ctx.input.design.name} — découpe ${film}`, [
          { svg, caption, widthMm: page.widthMm, heightMm: page.heightMm },
        ]),
      },
    );
  }
  ctx.sheets += pack.pages.length;
}

/** Découpe : un dossier par couleur de film, chaque couleur imbriquée sur sa propre planche. */
async function addCutFiles(ctx: PackContext) {
  const layersOf = cutLayersOf(ctx);
  const colors = [...new Set(ctx.pieces.flatMap((p) => layersOf(p).map((l) => l.color)))];
  for (const [i, color] of colors.entries()) {
    await addCutColor(ctx, layersOf, color, `${ctx.root}/decoupe/${i + 1}-${hexName(color)}`);
  }
  // Logos : SVG vectoriels à séparer par couleur dans le logiciel de découpe.
  for (const piece of ctx.pieces) {
    if (!piece.elements.some(({ el }) => el.type === 'svg')) continue;
    ctx.entries.push({
      path: `${ctx.root}/logos/${piece.key}.svg`,
      data: pieceSvg(piece, { mirror: ctx.mirror }),
    });
  }
}

/** Sérigraphie : un film positif par couleur pour chaque visuel commun. */
async function addFilms(ctx: PackContext) {
  for (const piece of ctx.pieces.filter((p) => !p.player)) {
    const { colors } = pieceColors(piece);
    const folder = `${ctx.root}/films/${piece.key}`;
    for (const [i, color] of colors.entries()) {
      const film = filmSvg(piece, color, colors);
      const caption = `${piece.key} — film ${i + 1}/${colors.length} : ${hexName(color)} — positif, sans miroir`;
      ctx.entries.push({
        path: `${folder}/${i + 1}-${hexName(color)}.pdf`,
        data: await scalePdf(`${ctx.input.design.name} — film ${hexName(color)}`, [
          { ...film, caption },
        ]),
      });
    }
    const preview = png300(pieceSvg(piece), piece.widthMm, piece.heightMm);
    if (preview) ctx.entries.push({ path: `${folder}/apercu.png`, data: preview });
  }
  if (ctx.pieces.some((p) => p.player)) {
    ctx.warnings.push(
      'Noms et numéros : fichiers fournis dans « joueurs » et « pieces », à réaliser en flex ou en transfert.',
    );
  }
}

type PlanZone = PlacementZone & { view: string };

/** Zone du plan : une seule pièce, la plus grande (les joueurs se superposent au même endroit). */
function planZone(list: PrintPiece[]): PlanZone {
  const { zone } = list[0];
  const rect = zoneRect(zone);
  const largest = list.reduce(
    (a, b) => (b.widthMm * b.heightMm > a.widthMm * a.heightMm ? b : a),
    list[0],
  );
  return {
    ...rect,
    label: zone.label,
    view: zone.view,
    pieces: [
      {
        x: rect.x + largest.offsetXMm,
        y: rect.y + largest.offsetYMm,
        width: largest.widthMm,
        height: largest.heightMm,
        // Silhouette grise : le dessin reste visible, même blanc, pour aligner le transfert.
        artwork: pieceMarkup(largest, 'g').replace(/#[0-9a-f]{6}\b/gi, '#000000'),
      },
    ],
  };
}

/** Gabarits de positionnement 1:1, zone par zone (taille de référence). */
async function addPlacementTemplates(ctx: PackContext, ref: Size, roster: boolean) {
  const atRef = (p: PrintPiece) => p.sizes.includes(ref.label) || (!roster && p.sizes.length > 0);
  const byZone = new Map<string, PrintPiece[]>();
  for (const p of ctx.pieces.filter(atRef)) {
    byZone.set(p.zone.key, [...(byZone.get(p.zone.key) ?? []), p]);
  }
  const zones: PlanZone[] = [];
  for (const [key, list] of byZone) {
    const zone = planZone(list);
    zones.push(zone);
    ctx.entries.push({
      path: `gabarits/${key}-${ref.label}.pdf`,
      data: await placementTemplatePdf({ zone, title: ctx.input.design.name, size: ref.label }),
    });
  }
  return zones;
}

/** Polices utilisées et leur licence. */
function fontsOf(elements: PrintElement[]) {
  const fonts = new Map<string, string>();
  for (const el of elements) {
    if (el.content.text === undefined) continue;
    const font = getFont(el.content.fontId ?? 'montserrat');
    fonts.set(font.name, `${font.license} (libre, usage commercial autorisé)`);
  }
  return [...fonts.entries()].map(([name, license]) => ({ name, license }));
}

/** Couleurs et zones où elles apparaissent. */
function colorsOf(pieces: PrintPiece[]) {
  const usage = new Map<string, Set<string>>();
  for (const piece of pieces) {
    for (const hex of pieceColors(piece).colors) {
      usage.set(hex, (usage.get(hex) ?? new Set()).add(piece.zone.label));
    }
  }
  return [...usage.entries()].map(([hex, zones]) => ({ hex, usage: [...zones].join(', ') }));
}

/** Récapitulatif par taille, dans l'ordre du gabarit. */
function sizeSummary(sizes: Size[], garments: PackPlayer[]) {
  const counts = new Map<string, number>();
  for (const g of garments) counts.set(g.size, (counts.get(g.size) ?? 0) + g.quantity);
  const order = new Map(sizes.map((s, i) => [s.label, i]));
  return [...counts.entries()]
    .sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
    .map(([label, count]) => ({ label, count }));
}

function techSheetData(
  ctx: PackContext,
  collected: { ref: Size; garments: PackPlayer[]; roster: boolean },
  zones: PlanZone[],
): TechSheetData {
  const { input, spec, mirror, pieces, warnings } = ctx;
  const { design } = input;
  const views = [...new Set(zones.map((z) => z.view))].map((view) => ({
    label: VIEW_LABELS[view] ?? view,
    zones: zones.filter((z) => z.view === view),
  }));
  const proof = design.proofUrl
    ? { url: design.proofUrl, approvedAt: design.approvedAt ? longDate(design.approvedAt) : null }
    : null;
  const players = collected.roster
    ? collected.garments.map((g) => ({
        number: g.number,
        name: g.displayName,
        size: g.size,
        quantity: g.quantity,
        role: g.role,
      }))
    : [];
  return {
    mirror,
    proof,
    views,
    players,
    warnings,
    title: design.name,
    template: design.template,
    technique: TECHNIQUE_LABELS[design.technique],
    support: spec.label,
    garmentColor: design.garmentColor,
    size: collected.ref.label,
    generatedAt: longDate(input.now ?? new Date()),
    pieces: pieces.map((p) => ({
      key: p.key,
      zone: p.zone.label,
      sizes: p.sizes.join(', '),
      widthMm: p.widthMm,
      heightMm: p.heightMm,
      placement: placementText(p),
      quantity: p.quantity,
    })),
    colors: colorsOf(pieces),
    fonts: fontsOf(input.elements),
    sizes: sizeSummary(input.sizes, collected.garments),
    instructions: [
      ...spec.instructions,
      'Imprimer les PDF à 100 % (taille réelle) et vérifier la règle de 10 cm.',
      PRESS_NOTE,
    ],
  };
}

/** Archive complète du pack atelier. */
export async function buildProductionPack(input: PackInput): Promise<PackResult> {
  const spec = SUPPORTS[input.support];
  const collected = collectPieces(input);
  const { pieces } = collected;
  const ctx: PackContext = {
    input,
    spec,
    pieces,
    root: spec.folder,
    // Impression directe et broderie : rien n'est retourné.
    mirror: input.mirror && spec.kind !== 'direct' && spec.kind !== 'embroidery',
    sheet: input.sheet ?? spec.sheet,
    cutMarks: input.cutMarks ?? spec.cutMarks,
    entries: [],
    warnings: [...new Set(pieces.flatMap((p) => p.warnings))],
    oversized: new Set(),
    sheets: 0,
  };
  if (!pieces.length) ctx.warnings.push('Aucun élément à imprimer sur cette tenue.');

  checkPieces(ctx);
  addPieceFiles(ctx);
  await addPlayerFiles(ctx);
  if (spec.kind === 'transfer') await addTransferSheets(ctx);
  if (spec.kind === 'cut') await addCutFiles(ctx);
  if (spec.kind === 'film') await addFilms(ctx);
  if (ctx.oversized.size) {
    ctx.warnings.push(
      `Pièces trop grandes pour la planche : ${listOf([...ctx.oversized])}. Choisissez un format plus grand ou un rouleau.`,
    );
  }

  const zones = await addPlacementTemplates(ctx, collected.ref, collected.roster);
  const techSheet = await techSheetPdf(techSheetData(ctx, collected, zones));
  ctx.entries.push(
    { path: 'fiche-technique.pdf', data: techSheet },
    { path: 'LISEZ-MOI.txt', data: readme(ctx) },
  );
  return {
    techSheet,
    entries: ctx.entries,
    warnings: ctx.warnings,
    pieces: pieces.length,
    sheets: ctx.sheets,
  };
}

/** Dossier propre à chaque famille de support, décrit dans le LISEZ-MOI. */
const KIND_FOLDERS: Partial<Record<SupportKind, string>> = {
  transfer: 'planches/ : planches prêtes à imprimer (PDF 1:1 et PNG 300 dpi).',
  cut: 'decoupe/ : un dossier par couleur de film (SVG, DXF en mm, PDF 1:1).',
  film: 'films/ : un film positif par couleur et par visuel.',
};

function readme(ctx: PackContext) {
  const { input, spec, mirror, warnings } = ctx;
  const png = spec.kind === 'transfer' || spec.kind === 'direct' ? ', PNG 300 dpi' : '';
  const folder = KIND_FOLDERS[spec.kind];
  const lines = [
    `PACK ATELIER — ${input.design.name}`,
    '',
    `Support : ${spec.label}`,
    `Miroir : ${mirror ? 'oui' : 'non'}`,
    `Pièces : ${ctx.pieces.length} · planches : ${ctx.sheets}`,
    '',
    'Contenu',
    '- fiche-technique.pdf : pièces, plan de placement coté, couleurs, polices, effectif et récapitulatif par taille.',
    '- gabarits/ : gabarits de positionnement à l’échelle 1:1, à imprimer à 100 % pour poser les transferts.',
    `- ${spec.folder}/pieces/ : chaque pièce seule, à la taille réelle (SVG vectoriel${png}).`,
    `- ${spec.folder}/joueurs/ : un PDF par joueur, nommé NUMERO_NOM_TAILLE.`,
    ...(folder ? [`- ${spec.folder}/${folder}`] : []),
    '',
    'Consignes',
    ...spec.instructions.map((l) => `- ${l}`),
    `- ${PRESS_NOTE}`,
  ];
  if (warnings.length) lines.push('', 'Points à vérifier', ...warnings.map((w) => `- ${w}`));
  return `${lines.join('\r\n')}\r\n`;
}
