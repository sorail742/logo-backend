/**
 * Règles du module textile (cahier des charges §16), en fonctions pures pour être testées
 * sans base de données. Unités : millimètres ; repère : bas du col, au milieu ;
 * X positif = côté gauche du porteur (TEX-02).
 */
import type { DesignElementKind, PrintTechnique, SizeScaling } from '@prisma/client';
import { contrastRatio, relativeLuminance } from '../../shared/color';
import { parseCsv } from '../../shared/csv';

// ─── Types ───

export interface Zone {
  key: string;
  view: string;
  offsetXMm: number; // axe de la zone
  offsetYMm: number; // haut de la zone sous le col
  maxWidthMm: number;
  maxHeightMm: number;
  scaling: SizeScaling;
}

export interface Size {
  label: string;
  chestWidthMm: number;
  bodyLengthMm: number;
}

/** Position de l'élément : coin haut-gauche relatif au coin haut-gauche de sa zone. */
export interface Element {
  id?: string;
  zoneKey: string;
  kind: DesignElementKind;
  widthMm: number;
  heightMm: number;
  offsetXMm: number;
  offsetYMm: number;
  content: ElementContent;
}

export interface ElementContent {
  text?: string;
  colors?: string[]; // HEX
  edgeColors?: string[]; // HEX : couleurs au contact du tissu (contour extérieur), sinon `colors`
  strokeMm?: number; // épaisseur de trait la plus fine
  style?: string; // CLASSIC_OUTLINE, GEOMETRIC_INLINE, NOTCHED, RIBBON_3D, HALFTONE, TEXTURED
  gradient?: boolean;
  pixelWidth?: number; // images matricielles
  source?: 'library' | 'brand-kit' | 'upload';
  rightsAttested?: boolean;
}

/** Règles d'un préréglage sportif (RulePreset.rules). Hauteurs et traits en mm. */
export interface PresetRules {
  /** true : non-conformité bloquante ; false : simple avertissement (TEX-10). */
  blocking?: boolean;
  numbers?: {
    back?: Range;
    front?: Range;
    shorts?: Range;
    stroke?: Range;
    maxColors?: number;
    /** Numéros autorisés : liste explicite, ou intervalle. */
    allowed?: string[];
    min?: number;
    max?: number;
  };
  names?: { height?: Range; minGapAboveNumberMm?: number };
  /** Écart minimal entre publicités/logos et numéros (FIBA : 50 mm). */
  adsGapFromNumbersMm?: number;
  /** Styles de police interdits (ex. RIBBON_3D en UEFA). */
  forbiddenStyles?: string[];
}

interface Range {
  min?: number;
  max?: number;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  code: string;
  severity: Severity;
  message: string;
  elementId?: string;
  zoneKey?: string;
}

// ─── Adaptation des zones à la taille (TEX-03) ───

export const isChildSize = (s: Size) => /(?:ans|yrs|y)$/i.test(s.label);

/** Facteur d'échelle d'une zone pour une taille, relativement à la taille de référence. */
export function zoneScale(zone: Pick<Zone, 'scaling'>, size: Size, ref: Size): number {
  const ratio = size.chestWidthMm / ref.chestWidthMm;
  if (zone.scaling === 'PROPORTIONAL') return ratio;
  // FIXE : même taille pour toutes les tailles adultes ; réduite pour un enfant si nécessaire.
  return isChildSize(size) ? Math.min(1, ratio) : 1;
}

export function resolveZone(zone: Zone, size: Size, ref: Size): Zone {
  const k = zoneScale(zone, size, ref);
  return {
    ...zone,
    offsetXMm: round(zone.offsetXMm * k),
    offsetYMm: round(
      zone.offsetYMm * (zone.scaling === 'PROPORTIONAL' ? size.bodyLengthMm / ref.bodyLengthMm : 1),
    ),
    maxWidthMm: round(zone.maxWidthMm * k),
    maxHeightMm: round(zone.maxHeightMm * k),
  };
}

// ─── Ajustement des noms longs (TEX-23) ───

/** Largeur moyenne d'un caractère rapportée à sa hauteur, pour les lettrages sportifs. */
export const CHAR_WIDTH_RATIO = 0.62;
export const MIN_CONDENSATION = 0.8;

