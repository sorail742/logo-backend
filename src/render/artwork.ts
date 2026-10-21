import { luminance, mix, normalizeHex } from './color';

// Visuels génératifs du Studio (fournisseur d'images de démonstration) : fonds et motifs
// vectoriels déterministes, aux couleurs données. Même code que le front
// (src/lib/render/artwork.ts) : le mode simulé produit les mêmes images que l'API.

export const ARTWORK_STYLES = [
  'abstract',
  'gradient',
  'geometric',
  'waves',
  'wax',
  'bogolan',
  'confetti',
] as const;
export type ArtworkStyle = (typeof ARTWORK_STYLES)[number];

export interface ArtworkInput {
  style: ArtworkStyle;
  /** Au moins deux couleurs (#rrggbb). */
  palette: string[];
  width: number;
  height: number;
  seed: number;
}

const n = (v: number) => Math.round(v * 10) / 10;

/** Graine stable d'un texte (FNV-1a). */
export function hashSeed(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function random(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T>(rand: Rand, list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const between = (rand: Rand, min: number, max: number) => min + rand() * (max - min);

/** Forme organique fermée et lissée autour d'un centre. */
function blob(rand: Rand, cx: number, cy: number, r: number, points = 7) {
  const pts = Array.from({ length: points }, (_, i) => {
    const a = (i / points) * Math.PI * 2;
    const rr = r * between(rand, 0.7, 1.15);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  });
  let d = `M${n(pts[0]![0])} ${n(pts[0]![1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points]!;
    const p1 = pts[i]!;
    const p2 = pts[(i + 1) % points]!;
    const p3 = pts[(i + 2) % points]!;
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

function softShapes(input: ArtworkInput, rand: Rand, blurRatio: number, grain: boolean) {
  const { width: w, height: h, palette } = input;
  const m = Math.min(w, h);
  const [c0, c1] = [palette[0]!, palette[1]!];
  const shapes = Array.from({ length: 7 }, (_, i) => {
    const color = palette[(i + 1) % palette.length]!;
    return `<path d="${blob(rand, between(rand, -0.1, 1.1) * w, between(rand, -0.1, 1.1) * h, m * between(rand, 0.25, 0.55))}" fill="${color}" fill-opacity="${n(between(rand, 0.6, 0.95))}"/>`;
  }).join('');
  const grainLayer = grain
    ? `<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${input.seed % 1000}"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.12 0"/></filter><rect width="${w}" height="${h}" filter="url(#g)"/>`
    : '';
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${mix(c0, c1, 0.5)}"/></linearGradient><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${n(m * blurRatio)}"/></filter></defs><rect width="${w}" height="${h}" fill="url(#bg)"/><g filter="url(#b)">${shapes}</g>${grainLayer}`;
}

function geometric(input: ArtworkInput, rand: Rand) {
  const { width: w, height: h, palette } = input;
  const cols = 4;
  const size = w / cols;
  const rows = Math.ceil(h / size);
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * size;
      const y = r * size;
      const bg = pick(rand, palette);
      let fg = pick(rand, palette);
      if (fg === bg) fg = palette[(palette.indexOf(bg) + 1) % palette.length]!;
      out.push(
        `<rect x="${n(x)}" y="${n(y)}" width="${n(size + 1)}" height="${n(size + 1)}" fill="${bg}"/>`,
      );
      const s = size;
      switch (Math.floor(rand() * 6)) {
        case 0:
          out.push(
            `<circle cx="${n(x + s / 2)}" cy="${n(y + s / 2)}" r="${n(s * 0.36)}" fill="${fg}"/>`,
          );
          break;
        case 1: {
          const corner = Math.floor(rand() * 4);
          const cx = corner % 2 ? x + s : x;
          const cy = corner > 1 ? y + s : y;
          out.push(
            `<clipPath id="q${r}-${c}"><rect x="${n(x)}" y="${n(y)}" width="${n(s)}" height="${n(s)}"/></clipPath><circle cx="${n(cx)}" cy="${n(cy)}" r="${n(s)}" fill="${fg}" clip-path="url(#q${r}-${c})"/>`,
          );
          break;
        }
        case 2:
          out.push(
            `<path d="M${n(x)} ${n(y + s)}A${n(s / 2)} ${n(s / 2)} 0 0 1 ${n(x + s)} ${n(y + s)}Z" fill="${fg}"/>`,
          );
          break;
        case 3:
          out.push(
            `<polygon points="${n(x)},${n(y + s)} ${n(x + s / 2)},${n(y)} ${n(x + s)},${n(y + s)}" fill="${fg}"/>`,
          );
          break;
        case 4:
          for (let k = 0; k < 3; k++) {
            out.push(
              `<rect x="${n(x)}" y="${n(y + (k * 2 + 0.5) * (s / 6))}" width="${n(s)}" height="${n(s / 6)}" fill="${fg}"/>`,
            );
          }
          break;
        default:
          out.push(
            `<rect x="${n(x + s * 0.2)}" y="${n(y + s * 0.2)}" width="${n(s * 0.6)}" height="${n(s * 0.6)}" fill="${fg}" transform="rotate(45 ${n(x + s / 2)} ${n(y + s / 2)})"/>`,
          );
      }
    }
  }
  return out.join('');
}

function waves(input: ArtworkInput, rand: Rand) {
  const { width: w, height: h, palette } = input;
  const bands = 7;
  const out = [`<rect width="${w}" height="${h}" fill="${palette[0]}"/>`];
  for (let i = 1; i <= bands; i++) {
    const base = (i / (bands + 1)) * h;
    const amp = h * between(rand, 0.02, 0.06);
    const freq = between(rand, 1, 2.5);
    const phase = rand() * Math.PI * 2;
    let d = `M0 ${n(base)}`;
    // Points répartis par indice : le dernier tombe exactement sur le bord droit.
    for (let step = 0; step <= 40; step++) {
      const x = (step / 40) * w;
      d += `L${n(x)} ${n(base + Math.sin((x / w) * Math.PI * 2 * freq + phase) * amp)}`;
    }
    d += `L${w} ${h}L0 ${h}Z`;
    const from = palette[i % palette.length]!;
    const to = palette[(i + 1) % palette.length]!;
    out.push(`<path d="${d}" fill="${mix(from, to, i / bands)}"/>`);
  }
  return out.join('');
}

function wax(input: ArtworkInput, rand: Rand) {
  const { width: w, height: h, palette } = input;
  const s = Math.min(w, h) / between(rand, 3.2, 5.2);
  const out = [`<rect width="${w}" height="${h}" fill="${palette[0]}"/>`];
  const rest = palette.slice(1).length ? palette.slice(1) : palette;
  // Chaque proposition décale l'ordre des couleurs et l'alternance des motifs.
  const shift = Math.floor(rand() * rest.length);
  const colors = [...rest.slice(shift), ...rest.slice(0, shift)];
  const parity = rand() < 0.5 ? 0 : 1;
  const tilt = between(rand, -20, 20);
  let row = 0;
  for (let y = -s; y < h + s; y += s * 0.9) {
    const offset = row % 2 ? s / 2 : 0;
    for (let x = -s + offset; x < w + s; x += s) {
      const c1 = colors[(row + Math.floor(x / s)) % colors.length]!;
      const c2 = colors[(row + Math.floor(x / s) + 1) % colors.length]!;
      if ((row + Math.round(x / s) + parity) % 2 === 0) {
        // Cercles concentriques
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s * 0.42)}" fill="${c1}"/>`);
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s * 0.28)}" fill="${palette[0]}"/>`);
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s * 0.15)}" fill="${c2}"/>`);
      } else {
        // Feuille en goutte
        out.push(
          `<path d="M${n(x)} ${n(y - s * 0.42)}C${n(x + s * 0.34)} ${n(y - s * 0.1)} ${n(x + s * 0.3)} ${n(y + s * 0.3)} ${n(x)} ${n(y + s * 0.42)}C${n(x - s * 0.3)} ${n(y + s * 0.3)} ${n(x - s * 0.34)} ${n(y - s * 0.1)} ${n(x)} ${n(y - s * 0.42)}Z" fill="${c1}" transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"/>`,
        );
        out.push(
          `<path d="M${n(x)} ${n(y - s * 0.3)}V${n(y + s * 0.3)}" stroke="${palette[0]}" stroke-width="${n(s * 0.04)}" transform="rotate(${n(tilt)} ${n(x)} ${n(y)})"/>`,
        );
      }
      out.push(
        `<circle cx="${n(x + s / 2)}" cy="${n(y + s * 0.45)}" r="${n(s * 0.05)}" fill="${c2}"/>`,
      );
    }
    row++;
  }
  return out.join('');
}

