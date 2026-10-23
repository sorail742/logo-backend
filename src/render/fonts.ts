import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';
import { bidiRuns, isNkoMark, nkoForms, type NkoForm } from './nko';

// Bibliothèque interne de polices (§5.5) : fichiers WOFF sous licence OFL versionnés dans
// assets/fonts (scripts/fetch-fonts.mjs). Le texte des logos est converti en tracés à partir
// de ces fichiers : l'export s'affiche sans la police installée.

export type FontCategory = 'sans' | 'serif' | 'display' | 'script';

export interface LibraryFont {
  id: string;
  name: string;
  category: FontCategory;
  license: 'OFL';
  weights: number[];
  /** Hauteurs au-dessus et au-dessous de la ligne de base, en em (lignes de texte du Studio). */
  ascent: number;
  descent: number;
  /** Fichiers par graisse : sous-ensemble latin puis latin étendu. */
  files: Record<string, string[]>;
  /** Écritures entièrement couvertes : latin, pular (ɓ ɗ ŋ ƴ), nko. */
  scripts: string[];
  /** Police de secours (écriture absente de la bibliothèque), non proposée aux utilisateurs. */
  fallback?: boolean;
}

export const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

/** Police de repli pour les caractères absents, et police des slogans sous le logo. */
export const FALLBACK_FONT = 'montserrat';

const MANIFEST = JSON.parse(
  readFileSync(join(FONTS_DIR, 'manifest.json'), 'utf8'),
) as LibraryFont[];

/** Polices proposées aux utilisateurs. */
export const FONTS: LibraryFont[] = MANIFEST.filter((f) => !f.fallback);
/** Polices de secours par écriture (N'Ko), essayées après la police de repli. */
const SCRIPT_FALLBACKS = MANIFEST.filter((f) => f.fallback);

const byId = new Map(MANIFEST.map((f) => [f.id, f]));
const loaded = new Map<string, opentype.Font>();

export function getFont(id: string): LibraryFont {
  return byId.get(id) ?? byId.get(FALLBACK_FONT)!;
}

export function isLibraryFont(id: string) {
  return byId.has(id) && !byId.get(id)!.fallback;
}

/** Plus proche graisse disponible. */
export function closestWeight(id: string, weight: number) {
  const { weights } = getFont(id);
  return weights.reduce(
    (best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best),
    weights[0],
  );
}

function load(file: string) {
  let font = loaded.get(file);
  if (!font) {
    font = opentype.loadSync(join(FONTS_DIR, file));
    loaded.set(file, font);
  }
  return font;
}

/** Vrai si le fichier de police contient le caractère (choix du sous-ensemble dans un PDF). */
export function fileHasGlyph(file: string, char: string) {
  return load(file).charToGlyphIndex(char) > 0;
}

/** Fichiers d'une police à la graisse la plus proche. */
const filesAt = (font: LibraryFont, weight: number) =>
  font.files[String(closestWeight(font.id, weight))];

/** Fichier de la police de secours qui contient ce caractère (écriture absente de la bibliothèque). */
export function scriptFallbackFile(char: string) {
  for (const fallback of SCRIPT_FALLBACKS) {
    const file = fallback.files[String(fallback.weights[0])].find((f) => fileHasGlyph(f, char));
    if (file) return file;
  }
  return undefined;
}

/**
 * Fichiers à essayer pour chaque caractère : la police demandée, la police de repli, puis les
 * polices de secours des autres écritures.
 */
function fontChain(id: string, weight: number): opentype.Font[] {
  const font = getFont(id);
  const files = [...filesAt(font, weight)];
  if (font.id !== FALLBACK_FONT) files.push(...filesAt(getFont(FALLBACK_FONT), weight));
  for (const fallback of SCRIPT_FALLBACKS) files.push(...filesAt(fallback, weight));
  return files.map(load);
}

const forms = new Map<opentype.Font, Map<string, Map<number, number>>>();

/** Glyphe de la forme contextuelle demandée (fonctionnalités init, medi, fina de la police). */
function formGlyph(font: opentype.Font, char: string, form: NkoForm) {
  const glyph = font.charToGlyph(char);
  if (!form) return glyph;
  let byForm = forms.get(font);
  if (!byForm) {
    byForm = new Map();
    forms.set(font, byForm);
  }
  let substitutions = byForm.get(form);
  if (!substitutions) {
    // getSingle existe dans opentype.js mais pas dans ses types.
    const { getSingle } = font.substitution as unknown as {
      getSingle(feature: string, script: string, language: string): { sub: number; by: number }[];
    };
    const list = getSingle.call(font.substitution, form, 'nko ', 'dflt');
    substitutions = new Map(list.map(({ sub, by }) => [sub, by]));
    byForm.set(form, substitutions);
  }
  const index = substitutions.get(glyph.index);
  return index === undefined ? glyph : font.glyphs.get(index);
}