export interface TextFit {
  heightMm: number;
  scaleX: number;
  widthMm: number;
  fits: boolean;
}

/** Condense jusqu'à 80 %, puis réduit la hauteur sans descendre sous le minimum. */
export function fitText(
  text: string,
  maxWidthMm: number,
  heightMm: number,
  minHeightMm = 0,
): TextFit {
  const chars = [...text.trim()].length || 1;
  const natural = chars * heightMm * CHAR_WIDTH_RATIO;
  if (natural <= maxWidthMm) return { heightMm, scaleX: 1, widthMm: round(natural), fits: true };

  const scaleX = maxWidthMm / natural;
  if (scaleX >= MIN_CONDENSATION)
    return { heightMm, scaleX: round(scaleX, 3), widthMm: maxWidthMm, fits: true };

  const reduced = maxWidthMm / (chars * CHAR_WIDTH_RATIO * MIN_CONDENSATION);
  const h = Math.max(reduced, minHeightMm);
  return {
    heightMm: round(h),
    scaleX: MIN_CONDENSATION,
    widthMm: round(chars * h * CHAR_WIDTH_RATIO * MIN_CONDENSATION),
    fits: reduced >= minHeightMm,
  };
}

// ─── Technique d'impression (§16.7, TEX-24) ───

/** Épaisseur minimale par défaut, réglable dans le profil atelier. */
export const DEFAULT_MIN_STROKE_MM: Record<PrintTechnique, number> = {
  SCREEN_PRINT: 0.5,
  HEAT_TRANSFER_VINYL: 2,
  FLOCK: 3,
  DTF: 1,
  DTG: 0.5,
  SUBLIMATION: 0.3,
  EMBROIDERY: 1.5,
};

/** Techniques compatibles par famille de style de numéros (§16.4). */
export const STYLE_TECHNIQUES: Record<string, PrintTechnique[]> = {
  CLASSIC_OUTLINE: ['HEAT_TRANSFER_VINYL', 'SCREEN_PRINT', 'DTF', 'SUBLIMATION'],
  GEOMETRIC_INLINE: ['HEAT_TRANSFER_VINYL', 'SCREEN_PRINT', 'DTF', 'SUBLIMATION'],
  NOTCHED: ['HEAT_TRANSFER_VINYL', 'SCREEN_PRINT', 'DTF', 'SUBLIMATION'],
  RIBBON_3D: ['SUBLIMATION', 'DTF', 'DTG'],
  // Trame de points : écrans de sérigraphie ou impression numérique ; trop fine pour la découpe.
  HALFTONE: ['SCREEN_PRINT', 'DTF', 'DTG', 'SUBLIMATION'],
  // Rayures, carbone, usé, griffes : motifs fins, impression plutôt que découpe.
  TEXTURED: ['SCREEN_PRINT', 'DTF', 'DTG', 'SUBLIMATION'],
};

/** Nom affiché des familles de style. */
const STYLE_LABELS: Record<string, string> = {
  CLASSIC_OUTLINE: 'contour',
  GEOMETRIC_INLINE: 'liseré',
  NOTCHED: 'crans',
  RIBBON_3D: 'relief 3D',
  HALFTONE: 'trame de points',
  TEXTURED: 'texture',
};

const CUT_TECHNIQUES: PrintTechnique[] = ['HEAT_TRANSFER_VINYL', 'FLOCK'];
export const MIN_RASTER_DPI = 300;
export const MIN_EMBROIDERY_TEXT_MM = 5;
export const MIN_GARMENT_CONTRAST = 3;

// ─── Couleurs : voir shared/color ───

export { contrastRatio, relativeLuminance };

// ─── Contrôle de conformité (TEX-10, TEX-34, TEX-35, §16.7, §16.9) ───

export interface CheckInput {
  zones: Zone[];
  elements: Element[];
  technique: PrintTechnique;
  garmentColor: string;
  preset?: PresetRules | null;
  minStrokeMm?: Partial<Record<PrintTechnique, number>>; // profil atelier
}

const FULL_ZONE_CONFLICTS: Record<string, string[]> = {
  front_full: ['left_chest', 'right_chest', 'front_sponsor'],
  back_full: ['back_sponsor'],
};

const AD_KINDS: DesignElementKind[] = ['LOGO', 'SPONSOR', 'IMAGE'];

