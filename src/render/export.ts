/**
 * Exports (LOGO-21 à LOGO-24) : SVG optimisé, PDF vectoriel, PNG transparent, JPG,
 * pack d'icônes d'application, filigrane de l'offre gratuite.
 */
import { Resvg } from '@resvg/resvg-js';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { optimize } from 'svgo';
import SVGtoPDF from 'svg-to-pdfkit';
import { textToPath } from './compose';
import { embedSvg } from './variants';
import type { RenderedLogo } from './compose';

/**
 * SVGO en gardant viewBox et masques (§5.5). `convertPathData` est désactivé : il plante sur
 * certains tracés d'icônes (svgo 3) et nos tracés sont déjà compacts (2 décimales).
 */
export function optimizeSvg(svg: string): string {
  try {
    return optimize(svg, {
      multipass: true,
      plugins: [
        {
          name: 'preset-default',
          params: { overrides: { removeViewBox: false, convertPathData: false } },
        } as never,
        'removeDimensions',
      ],
    }).data;
  } catch {
    // Un export ne doit jamais échouer pour une optimisation : le SVG d'origine est valide.
    return svg;
  }
}

export function toPng(svg: string, width: number, background?: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: Math.round(width) },
    background,
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

export async function toJpg(svg: string, width: number): Promise<Buffer> {
  return sharp(toPng(svg, width))
    .flatten({ background: '#FFFFFF' })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** PDF vectoriel à la taille du logo (1 unité = 1 pt). */
export function toPdf(logo: RenderedLogo): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [logo.width, logo.height],
      margin: 0,
      info: { Title: 'Logo' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    SVGtoPDF(doc, logo.svg, 0, 0, { width: logo.width, height: logo.height, assumePt: true });
    doc.end();
  });
}

/** Fichier ICO contenant des images PNG (format accepté par tous les navigateurs récents). */
export function toIco(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * pngs.length;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 0);
    e.writeUInt8(p.size >= 256 ? 0 : p.size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += p.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

/**
 * Icône d'application carrée : symbole centré sur fond plein (iOS refuse la transparence).
 * `padding` en fraction du côté.
 */
export function appIconSvg(icon: RenderedLogo, background: string, padding = 0.18): string {
  const side = 1024;
  const inner = side * (1 - padding * 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">` +
    `<rect width="${side}" height="${side}" fill="${background}"/>` +
    embedSvg(icon, side * padding, side * padding, inner, inner) +
    `</svg>`
  );
}

/** Tailles du pack d'icônes (LOGO-22). */
export const APP_ICON_SIZES = {
  'favicon-16.png': 16,
  'favicon-32.png': 32,
  'favicon-48.png': 48,
  'apple-touch-icon-180.png': 180,
  'android-chrome-192.png': 192,
  'android-chrome-512.png': 512,
  'ios-1024.png': 1024,
} as const;

export function appIconPack(icon: RenderedLogo, background: string): Record<string, Buffer> {
  const svg = appIconSvg(icon, background);
  const files: Record<string, Buffer> = {};
  for (const [name, size] of Object.entries(APP_ICON_SIZES)) files[name] = toPng(svg, size);
  files['favicon.ico'] = toIco(
    [16, 32, 48].map((size) => ({ size, data: files[`favicon-${size}.png`] })),
  );
  return files;
}

/**
 * Filigrane de l'offre gratuite (LOGO-24) : mention répétée en diagonale, en tracés.
 * Appliqué au moment de l'export, selon l'offre à ce moment-là (§7.4).
 */
export function watermark(logo: RenderedLogo, label = 'APERÇU'): string {
  const text = textToPath(label, 'montserrat', 700, 100, 0.1);
  const step = Math.max(logo.width, logo.height) / 3;
  const k = (step * 0.7) / text.box.w;
  const marks: string[] = [];
  for (let y = -logo.height; y < logo.height * 2; y += step * 0.6) {
    for (let x = -logo.width; x < logo.width * 2; x += step) {
      marks.push(
        `<path transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(-30) scale(${k.toFixed(4)})" d="${text.d}"/>`,
      );
    }
  }
  const overlay = `<g fill="#6B7280" fill-opacity="0.35">${marks.join('')}</g>`;
  return logo.svg.replace(/<\/svg>$/, `${overlay}</svg>`);
}

// ─── Empreinte perceptuelle (pHash, §5.5) ───

/** pHash 64 bits (DCT 32 × 32, 8 × 8 basses fréquences), en hexadécimal. */
export function perceptualHash(svg: string): string {
  const N = 32;
  const img = new Resvg(svg, {
    fitTo: { mode: 'width', value: N },
    background: '#FFFFFF',
    // Texte déjà en tracés : charger les polices système coûterait ~2 s par appel.
    font: { loadSystemFonts: false },
  }).render();
  const { pixels, width, height } = img;
  // Échantillonnage sur une grille N × N (l'image peut ne pas être carrée).
  const gray: number[] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = Math.min(width - 1, Math.floor((x * width) / N));
      const sy = Math.min(height - 1, Math.floor((y * height) / N));
      const i = (sy * width + sx) * 4;
      gray.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }
  }
  const dct: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          sum +=
            gray[y * N + x] *
            Math.cos(((2 * x + 1) * v * Math.PI) / (2 * N)) *
            Math.cos(((2 * y + 1) * u * Math.PI) / (2 * N));
        }
      }
      dct.push(sum);
    }
  }
  const ac = dct.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let bits = '';
  for (const v of dct) bits += v > median ? '1' : '0';
  return BigInt('0b' + bits)
    .toString(16)
    .padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** Seuil au-delà duquel deux logos sont jugés trop proches d'un logo exclusif. */
export const EXCLUSIVITY_MAX_DISTANCE = 6;
