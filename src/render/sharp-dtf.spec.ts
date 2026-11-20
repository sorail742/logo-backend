import sharp from 'sharp';
import {
  findClosestPantone,
  generateDtfWhiteUnderbase,
  generateScreenPrintSeparation,
} from './sharp-dtf';

describe('sharp-dtf local image processing', () => {
  it('trouve la couleur Pantone Solid Coated la plus proche', () => {
    // Rouge vif (#DA291C) -> Pantone 485 C
    const red = findClosestPantone('#DA291C');
    expect(red.code).toBe('Pantone 485 C');

    // Bleu roi (#0033A0) -> Pantone 286 C
    const blue = findClosestPantone('#0033A0');
    expect(blue.code).toBe('Pantone 286 C');

    // Noir (#2D2926 ou #000000) -> Pantone Black C
    const black = findClosestPantone('#000000');
    expect(black.code).toBe('Pantone Black C');
  });

  it('génère une sous-couche blanche DTF chokée à partir d’une image PNG transparente', async () => {
    // Créer une image 20x20 avec un carré opaque 10x10 au centre
    const rawRgba = new Uint8Array(20 * 20 * 4);
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) {
        const idx = (y * 20 + x) * 4;
        rawRgba[idx] = 255; // R
        rawRgba[idx + 1] = 0; // G
        rawRgba[idx + 2] = 0; // B
        rawRgba[idx + 3] = 255; // A (opaque)
      }
    }

    const testPng = await sharp(rawRgba, {
      raw: { width: 20, height: 20, channels: 4 },
    })
      .png()
      .toBuffer();

    // Avec choke = 1 px
    const underbase = await generateDtfWhiteUnderbase(testPng, { chokePixels: 1 });
    expect(underbase).toBeInstanceOf(Buffer);

    // Vérifier les dimensions et le canal (1 canal niveaux de gris)
    const meta = await sharp(underbase).metadata();
    expect(meta.width).toBe(20);
    expect(meta.height).toBe(20);
    expect([1, 3]).toContain(meta.channels);
    expect(meta.format).toBe('png');

    // Vérifier que le carré intérieur a subi une érosion (choke) d'un pixel sur les bords
    const { data: underbaseData, info } = await sharp(underbase)
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Le centre (x=10, y=10) doit être blanc (255)
    expect(underbaseData[(10 * 20 + 10) * info.channels]).toBe(255);
    // Le bord extérieur d'origine (x=5, y=5) doit avoir été choké à 0 (noir / pas de blanc)
    expect(underbaseData[(5 * 20 + 5) * info.channels]).toBe(0);
    // L'extérieur (x=0, y=0) doit être 0
    expect(underbaseData[0]).toBe(0);
  });

  it('génère un film positif de séparation sérigraphie en noir 100% opaque', async () => {
    // Créer une image 10x10 avec moitié rouge (#FF0000) et moitié vert (#00FF00)
    const rawRgba = new Uint8Array(10 * 10 * 4);
    for (let i = 0; i < 50; i++) {
      rawRgba[i * 4] = 255; // R
      rawRgba[i * 4 + 3] = 255; // A
    }
    for (let i = 50; i < 100; i++) {
      rawRgba[i * 4 + 1] = 255; // G
      rawRgba[i * 4 + 3] = 255; // A
    }

    const testPng = await sharp(rawRgba, {
      raw: { width: 10, height: 10, channels: 4 },
    })
      .png()
      .toBuffer();

    // Extraire la séparation pour le rouge #FF0000
    const sepRed = await generateScreenPrintSeparation(testPng, '#FF0000');
    expect(sepRed).toBeInstanceOf(Buffer);

    const { data } = await sharp(sepRed).raw().toBuffer({ resolveWithObject: true });

    // La première moitié (pixels rouges) doit être noir opaque (#000000, alpha 255)
    expect(data[0]).toBe(0); // R
    expect(data[1]).toBe(0); // G
    expect(data[2]).toBe(0); // B
    expect(data[3]).toBe(255); // Alpha

    // La seconde moitié (pixels verts) doit être transparente (alpha 0)
    expect(data[50 * 4 + 3]).toBe(0);
  });
});