export function checkDesign(input: CheckInput): Issue[] {
  const zones = new Map(input.zones.map((z) => [z.key, z]));
  const preset = input.preset ?? null;
  const presetSeverity: Severity = preset?.blocking === false ? 'warning' : 'error';
  const issues = zoneOverlapIssues(new Set(input.elements.map((e) => e.zoneKey)));

  for (const el of input.elements) {
    const zone = zones.get(el.zoneKey);
    if (!zone) {
      issues.push({
        elementId: el.id,
        zoneKey: el.zoneKey,
        code: 'UNKNOWN_ZONE',
        severity: 'error',
        message: `Zone ${el.zoneKey} absente de ce support`,
      });
      continue;
    }
    issues.push(...elementIssues(el, zone, input));
    // Règlement sportif (§16.3)
    if (preset) issues.push(...checkPresetElement(el, el.content ?? {}, preset, presetSeverity));
  }

  if (preset) issues.push(...checkPresetLayout(input.elements, zones, preset, presetSeverity));
  issues.push(...garmentIssues(input));
  return issues;
}

/** Une zone pleine remplace les zones qu'elle recouvre. */
function zoneOverlapIssues(used: Set<string>): Issue[] {
  const issues: Issue[] = [];
  for (const [full, conflicts] of Object.entries(FULL_ZONE_CONFLICTS)) {
    const clash = conflicts.filter((c) => used.has(c));
    if (used.has(full) && clash.length) {
      issues.push({
        code: 'ZONE_OVERLAP',
        severity: 'error',
        zoneKey: full,
        message: `La zone ${full} remplace ${clash.join(', ')} : elles ne peuvent pas être utilisées ensemble`,
      });
    }
  }
  return issues;
}

/** Contrôles d'un élément dans sa zone : placement, droits, contraste, technique. */
function elementIssues(el: Element, zone: Zone, input: CheckInput): Issue[] {
  const ref = { elementId: el.id, zoneKey: el.zoneKey };
  const c = el.content ?? {};
  const issues: Issue[] = [];

  // Élément dans sa zone (TEX-34)
  if (
    el.offsetXMm < 0 ||
    el.offsetYMm < 0 ||
    el.offsetXMm + el.widthMm > zone.maxWidthMm + 0.5 ||
    el.offsetYMm + el.heightMm > zone.maxHeightMm + 0.5
  ) {
    issues.push({
      ...ref,
      code: 'OUT_OF_ZONE',
      severity: 'error',
      message: `L'élément sort de la zone ${zone.key} (${zone.maxWidthMm} × ${zone.maxHeightMm} mm)`,
    });
  }

  // Droits (§16.9)
  if (AD_KINDS.includes(el.kind) && c.source === 'upload' && !c.rightsAttested) {
    issues.push({
      ...ref,
      code: 'RIGHTS_REQUIRED',
      severity: 'error',
      message: 'Logo importé : attestez détenir les droits ou l’autorisation de son titulaire',
    });
  }

  // Contraste avec le tissu (TEX-35) : couleurs au bord des lettres (le liseré ou la trame,
  // à l'intérieur, ne touchent pas le tissu).
  for (const color of c.edgeColors?.length ? c.edgeColors : (c.colors ?? [])) {
    const ratio = contrastRatio(color, input.garmentColor);
    if (ratio < MIN_GARMENT_CONTRAST) {
      issues.push({
        ...ref,
        code: 'LOW_CONTRAST',
        severity: 'warning',
        message: `Contraste faible entre ${color} et le tissu ${input.garmentColor} (${ratio.toFixed(1)}:1)`,
      });
    }
  }

  return [...issues, ...techniqueIssues(el, c, input, ref)];
}

