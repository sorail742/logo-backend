/**
 * Bibliothèque graphique interne (§5.5) : uniquement des éléments sous licence libre, chacun
 * avec sa licence. Polices Google Fonts via Fontsource (OFL), icônes Tabler (MIT).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as opentype from 'opentype.js';

export type FontCategory = 'sans' | 'serif' | 'display' | 'script';

export interface FontInfo {
  id: string;
  family: string;
  category: FontCategory;
  weights: number[];
  license: 'OFL';
  /** Styles de logo pour lesquels l'IA factice privilégie cette police. */
  styles: string[];
}

export const FONTS: FontInfo[] = [
  {
    id: 'montserrat',
    family: 'Montserrat',
    category: 'sans',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['MODERN', 'MINIMALIST', 'INSTITUTIONAL'],
  },
  {
    id: 'poppins',
    family: 'Poppins',
    category: 'sans',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['MODERN', 'PLAYFUL', 'MINIMALIST'],
  },
  {
    id: 'inter',
    family: 'Inter',
    category: 'sans',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['MINIMALIST', 'MODERN', 'INSTITUTIONAL'],
  },
  {
    id: 'raleway',
    family: 'Raleway',
    category: 'sans',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['MINIMALIST', 'MODERN'],
  },
  {
    id: 'nunito',
    family: 'Nunito',
    category: 'sans',
    weights: [400, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['PLAYFUL'],
  },
  {
    id: 'josefin-sans',
    family: 'Josefin Sans',
    category: 'sans',
    weights: [400, 600, 700],
    license: 'OFL',
    styles: ['MINIMALIST', 'AFRICAN'],
  },
  {
    id: 'oswald',
    family: 'Oswald',
    category: 'display',
    weights: [400, 500, 600, 700],
    license: 'OFL',
    styles: ['MODERN', 'INSTITUTIONAL'],
  },
  {
    id: 'bebas-neue',
    family: 'Bebas Neue',
    category: 'display',
    weights: [400],
    license: 'OFL',
    styles: ['MODERN', 'AFRICAN'],
  },
  {
    id: 'archivo-black',
    family: 'Archivo Black',
    category: 'display',
    weights: [400],
    license: 'OFL',
    styles: ['PLAYFUL', 'AFRICAN'],
  },
  {
    id: 'playfair-display',
    family: 'Playfair Display',
    category: 'serif',
    weights: [400, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['CLASSIC'],
  },
  {
    id: 'lora',
    family: 'Lora',
    category: 'serif',
    weights: [400, 500, 600, 700],
    license: 'OFL',
    styles: ['CLASSIC', 'INSTITUTIONAL'],
  },
  {
    id: 'merriweather',
    family: 'Merriweather',
    category: 'serif',
    weights: [400, 700, 900],
    license: 'OFL',
    styles: ['CLASSIC', 'INSTITUTIONAL'],
  },
  {
    id: 'roboto-slab',
    family: 'Roboto Slab',
    category: 'serif',
    weights: [400, 500, 600, 700, 800, 900],
    license: 'OFL',
    styles: ['INSTITUTIONAL', 'CLASSIC'],
  },
  {
    id: 'pacifico',
    family: 'Pacifico',
    category: 'script',
    weights: [400],
    license: 'OFL',
    styles: ['PLAYFUL'],
  },
  {
    id: 'dancing-script',
    family: 'Dancing Script',
    category: 'script',
    weights: [400, 500, 600, 700],
    license: 'OFL',
    styles: ['PLAYFUL', 'CLASSIC'],
  },
  {
    id: 'great-vibes',
    family: 'Great Vibes',
    category: 'script',
    weights: [400],
    license: 'OFL',
    styles: ['CLASSIC'],
  },
];

export const ICON_LICENSE = {
  name: 'Tabler Icons',
  license: 'MIT',
  url: 'https://tabler.io/icons',
};

/** Répertoire d'un paquet installé (certains paquets bloquent require.resolve via `exports`). */
export function packageDir(name: string): string {
  let dir = __dirname;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`Paquet ${name} introuvable`);
    dir = parent;
  }
}

// ─── Polices ───

const fontCache = new Map<string, opentype.Font>();

export function fontInfo(id: string): FontInfo | undefined {
  return FONTS.find((f) => f.id === id);
}

/** Graisse disponible la plus proche de celle demandée. */
export function nearestWeight(info: FontInfo, weight: number): number {
  return info.weights.reduce((best, w) =>
    Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
  );
}

export function loadFont(id: string, weight = 400): opentype.Font {
  const info = fontInfo(id);
  if (!info) throw new Error(`Police inconnue : ${id}`);
  const w = nearestWeight(info, weight);
  const key = `${id}:${w}`;
  let font = fontCache.get(key);
  if (!font) {
    const file = join(packageDir(`@fontsource/${id}`), 'files', `${id}-latin-${w}-normal.woff`);
    const buf = readFileSync(file);
    font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    fontCache.set(key, font);
  }
  return font;
}

// ─── Icônes ───

export interface IconInfo {
  id: string;
  category: string;
  tags: string[];
}

type IconNode = [string, Record<string, string>];

let iconIndex: { meta: Map<string, IconInfo>; nodes: Record<string, IconNode[]> } | null = null;

function icons() {
  if (!iconIndex) {
    const dir = packageDir('@tabler/icons');
    const meta = JSON.parse(readFileSync(join(dir, 'icons.json'), 'utf8')) as Record<
      string,
      {
        name: string;
        category?: string;
        tags?: (string | number)[];
        styles?: { outline?: unknown };
      }
    >;
    const nodes = JSON.parse(
      readFileSync(join(dir, 'tabler-nodes-outline.json'), 'utf8'),
    ) as Record<string, IconNode[]>;
    const map = new Map<string, IconInfo>();
    for (const m of Object.values(meta)) {
      if (!nodes[m.name]) continue;
      map.set(m.name, { id: m.name, category: m.category ?? '', tags: (m.tags ?? []).map(String) });
    }
    iconIndex = { meta: map, nodes };
  }
  return iconIndex;
}

export function iconExists(id: string): boolean {
  return icons().meta.has(id);
}

/** Recherche par nom, étiquette ou catégorie (LOGO-11). */
export function searchIcons(q: string, limit = 60): IconInfo[] {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const all = [...icons().meta.values()];
  if (!terms.length) return all.slice(0, limit);
  const scored = all
    .map((icon) => {
      let score = 0;
      for (const t of terms) {
        if (icon.id === t) score += 10;
        else if (icon.id.split('-').includes(t)) score += 5;
        else if (icon.tags.some((tag) => tag.toLowerCase() === t)) score += 4;
        else if (icon.id.includes(t) || icon.tags.some((tag) => tag.toLowerCase().includes(t)))
          score += 1;
        else if (icon.category.toLowerCase() === t) score += 2;
      }
      return { icon, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.icon.id.length - b.icon.id.length);
  return scored.slice(0, limit).map((s) => s.icon);
}

/** Contenu SVG de l'icône (repère 24 × 24, tracé de 2), sans balise <svg>. */
export function iconMarkup(id: string): string {
  const nodes = icons().nodes[id];
  if (!nodes) throw new Error(`Icône inconnue : ${id}`);
  return nodes
    .map(([tag, attrs]) => {
      const a = Object.entries(attrs)
        .filter(([k]) => k !== 'key')
        .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
        .join(' ');
      return `<${tag} ${a}/>`;
    })
    .join('');
}

export function escapeAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
