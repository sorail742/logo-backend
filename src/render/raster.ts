import { Resvg } from '@resvg/resvg-js';
import jpeg from 'jpeg-js';
import { hexToRgb } from './color';
import { frameSvg, svgSize } from './svg';

// Rendu matriciel (resvg) : PNG transparents, JPG, favicon.ico, empreinte perceptuelle.
// Le texte est déjà en tracés : aucune police système n'est chargée.

export interface RasterOptions {
  /** Côté le plus long, en px (ou côté du carré). */
  size: number;
  square?: boolean;
  /** Marge intérieure, en proportion du côté (0 à 0,4). */
  padding?: number;
  /** null ou absent : transparent. */
  background?: string | null;
}

function render(svg: string, width: number) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: false },
    shapeRendering: 2,
    imageRendering: 0,
  }).render();
}

function prepare(svg: string, options: RasterOptions) {
  const { width, height } = svgSize(svg);
  if (options.square || options.padding || options.background) {
    const side = options.square ? options.size : null;
    const w =
      side ?? (width >= height ? options.size : Math.round((options.size * width) / height));
    const h =
      side ?? (width >= height ? Math.round((options.size * height) / width) : options.size);
    return {
      svg: frameSvg(svg, {
        width: w,
        height: h,
        padding: options.padding,
        background: options.background,
      }),
      width: w,
    };
  }
  return {
    svg,
    width: width >= height ? options.size : Math.round((options.size * width) / height),
  };
}

export function svgToPng(svg: string, options: RasterOptions): Buffer {
  const prepared = prepare(svg, options);
  return render(prepared.svg, prepared.width).asPng();
}

/** Pixels RGBA (palette d'un import, empreinte). */
export function svgToPixels(svg: string, options: RasterOptions) {
  const prepared = prepare(svg, options);
  const image = render(prepared.svg, prepared.width);
  return { data: new Uint8Array(image.pixels), width: image.width, height: image.height };
}

/** JPG sur fond plein (blanc par défaut) : le format ne gère pas la transparence. */
export function svgToJpeg(svg: string, options: RasterOptions & { quality?: number }): Buffer {
  const background = options.background ?? '#ffffff';
  const { data, width, height } = svgToPixels(svg, { ...options, background });
  const [br, bg, bb] = hexToRgb(background);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a + br * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + bg * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + bb * (1 - a));
    data[i + 3] = 255;
  }
  return jpeg.encode({ data: Buffer.from(data), width, height }, options.quality ?? 92).data;
}

/** favicon.ico multi-tailles (16/32/48) : images PNG dans un conteneur ICO (LOGO-22). */
export function buildIco(svg: string, sizes = [16, 32, 48]): Buffer {
  const pngs = sizes.map((size) => svgToPng(svg, { size, square: true, padding: 0.04 }));
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach((png, i) => {
    const entry = 6 + i * 16;
    const size = sizes[i] >= 256 ? 0 : sizes[i];
    header.writeUInt8(size, entry);
    header.writeUInt8(size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** Dimensions d'une image PNG (en-tête IHDR), null si ce n'est pas un PNG. */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  const signature = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== signature) return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Empreinte perceptuelle (pHash, §5.5) : DCT 32 × 32 des niveaux de gris, 8 × 8 basses
 * fréquences comparées à leur médiane. Deux logos proches ont une faible distance de Hamming.
 */
export function perceptualHash(svg: string): string {
  const N = 32;
  const { data } = svgToPixels(svg, {
    size: N,
    square: true,
    padding: 0.05,
    background: '#ffffff',
  });
  const gray = Array.from({ length: N * N }, (_, i) => {
    const p = i * 4;
    return 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  });
  const cos = Array.from({ length: 8 }, (_, u) =>
    Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
  );
  const coefficients: number[] = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) sum += gray[y * N + x] * cos[u][y] * cos[v][x];
      }
      coefficients.push(sum);
    }
  }
  const ac = coefficients.slice(1);
  const median = [...ac].sort((a, b) => a - b)[Math.floor(ac.length / 2)];
  let bits = '';
  for (const c of coefficients) bits += c > median ? '1' : '0';
  return BigInt('0b' + bits)
    .toString(16)
    .padStart(16, '0');
}

export function hammingDistance(a: string, b: string) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let count = 0;
  while (x) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