export interface TextStyle {
  fontId: string;
  weight: number;
  size: number;
  /** Espacement ajouté entre deux caractères, en px. */
  letterSpacing?: number;
}

export interface ShapedText {
  width: number;
  /** Hauteur des capitales au-dessus de la ligne de base, en px. */
  capHeight: number;
  /** Tracé SVG du texte, ligne de base en `baseline`, ancré à gauche, au centre ou à droite. */
  toPath(x: number, baseline: number, anchor?: 'start' | 'middle' | 'end'): string;
  /**
   * Glyphes un à un, chacun centré sur l'origine et posé sur la ligne de base : `x` est le
   * centre du glyphe dans la ligne (texte le long d'un arc, cachets).
   */
  glyphs(): { x: number; d: string }[];
}

/**
 * Met en forme une ligne de texte (crénage, repli par caractère, segments de droite à gauche)
 * et la convertit en tracés.
 */
export function shapeText(text: string, style: TextStyle): ShapedText {
  const chain = fontChain(style.fontId, style.weight);
  const primary = chain[0];
  const spacing = style.letterSpacing ?? 0;
  const glyphs: { font: opentype.Font; glyph: opentype.Glyph; x: number; advance: number }[] = [];
  const pick = (char: string) => chain.find((f) => f.charToGlyphIndex(char) > 0) ?? primary;

  let x = 0;
  let previous = null as { font: opentype.Font; glyph: opentype.Glyph } | null;
  for (const run of bidiRuns(text)) {
    if (run.rtl) {
      x = placeRtl(run.text, x, style.size, pick, glyphs);
      previous = null;
      continue;
    }
    for (const char of Array.from(run.text)) {
      const font = pick(char);
      const glyph = font.charToGlyph(char);
      const scale = style.size / font.unitsPerEm;
      if (glyphs.length) {
        const kerning = previous?.font === font ? font.getKerningValue(previous.glyph, glyph) : 0;
        x += spacing + kerning * scale;
      }
      glyphs.push({ font, glyph, x, advance: (glyph.advanceWidth ?? 0) * scale });
      x += (glyph.advanceWidth ?? 0) * scale;
      previous = { font, glyph };
    }
  }

  const os2 = (primary.tables as { os2?: { sCapHeight?: number } }).os2;
  const capHeight =
    ((os2?.sCapHeight || primary.unitsPerEm * 0.7) / primary.unitsPerEm) * style.size;
  const width = x;

  return {
    width,
    capHeight,
    toPath(originX, baseline, anchor = 'start') {
      const offset = { start: 0, middle: width / 2, end: width }[anchor];
      const start = originX - offset;
      return glyphs
        .map(({ glyph, x: gx }) => glyph.getPath(start + gx, baseline, style.size).toPathData(2))
        .filter(Boolean)
        .join('');
    },
    glyphs() {
      return glyphs.map(({ glyph, x: gx, advance }) => ({
        x: gx + advance / 2,
        d: glyph.getPath(-advance / 2, 0, style.size).toPathData(2),
      }));
    },
  };
}

/**
 * Segment de droite à gauche (N'Ko) : formes contextuelles, glyphes de la dernière lettre à la
 * première, signes diacritiques centrés sur leur lettre. Lettres liées : sans espacement ajouté.
 * Renvoie la position après le segment.
 */
function placeRtl(
  text: string,
  start: number,
  size: number,
  pick: (char: string) => opentype.Font,
  out: { font: opentype.Font; glyph: opentype.Glyph; x: number; advance: number }[],
) {
  const chars = Array.from(text);
  const contextual = nkoForms(chars);
  // Grappes en ordre logique : une lettre suivie de ses signes.
  const clusters: { char: string; form: NkoForm }[][] = [];
  chars.forEach((char, i) => {
    const item = { char, form: contextual[i] ?? null };
    const last = clusters.at(-1);
    if (isNkoMark(char) && last) last.push(item);
    else clusters.push([item]);
  });

  clusters.reverse();
  let x = start;
  for (const [base, ...marks] of clusters) {
    const font = pick(base.char);
    const glyph = formGlyph(font, base.char, base.form);
    const scale = size / font.unitsPerEm;
    const advance = (glyph.advanceWidth ?? 0) * scale;
    out.push({ font, glyph, x, advance });
    for (const mark of marks) {
      const markFont = pick(mark.char);
      const markGlyph = markFont.charToGlyph(mark.char);
      const box = markGlyph.getBoundingBox();
      const center = ((box.x1 + box.x2) / 2) * (size / markFont.unitsPerEm);
      out.push({ font: markFont, glyph: markGlyph, x: x + advance / 2 - center, advance: 0 });
    }
    x += advance;
  }
  return x;
}