/** Faisabilité selon la technique (§16.7, TEX-24, TEX-25) et résolution des images. */
function techniqueIssues(
  el: Element,
  c: ElementContent,
  input: CheckInput,
  ref: Pick<Issue, 'elementId' | 'zoneKey'>,
): Issue[] {
  const issues: Issue[] = [];
  const minStroke = input.minStrokeMm?.[input.technique] ?? DEFAULT_MIN_STROKE_MM[input.technique];
  if (c.strokeMm !== undefined && c.strokeMm < minStroke) {
    issues.push({
      ...ref,
      code: 'STROKE_TOO_THIN',
      severity: 'error',
      message: `Trait de ${c.strokeMm} mm, minimum ${minStroke} mm pour cette technique`,
    });
  }
  if (
    CUT_TECHNIQUES.includes(input.technique) &&
    (el.kind === 'IMAGE' || el.kind === 'PATTERN' || c.gradient)
  ) {
    issues.push({
      ...ref,
      code: 'NOT_CUTTABLE',
      severity: 'error',
      message: 'Le flex et le flocage ne permettent ni image, ni motif, ni dégradé',
    });
  }
  if (
    c.style &&
    STYLE_TECHNIQUES[c.style] &&
    !STYLE_TECHNIQUES[c.style].includes(input.technique)
  ) {
    issues.push({
      ...ref,
      code: 'STYLE_TECHNIQUE',
      severity: 'error',
      message: `La forme « ${STYLE_LABELS[c.style] ?? c.style} » n'est pas réalisable avec cette technique`,
    });
  }
  if (input.technique === 'EMBROIDERY' && isText(el.kind) && el.heightMm < MIN_EMBROIDERY_TEXT_MM) {
    issues.push({
      ...ref,
      code: 'EMBROIDERY_TEXT',
      severity: 'error',
      message: `Texte brodé d'au moins ${MIN_EMBROIDERY_TEXT_MM} mm de haut`,
    });
  }
  const dpi =
    c.pixelWidth !== undefined && el.widthMm > 0 ? c.pixelWidth / (el.widthMm / 25.4) : null;
  if (dpi !== null && dpi < MIN_RASTER_DPI) {
    issues.push({
      ...ref,
      code: 'LOW_RESOLUTION',
      severity: 'error',
      message: `Image à ${Math.round(dpi)} dpi à taille réelle, ${MIN_RASTER_DPI} dpi requis`,
    });
  }
  return issues;
}

/** Sublimation : polyester clair uniquement ; DTG : alerte sur vêtement foncé. */
function garmentIssues(input: CheckInput): Issue[] {
  const lum = relativeLuminance(input.garmentColor);
  const issues: Issue[] = [];
  if (input.technique === 'SUBLIMATION' && lum < 0.6) {
    issues.push({
      code: 'SUBLIMATION_DARK',
      severity: 'error',
      message: 'La sublimation exige un tissu polyester clair',
    });
  }
  if (input.technique === 'DTG' && lum < 0.2) {
    issues.push({
      code: 'DTG_DARK',
      severity: 'warning',
      message: 'DTG sur tissu foncé : sous-couche blanche nécessaire',
    });
  }
  return issues;
}

function checkPresetElement(
  el: Element,
  c: ElementContent,
  preset: PresetRules,
  severity: Severity,
): Issue[] {
  const issues: Issue[] = [];
  const ref = { elementId: el.id, zoneKey: el.zoneKey };

  if (c.style && preset.forbiddenStyles?.includes(c.style)) {
    issues.push({
      ...ref,
      code: 'STYLE_FORBIDDEN',
      severity,
      message: `Style ${c.style} interdit par le règlement`,
    });
  }
  if (el.kind === 'PLAYER_NUMBER' && preset.numbers) {
    issues.push(...numberIssues(el, c, preset.numbers, severity, ref));
  }
  if (el.kind === 'PLAYER_NAME' && preset.names?.height) {
    issues.push(
      ...rangeIssues(
        el.heightMm,
        preset.names.height,
        'Nom au dos : hauteur des lettres',
        'NAME_HEIGHT',
        severity,
        ref,
      ),
    );
  }
  return issues;
}

/** Hauteurs admises et libellé d'un numéro selon sa zone (dos, short ou devant). */
function numberPlacement(zoneKey: string, n: NonNullable<PresetRules['numbers']>) {
  if (zoneKey.startsWith('back')) return { range: n.back, label: 'Numéro dos' };
  if (zoneKey.startsWith('shorts')) return { range: n.shorts, label: 'Numéro de short' };
  return { range: n.front, label: 'Numéro devant' };
}

