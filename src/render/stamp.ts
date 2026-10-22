import { z } from 'zod';
import { FALLBACK_FONT, isLibraryFont, shapeText } from './fonts';
import { escapeXml } from './svg';

// Signature visuelle (§6.3) : cachet rond, ovale ou rectangulaire et paraphe. Même dessin que
// l'aperçu du front (src/lib/render/stamp.ts), mais le texte est converti en tracés, y compris
// le texte circulaire : le fichier sert à fabriquer un tampon physique (SIG-24).

export const INK_COLORS = {
  blue: '#1d3f9e',
  violet: '#5b2a86',
  red: '#b3141f',
  black: '#1a1a1a',
} as const;

const ink = z.enum(['blue', 'violet', 'red', 'black']);

export const stampDataSchema = z.object({
  shape: z.enum(['round', 'oval', 'rectangle']),
  ringText: z.string().trim().min(1).max(60),
  bottomText: z.string().trim().max(40).default(''),
  centerText: z.string().trim().max(80).default(''),
  centerMode: z.enum(['acronym', 'title', 'logo']),
  ink,
  inkEffect: z.boolean().default(false),
});
export type StampData = z.infer<typeof stampDataSchema>;

export const handwrittenDataSchema = z.object({
  text: z.string().trim().max(40).default(''),
  fontId: z.string().refine(isLibraryFont, 'Police absente de la bibliothèque'),
  ink,
  /** Tracé dessiné à la main, déjà lissé par le front (SIG-21). */
  strokes: z
    .string()
    .max(50_000)
    .regex(/^[MLQCZ0-9.,\s-]*$/i, 'Tracé invalide')
    .optional(),
});
export type HandwrittenData = z.infer<typeof handwrittenDataSchema>;

/** Termes officiels qui imposent une validation manuelle du cachet (§6.4). */
export const OFFICIAL_TERMS = [
  'republique',
  'ministere',
  'prefecture',
  'police',
  'gendarmerie',
  'tribunal',
  'presidence',
  'gouvernement',
  'armee',
  'douane',
  'ambassade',
  'cour supreme',
  'assemblee nationale',
  'republic',
  'ministry',
  'court',
];

function normalize(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function findOfficialTerms(...texts: string[]) {
  const haystack = normalize(texts.join(' '));
  return OFFICIAL_TERMS.filter((term) => new RegExp(String.raw`\b${term}\b`).test(haystack));
}

function inkFilter(id: string) {
  return `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise"/><feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 1.6" result="mask"/><feComposite in="SourceGraphic" in2="mask" operator="in" result="speckled"/><feDisplacementMap in="speckled" in2="noise" scale="1.6"/></filter>`;
}

const STAMP_FONT = FALLBACK_FONT;

/**
 * Texte posé le long d'une demi-ellipse, centré : en haut, de gauche à droite, lettres vers
 * l'extérieur ; en bas, de gauche à droite et à l'endroit, lettres vers le centre.
 */
function textOnArc(
  text: string,
  options: {
    cx: number;
    cy: number;
    rx: number;
    ry: number;
    top: boolean;
    size: number;
    weight: number;
    spacing: number;
  },
) {
  const { cx, cy, rx, ry, top } = options;
  // θ de π à 2π par le haut (y vers le haut négatif), de π à 0 par le bas.
  const at = (t: number) => {
    const theta = top ? Math.PI + t * Math.PI : Math.PI - t * Math.PI;
    return { x: cx + rx * Math.cos(theta), y: cy + ry * Math.sin(theta) };
  };
  const steps = 720;
  const points = Array.from({ length: steps + 1 }, (_, i) => at(i / steps));
  const lengths = [0];
  for (let i = 1; i <= steps; i++) {
    lengths.push(
      lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y),
    );
  }
  const total = lengths[steps];
  // Un texte long est réduit pour tenir sur 85 % de l'arc, sans descendre sous 11 px.
  let shaped = shapeText(text, {
    fontId: STAMP_FONT,
    weight: options.weight,
    size: options.size,
    letterSpacing: options.spacing,
  });
  if (shaped.width > total * 0.85) {
    const ratio = Math.max((total * 0.85) / shaped.width, 11 / options.size);
    shaped = shapeText(text, {
      fontId: STAMP_FONT,
      weight: options.weight,
      size: options.size * ratio,
      letterSpacing: options.spacing * ratio,
    });
  }
  const start = (total - shaped.width) / 2;

  return shaped
    .glyphs()
    .map(({ x, d }) => {
      if (!d) return '';
      const s = Math.min(Math.max(start + x, 0), total);
      let i = 1;
      while (i < steps && lengths[i] < s) i++;
      const a = points[i - 1];
      const b = points[i];
      const f = (s - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-6);
      const px = a.x + (b.x - a.x) * f;
      const py = a.y + (b.y - a.y) * f;
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return `<path transform="translate(${px.toFixed(2)} ${py.toFixed(2)}) rotate(${angle.toFixed(2)})" d="${d}"/>`;
    })
    .join('');
}