function bogolan(input: ArtworkInput, rand: Rand) {
  const { width: w, height: h, palette } = input;
  // Terre sombre et ivoire, teintées par la couleur principale.
  const ground = mix(palette[0]!, '#2b1a0e', 0.65);
  const ink =
    luminance(palette[palette.length - 1]!) > 0.7
      ? mix(palette[palette.length - 1]!, '#f3e9d2', 0.6)
      : '#f3e9d2';
  const cols = 3 + Math.floor(rand() * 3);
  const size = w / cols;
  const rows = Math.ceil(h / size);
  const sw = size * 0.035;
  const out = [`<rect width="${w}" height="${h}" fill="${ground}"/>`];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * size;
      const y = r * size;
      const p = size * 0.18;
      out.push(
        `<rect x="${n(x + sw)}" y="${n(y + sw)}" width="${n(size - sw * 2)}" height="${n(size - sw * 2)}" fill="none" stroke="${ink}" stroke-width="${n(sw)}"/>`,
      );
      switch (Math.floor(rand() * 5)) {
        case 0:
          for (let i = 0; i < 4; i++)
            for (let j = 0; j < 4; j++)
              out.push(
                `<circle cx="${n(x + p + (i + 0.5) * ((size - 2 * p) / 4))}" cy="${n(y + p + (j + 0.5) * ((size - 2 * p) / 4))}" r="${n(size * 0.035)}" fill="${ink}"/>`,
              );
          break;
        case 1: {
          let d = '';
          for (let k = 0; k < 3; k++) {
            const yy = y + p + k * ((size - 2 * p) / 2);
            d += `M${n(x + p)} ${n(yy)}`;
            for (let i = 1; i <= 6; i++)
              d += `L${n(x + p + i * ((size - 2 * p) / 6))} ${n(yy + (i % 2 ? size * 0.08 : 0))}`;
          }
          out.push(
            `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n(sw * 1.4)}" stroke-linejoin="round"/>`,
          );
          break;
        }
        case 2:
          out.push(
            `<path d="M${n(x + size / 2)} ${n(y + p)}V${n(y + size - p)}M${n(x + p)} ${n(y + size / 2)}H${n(x + size - p)}" stroke="${ink}" stroke-width="${n(sw * 2.2)}" stroke-linecap="round"/>`,
          );
          break;
        case 3:
          for (let k = 0; k < 3; k++) {
            const inset = p + k * size * 0.1;
            out.push(
              `<rect x="${n(x + inset)}" y="${n(y + inset)}" width="${n(size - inset * 2)}" height="${n(size - inset * 2)}" fill="none" stroke="${ink}" stroke-width="${n(sw * 1.2)}"/>`,
            );
          }
          break;
        default:
          for (let k = 0; k < 4; k++)
            out.push(
              `<rect x="${n(x + p)}" y="${n(y + p + k * ((size - 2 * p) / 4))}" width="${n(size - 2 * p)}" height="${n(size * 0.05)}" fill="${ink}"/>`,
            );
      }
    }
  }
  return out.join('');
}

