import sharp from 'sharp';

/**
 * Traitement d'images 100% local via Sharp pour l'atelier textile.
 * RÈGLE ABSOLUE : ZÉRO API EXTERNE DE TRAITEMENT D'IMAGE.
 */

export interface DtfUnderbaseOptions {
  /** Retrait morphologique (choke) en pixels (1 à 2 px recommandés) */
  chokePixels?: number;
  /** Seuil alpha minimal pour considérer un pixel opaque (0-255, défaut 10) */
  alphaThreshold?: number;
}

/**
 * 3.1 Sous-couche blanche DTF chokée (White Underbase with Choke)
 * - Extrait le canal alpha de l'image (PNG 300 DPI transparent).
 * - Binarise l'alpha (seuil > 10/255 pour exclure les artefacts semi-transparents).
 * - Applique un retrait morphologique (choke) de 1 à 2 pixels pour éviter que le blanc ne bave sur textile sombre.
 * - Génère une image en niveaux de gris (opaque sous l'encre, noir = absence de blanc).
 */
export async function generateDtfWhiteUnderbase(
  imageBuffer: Buffer,
  options: DtfUnderbaseOptions = {},
): Promise<Buffer> {
  const choke = options.chokePixels ?? 1;
  const threshold = options.alphaThreshold ?? 10;

  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error('Image invalide : largeur ou hauteur nulle');
  }

  // Obtenir les pixels RGBA bruts
  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // 1. Extraire et binariser le canal alpha
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3];
    alpha[i] = a > threshold ? 255 : 0;
  }

  // 2. Retrait morphologique (érosion / choke)
  let choked = alpha;
  if (choke > 0) {
    choked = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (alpha[idx] === 0) {
          choked[idx] = 0;
          continue;
        }

        let keep = true;
        for (let dy = -choke; dy <= choke; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) {
            keep = false;
            break;
          }
          for (let dx = -choke; dx <= choke; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) {
              keep = false;
              break;
            }
            if (alpha[ny * width + nx] === 0) {
              keep = false;
              break;
            }
          }
          if (!keep) break;
        }
        choked[idx] = keep ? 255 : 0;
      }
    }
  }

  // 3. Génération PNG niveaux de gris (1 canal, 255 = blanc d'impression, 0 = pas d'encre)
  return sharp(choked, {
    raw: {
      width,
      height,
      channels: 1,
    },
  })
    .png()
    .toBuffer();
}

/**
 * 3.2 Séparation sérigraphie (Screen Print Separation)
 * Extrait les composantes d'une couleur d'accompagnement (ton direct)
 * sous forme de film positif UV 100% noir opaque (pour insolation de typon).
 */
export async function generateScreenPrintSeparation(
  imageBuffer: Buffer,
  targetHex: string,
  tolerance = 32,
): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (!width || !height) {
    throw new Error('Image invalide');
  }

  const { data } = await image
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const [tRed, tGreen, tBlue] = hexToRgb(targetHex);
  const tolSq = tolerance * tolerance;

  // Film positif UV : noir 100% opaque (#000000 avec alpha 255) là où la couleur est présente,
  // et transparent (#000000 avec alpha 0) partout ailleurs.
  const typon = new Uint8Array(width * height * 4);

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const a = data[i * 4 + 3];

    if (a < 10) {
      // Pixel transparent dans l'original
      continue;
    }

    const dr = r - tRed;
    const dg = g - tGreen;
    const db = b - tBlue;
    const distSq = dr * dr + dg * dg + db * db;

    if (distSq <= tolSq) {
      // Correspond à la couleur : noir opaque
      typon[i * 4] = 0; // R
      typon[i * 4 + 1] = 0; // G
      typon[i * 4 + 2] = 0; // B
      typon[i * 4 + 3] = 255; // Alpha
    }
  }

  return sharp(typon, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Table de référence Pantone Solid Coated standard pour textile & sérigraphie */
const PANTONE_SOLID_COATED: Array<{ code: string; name: string; hex: string; rgb: [number, number, number] }> = [
  { code: 'Black C', name: 'Process Black', hex: '#2D2926', rgb: [45, 41, 38] },
  { code: 'White C', name: 'Bright White', hex: '#FFFFFF', rgb: [255, 255, 255] },
  { code: '186 C', name: 'Classic Red', hex: '#C8102E', rgb: [200, 16, 46] },
  { code: '485 C', name: 'Bright Red', hex: '#DA291C', rgb: [218, 41, 28] },
  { code: '032 C', name: 'Scarlet Red', hex: '#EF3340', rgb: [239, 51, 64] },
  { code: '286 C', name: 'Royal Blue', hex: '#0033A0', rgb: [0, 51, 160] },
  { code: '289 C', name: 'Dark Navy', hex: '#0C2340', rgb: [12, 35, 64] },
  { code: '293 C', name: 'Cobalt Blue', hex: '#0051BA', rgb: [0, 81, 186] },
  { code: '300 C', name: 'Vibrant Blue', hex: '#005EB8', rgb: [0, 94, 184] },
  { code: '356 C', name: 'Forest Green', hex: '#007A3D', rgb: [0, 122, 61] },
  { code: '368 C', name: 'Lime Green', hex: '#78BE20', rgb: [120, 190, 32] },
  { code: '347 C', name: 'Emerald Green', hex: '#009A44', rgb: [0, 154, 68] },
  { code: '109 C', name: 'Golden Yellow', hex: '#FFD100', rgb: [255, 209, 0] },
  { code: '116 C', name: 'Bright Yellow', hex: '#FFCD00', rgb: [255, 205, 0] },
  { code: '021 C', name: 'Safety Orange', hex: '#FE5000', rgb: [254, 80, 0] },
  { code: '165 C', name: 'Tangerine Orange', hex: '#FF671F', rgb: [255, 103, 31] },
  { code: '2597 C', name: 'Deep Purple', hex: '#5B0F75', rgb: [91, 15, 117] },
  { code: '268 C', name: 'Royal Purple', hex: '#582C83', rgb: [88, 44, 131] },
  { code: '226 C', name: 'Hot Pink / Magenta', hex: '#D60270', rgb: [214, 2, 112] },
  { code: 'Cool Gray 9 C', name: 'Slate Gray', hex: '#75787B', rgb: [117, 120, 123] },
  { code: 'Cool Gray 3 C', name: 'Light Gray', hex: '#C8C9C7', rgb: [200, 201, 199] },
  { code: '877 C', name: 'Metallic Silver', hex: '#8A8D8F', rgb: [138, 141, 143] },
  { code: '871 C', name: 'Metallic Gold', hex: '#84754E', rgb: [132, 117, 78] },
];

/**
 * Trouve la couleur Pantone Solid Coated la plus proche d'un code HEX donné.
 */
export function findClosestPantone(hex: string): { code: string; name: string; hex: string } {
  const [r, g, b] = hexToRgb(hex);
  let best = PANTONE_SOLID_COATED[0];
  let minDistance = Infinity;

  for (const p of PANTONE_SOLID_COATED) {
    const dr = r - p.rgb[0];
    const dg = g - p.rgb[1];
    const db = b - p.rgb[2];
    const dist = dr * dr * 2 + dg * dg * 4 + db * db * 3; // Luma-weighted distance
    if (dist < minDistance) {
      minDistance = dist;
      best = p;
    }
  }

  return { code: `Pantone ${best.code}`, name: best.name, hex: best.hex };
}