function star(cx: number, cy: number, r: number) {
  const points = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `<polygon points="${points.join(' ')}"/>`;
}

export interface StampRenderOptions {
  /** Symbole du logo du projet (SVG complet, une seule couleur), pour le mode « logo ». */
  logoSvg?: string | null;
}

export function renderStampSvg(data: StampData, options: StampRenderOptions = {}) {
  const color = INK_COLORS[data.ink];
  const defs = data.inkEffect ? inkFilter('ink') : '';
  const filter = data.inkEffect ? ' filter="url(#ink)"' : '';
  const body: string[] = [];
  let width = 320;
  let height = 320;

  const line = (
    text: string,
    x: number,
    baseline: number,
    size: number,
    weight: number,
    spacing = 0,
  ) =>
    `<path d="${shapeText(text, { fontId: STAMP_FONT, weight, size, letterSpacing: spacing }).toPath(x, baseline, 'middle')}"/>`;

  const center = (cx: number, cy: number, size: number) => {
    if (data.centerMode === 'logo' && options.logoSvg) {
      const inner = options.logoSvg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
        const kept = attrs.replace(/\s(x|y|width|height)="[^"]*"/g, '');
        return `<svg${kept} x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}">`;
      });
      return inner;
    }
    const text = data.centerText || '';
    const lines = text.split(/\n/).slice(0, 3);
    const fontSize =
      data.centerMode === 'acronym' ? Math.min(54, (size * 1.4) / Math.max(text.length, 2)) : 18;
    const cap = shapeText('H', { fontId: STAMP_FONT, weight: 800, size: fontSize }).capHeight;
    return lines
      .map((l, i) =>
        line(l, cx, cy + (i - (lines.length - 1) / 2) * (fontSize * 1.15) + cap / 2, fontSize, 800),
      )
      .join('');
  };

  if (data.shape === 'rectangle') {
    width = 420;
    height = 220;
    body.push(
      `<rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="10" fill="none" stroke="${color}" stroke-width="6"/>`,
      `<rect x="22" y="22" width="${width - 44}" height="${height - 44}" rx="4" fill="none" stroke="${color}" stroke-width="2"/>`,
      line(data.ringText.toUpperCase(), width / 2, 58, 22, 800, 2),
      center(width / 2, height / 2 + 6, 80),
    );
    if (data.bottomText)
      body.push(line(data.bottomText.toUpperCase(), width / 2, height - 40, 16, 700, 2));
  } else {
    const isOval = data.shape === 'oval';
    width = isOval ? 400 : 320;
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2 - 10;
    const ry = height / 2 - 10;
    body.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="6"/>`,
    );
    body.push(
      `<ellipse cx="${cx}" cy="${cy}" rx="${rx - 62}" ry="${ry - 62}" fill="none" stroke="${color}" stroke-width="2.5"/>`,
    );
    body.push(
      textOnArc(data.ringText.toUpperCase(), {
        cx,
        cy,
        rx: rx - 34,
        ry: ry - 34,
        top: true,
        size: 22,
        weight: 800,
        spacing: 3,
      }),
    );
    if (data.bottomText) {
      body.push(
        textOnArc(data.bottomText.toUpperCase(), {
          cx,
          cy,
          rx: rx - 20,
          ry: ry - 20,
          top: false,
          size: 18,
          weight: 700,
          spacing: 3,
        }),
      );
    }
    body.push(star(cx - rx + 22, cy, 7), star(cx + rx - 22, cy, 7));
    body.push(center(cx, cy, Math.min(rx, ry) - 80));
  }

  const label = escapeXml(data.ringText);
  const defsMarkup = defs ? `<defs>${defs}</defs>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${label}"><title>${label}</title>${defsMarkup}<g fill="${color}"${filter} opacity="0.92">${body.join('')}</g></svg>`;
}

/** Paraphe : texte en police manuscrite avec un trait de soulignement, ou tracé dessiné. */
export function renderHandwrittenSvg(data: HandwrittenData) {
  const color = INK_COLORS[data.ink];
  if (data.strokes) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" width="600" height="240" role="img" aria-label="Paraphe"><title>Paraphe</title><path d="${escapeXml(data.strokes)}" fill="none" stroke="${color}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  const size = Math.min(96, 900 / Math.max(data.text.length, 4));
  const shaped = shapeText(data.text, { fontId: data.fontId, weight: 400, size });
  const label = escapeXml(data.text);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" width="600" height="240" role="img" aria-label="${label}"><title>${label}</title><path d="${shaped.toPath(300, 130 + shaped.capHeight / 2, 'middle')}" fill="${color}"/><path d="M ${300 - size * 2.2} 178 C ${300 - size} 196, ${300 + size} 160, ${300 + size * 2.4} 182" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/></svg>`;
}