/** Numéro : hauteur, épaisseur du trait et nombre de couleurs selon le règlement. */
function numberIssues(
  el: Element,
  c: ElementContent,
  n: NonNullable<PresetRules['numbers']>,
  severity: Severity,
  ref: Pick<Issue, 'elementId' | 'zoneKey'>,
): Issue[] {
  const { range, label } = numberPlacement(el.zoneKey, n);
  const issues = rangeIssues(
    el.heightMm,
    range,
    `${label} : hauteur`,
    'NUMBER_HEIGHT',
    severity,
    ref,
  );
  if (c.strokeMm !== undefined) {
    issues.push(
      ...rangeIssues(
        c.strokeMm,
        n.stroke,
        'Numéro : épaisseur du trait',
        'NUMBER_STROKE',
        severity,
        ref,
      ),
    );
  }
  if (n.maxColors !== undefined && (c.colors?.length ?? 0) > n.maxColors) {
    issues.push({
      ...ref,
      code: 'NUMBER_COLORS',
      severity,
      message: `Numéro en ${n.maxColors} couleur(s) au maximum`,
    });
  }
  return issues;
}

type Placed = { view: string; x1: number; x2: number; y1: number; y2: number };

/** Écarts entre éléments : nom au-dessus du numéro, publicités loin des numéros. */
function checkPresetLayout(
  elements: Element[],
  zones: Map<string, Zone>,
  preset: PresetRules,
  severity: Severity,
): Issue[] {
  const abs = (e: Element): Placed | null => {
    const z = zones.get(e.zoneKey);
    if (!z) return null;
    // X en repère « gauche du porteur positive » : bord gauche de la zone = axe + largeur / 2.
    const left = z.offsetXMm + z.maxWidthMm / 2 - e.offsetXMm;
    const top = z.offsetYMm + e.offsetYMm;
    return { view: z.view, x1: left - e.widthMm, x2: left, y1: top, y2: top + e.heightMm };
  };
  const numbers = elements.filter((e) => e.kind === 'PLAYER_NUMBER');
  const gap = preset.names?.minGapAboveNumberMm;
  const adGap = preset.adsGapFromNumbersMm;
  return [
    ...(gap === undefined ? [] : nameGapIssues(elements, numbers, abs, gap, severity)),
    ...(adGap === undefined ? [] : adGapIssues(elements, numbers, abs, adGap, severity)),
  ];
}

/** Paires (élément, numéro) placées sur une même vue. */
function sameViewPairs(items: Element[], numbers: Element[], abs: (e: Element) => Placed | null) {
  const pairs: { item: Element; a: Placed; b: Placed }[] = [];
  for (const item of items) {
    const a = abs(item);
    for (const num of numbers) {
      const b = abs(num);
      if (a && b && a.view === b.view) pairs.push({ item, a, b });
    }
  }
  return pairs;
}

function nameGapIssues(
  elements: Element[],
  numbers: Element[],
  abs: (e: Element) => Placed | null,
  gap: number,
  severity: Severity,
): Issue[] {
  const names = elements.filter((e) => e.kind === 'PLAYER_NAME');
  return sameViewPairs(names, numbers, abs)
    .filter(({ a, b }) => b.y1 - a.y2 < gap)
    .map(({ item, a, b }) => ({
      elementId: item.id,
      zoneKey: item.zoneKey,
      code: 'NAME_NUMBER_GAP',
      severity,
      message: `Le nom doit être au moins ${gap / 10} cm au-dessus du numéro (écart actuel ${Math.max(0, round(b.y1 - a.y2)) / 10} cm)`,
    }));
}

function adGapIssues(
  elements: Element[],
  numbers: Element[],
  abs: (e: Element) => Placed | null,
  adGap: number,
  severity: Severity,
): Issue[] {
  const ads = elements.filter((e) => AD_KINDS.includes(e.kind));
  return sameViewPairs(ads, numbers, abs)
    .filter(({ a, b }) => {
      const dx = Math.max(0, a.x1 - b.x2, b.x1 - a.x2);
      const dy = Math.max(0, a.y1 - b.y2, b.y1 - a.y2);
      return Math.hypot(dx, dy) < adGap;
    })
    .map(({ item }) => ({
      elementId: item.id,
      zoneKey: item.zoneKey,
      code: 'AD_NUMBER_GAP',
      severity,
      message: `Publicités et logos à au moins ${adGap / 10} cm des numéros`,
    }));
}

