import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';

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
}

export const FONTS_DIR = join(__dirname, '..', '..', 'assets', 'fonts');

/** Police de repli pour les caractères absents, et police des slogans sous le logo. */
export const FALLBACK_FONT = 'montserrat';

export const FONTS: LibraryFont[] = JSON.parse(
  readFileSync(join(FONTS_DIR, 'manifest.json'), 'utf8'),
) as LibraryFont[];

const byId = new Map(FONTS.map((f) => [f.id, f]));
const loaded = new Map<string, opentype.Font>();

export function getFont(id: string): LibraryFont {
  return byId.get(id) ?? byId.get(FALLBACK_FONT)!;
}

export function isLibraryFont(id: string) {
  return byId.has(id);
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

/** Fichiers à essayer pour chaque caractère : la police demandée, puis la police de repli. */
function fontChain(id: string, weight: number): opentype.Font[] {
  const font = getFont(id);
  const files = [...font.files[String(closestWeight(font.id, weight))]];
  if (font.id !== FALLBACK_FONT) {
    files.push(...getFont(FALLBACK_FONT).files[String(closestWeight(FALLBACK_FONT, weight))]);
  }
  return files.map(load);
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

/** Met en forme une ligne de texte (crénage, repli par caractère) et la convertit en tracés. */
export function shapeText(text: string, style: TextStyle): ShapedText {
  const chain = fontChain(style.fontId, style.weight);
  const primary = chain[0];
  const spacing = style.letterSpacing ?? 0;
  const glyphs: { font: opentype.Font; glyph: opentype.Glyph; x: number; advance: number }[] = [];

  let x = 0;
  let previous: { font: opentype.Font; glyph: opentype.Glyph } | null = null;
  for (const char of Array.from(text)) {
    const font = chain.find((f) => f.charToGlyphIndex(char) > 0) ?? primary;
    const glyph = font.charToGlyph(char);
    const scale = style.size / font.unitsPerEm;
    if (previous) {
      x += spacing;
      if (previous.font === font) x += font.getKerningValue(previous.glyph, glyph) * scale;
    }
    glyphs.push({ font, glyph, x, advance: (glyph.advanceWidth ?? 0) * scale });
    x += (glyph.advanceWidth ?? 0) * scale;
    previous = { font, glyph };
  }

  const os2 = (primary.tables as { os2?: { sCapHeight?: number } }).os2;
  const capHeight =
    ((os2?.sCapHeight || primary.unitsPerEm * 0.7) / primary.unitsPerEm) * style.size;
  const width = x;

  return {
    width,
    capHeight,
    toPath(originX, baseline, anchor = 'start') {
      const start =
        anchor === 'middle' ? originX - width / 2 : anchor === 'end' ? originX - width : originX;
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