function confetti(input: ArtworkInput, rand: Rand) {
  const { width: w, height: h, palette } = input;
  const m = Math.min(w, h);
  const out = [`<rect width="${w}" height="${h}" fill="${mix(palette[0]!, '#ffffff', 0.9)}"/>`];
  for (let i = 0; i < 70; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const s = m * between(rand, 0.015, 0.045);
    const color = palette[i % palette.length]!;
    const rot = n(rand() * 360);
    switch (i % 4) {
      case 0:
        out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(s / 2)}" fill="${color}"/>`);
        break;
      case 1:
        out.push(
          `<rect x="${n(x)}" y="${n(y)}" width="${n(s * 1.8)}" height="${n(s * 0.6)}" rx="${n(s * 0.2)}" fill="${color}" transform="rotate(${rot} ${n(x)} ${n(y)})"/>`,
        );
        break;
      case 2:
        out.push(
          `<polygon points="${n(x)},${n(y - s / 2)} ${n(x + s / 2)},${n(y + s / 2)} ${n(x - s / 2)},${n(y + s / 2)}" fill="${color}" transform="rotate(${rot} ${n(x)} ${n(y)})"/>`,
        );
        break;
      default:
        out.push(
          `<path d="M${n(x)} ${n(y)}q${n(s / 2)} ${n(-s / 2)} ${n(s)} 0t${n(s)} 0" fill="none" stroke="${color}" stroke-width="${n(s * 0.25)}" stroke-linecap="round" transform="rotate(${rot} ${n(x)} ${n(y)})"/>`,
        );
    }
  }
  return out.join('');
}