function rangeIssues(
  value: number,
  range: Range | undefined,
  label: string,
  code: string,
  severity: Severity,
  ref: Pick<Issue, 'elementId' | 'zoneKey'>,
): Issue[] {
  if (!range) return [];
  const cm = (mm: number) => `${round(mm / 10, 1)} cm`;
  if (range.min !== undefined && value < range.min) {
    return [
      { ...ref, code, severity, message: `${label} de ${cm(value)}, minimum ${cm(range.min)}` },
    ];
  }
  if (range.max !== undefined && value > range.max) {
    return [
      { ...ref, code, severity, message: `${label} de ${cm(value)}, maximum ${cm(range.max)}` },
    ];
  }
  return [];
}

// ─── Effectif (TEX-11, TEX-41) ───

export interface RosterRow {
  playerName: string;
  displayName: string;
  number?: string | null;
  size: string;
  quantity?: number;
  role?: string | null;
}

export function isNumberAllowed(number: string, preset?: PresetRules | null): boolean {
  const n = preset?.numbers;
  if (!n) return /^\d{1,3}$/.test(number);
  if (n.allowed) return n.allowed.includes(number);
  if (!/^\d{1,2}$/.test(number) || (number.length === 2 && number.startsWith('0'))) return false;
  const v = Number(number);
  return v >= (n.min ?? 0) && v <= (n.max ?? 99);
}

export function checkRoster(
  rows: RosterRow[],
  sizes: string[],
  preset?: PresetRules | null,
): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, string>();
  rows.forEach((r, i) => {
    const line = `Ligne ${i + 1} (${r.playerName || '?'})`;
    if (!r.size) {
      issues.push({
        code: 'SIZE_MISSING',
        severity: 'error',
        message: `${line} : taille manquante`,
      });
    } else if (!sizes.includes(r.size)) {
      issues.push({
        code: 'SIZE_UNKNOWN',
        severity: 'error',
        message: `${line} : taille ${r.size} inconnue pour ce support`,
      });
    }
    if (r.number) {
      const other = seen.get(r.number);
      if (other) {
        issues.push({
          code: 'NUMBER_DUPLICATE',
          severity: 'error',
          message: `${line} : numéro ${r.number} déjà porté par ${other}`,
        });
      } else {
        seen.set(r.number, r.playerName);
      }
      if (!isNumberAllowed(r.number, preset)) {
        issues.push({
          code: 'NUMBER_FORBIDDEN',
          severity: 'error',
          message: `${line} : numéro ${r.number} non autorisé par le règlement`,
        });
      }
    }
  });
  return issues;
}

// ─── Import CSV (TEX-40) ───

const CSV_COLUMNS = ['nom', 'nom_imprime', 'numero', 'taille', 'poste', 'quantite'] as const;

/** Analyse le CSV d'effectif (séparateur , ou ;, guillemets gérés). */
export function parseRosterCsv(csv: string): { rows: RosterRow[]; errors: string[] } {
  const { header, rows: lines } = parseCsv(csv);
  if (!header.length) return { rows: [], errors: ['Fichier vide'] };
  const missing = CSV_COLUMNS.filter(
    (c) => c !== 'poste' && c !== 'quantite' && !header.includes(c),
  );
  if (missing.length) return { rows: [], errors: [`Colonnes manquantes : ${missing.join(', ')}`] };

  const rows: RosterRow[] = [];
  const errors: string[] = [];
  lines.forEach((get, i) => {
    const quantity = get.quantite ? Number(get.quantite) : 1;
    if (!get.nom) {
      errors.push(`Ligne ${i + 2} : nom manquant`);
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      errors.push(`Ligne ${i + 2} : quantité invalide`);
      return;
    }
    rows.push({
      playerName: get.nom,
      displayName: get.nom_imprime || get.nom.toUpperCase(),
      number: get.numero || null,
      size: (get.taille ?? '').toUpperCase(),
      quantity,
      role: get.poste || null,
    });
  });
  return { rows, errors };
}

/** Nom de fichier atelier : NUMERO_NOM_TAILLE (§16.8). */
export function productionFileName(row: RosterRow): string {
  const name = row.displayName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return [row.number ?? 'SANS-NUMERO', name, row.size].join('_');
}

function isText(kind: DesignElementKind) {
  return kind === 'TEXT' || kind === 'PLAYER_NAME' || kind === 'PLAYER_NUMBER';
}

function round(v: number, digits = 1) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