export function renderArtwork(input: ArtworkInput): string {
  const palette = input.palette.map(normalizeHex);
  if (palette.length < 2) palette.push(mix(palette[0] ?? '#0f6b5c', '#ffffff', 0.6));
  const art = { ...input, palette };
  const rand = random(input.seed);
  const { width: w, height: h } = input;
  let body: string;
  switch (input.style) {
    case 'abstract':
      body = softShapes(art, rand, 0.018, false);
      break;
    case 'gradient':
      body = softShapes(art, rand, 0.14, true);
      break;
    case 'geometric':
      body = geometric(art, rand);
      break;
    case 'waves':
      body = waves(art, rand);
      break;
    case 'wax':
      body = wax(art, rand);
      break;
    case 'bogolan':
      body = bogolan(art, rand);
      break;
    case 'confetti':
      body = confetti(art, rand);
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><clipPath id="frame"><rect width="${w}" height="${h}"/></clipPath><g clip-path="url(#frame)">${body}</g></svg>`;
}

/** Style suggéré par des mots du texte (le fournisseur de démonstration ne l'interprète pas). */
export function styleFromPrompt(prompt: string): ArtworkStyle | null {
  // Mots entiers (« campagne » ne doit pas évoquer un pagne) ; les radicaux finissant par « ~ » acceptent une suite.
  const words = (list: string) =>
    new RegExp(`(?<!\\p{L})(?:${list.replaceAll('~', '\\p{L}*')})(?!\\p{L})`, 'u').test(
      prompt.toLowerCase(),
    );
  if (words('wax|pagnes?|tissus?|fabrics?')) return 'wax';
  if (words('bogolan|terre|mudcloth|artisan~')) return 'bogolan';
  if (words('vagues?|mers?|océan~|ocean~|eaux?|waves?')) return 'waves';
  if (words('fêtes?|fetes?|festival~|anniversaire~|célébr~|celebr~|part(?:y|ies)|confettis?'))
    return 'confetti';
  if (words('géométr~|geometr~|bauhaus|formes?')) return 'geometric';
  return null;
}
