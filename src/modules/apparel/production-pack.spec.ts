import { buildPiece, pieceSvg, playerKey, type PrintElement } from '../../render/apparel-print';
import { inflate, pathPolygons, pieceCutLayers, union } from '../../render/cut-file';
import { packPieces } from '../../render/gang-sheet';
import { pngSize } from '../../render/raster';
import { DEFAULT_SIZES, DEFAULT_TEMPLATES } from './apparel-defaults';
import { buildProductionPack, collectPieces, SUPPORTS, type PackInput } from './production-pack';

const jersey = DEFAULT_TEMPLATES.find((t) => t.category === 'FOOTBALL_JERSEY')!;
const zone = (key: string) => {
  const z = jersey.zones.find((item) => item.key === key)!;
  return { ...z, label: z.label };
};

const number: PrintElement = {
  zoneKey: 'back_number',
  kind: 'PLAYER_NUMBER',
  widthMm: 240,
  heightMm: 300,
  offsetXMm: 30,
  offsetYMm: 20,
  rotationDeg: 0,
  content: {
    text: '10',
    fontId: 'graduate',
    fill: '#ffffff',
    textOutline: { color: '#ce1126', widthMm: 5 },
  },
};
const name: PrintElement = {
  zoneKey: 'back_name',
  kind: 'PLAYER_NAME',
  widthMm: 240,
  heightMm: 60,
  offsetXMm: 20,
  offsetYMm: 8,
  rotationDeg: 0,
  content: { text: 'NOM', fontId: 'oswald', fontWeight: 700, fill: '#ffffff' },
};
const sponsor: PrintElement = {
  zoneKey: 'front_sponsor',
  kind: 'SPONSOR',
  widthMm: 200,
  heightMm: 60,
  offsetXMm: 20,
  offsetYMm: 10,
  rotationDeg: 0,
  content: { text: 'KALOUM', fontId: 'bebas-neue', fill: '#fcd116' },
};

const input = (patch: Partial<PackInput> = {}): PackInput => ({
  design: {
    name: 'Kaloum FC',
    technique: 'DTF',
    garmentColor: '#1e3a8a',
    template: jersey.name,
    proofUrl: null,
    approvedAt: null,
  },
  zones: jersey.zones,
  sizes: DEFAULT_SIZES,
  referenceSize: 'M',
  elements: [number, name, sponsor],
  players: [
    { displayName: 'DIALLO', number: '10', size: 'M', quantity: 1 },
    { displayName: 'BAH', number: '1', size: 'L', quantity: 2 },
  ],
  copies: 1,
  support: 'DTF_FILM',
  mirror: false,
  now: new Date('2026-10-24T10:00:00Z'),
  ...patch,
});

describe('pack atelier : pièces', () => {
  it('nomme les fichiers NUMERO_NOM_TAILLE sans accents', () => {
    expect(playerKey({ displayName: 'Aïssatou Camara', number: '7', size: 'S', quantity: 1 })).toBe(
      '7_AISSATOU-CAMARA_S',
    );
    expect(playerKey({ displayName: 'SOUMAH', number: null, size: 'XL', quantity: 1 })).toBe(
      'SOUMAH_XL',
    );
  });

  it('remplace le nom et le numéro par ceux du joueur, et regroupe les pièces communes', () => {
    const { pieces } = collectPieces(input());
    const keys = pieces.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        '10_DIALLO_M_back_number',
        '10_DIALLO_M_back_name',
        '1_BAH_L_back_number',
      ]),
    );
    const diallo = pieces.find((p) => p.key === '10_DIALLO_M_back_number')!;
    expect(diallo.elements[0].el.type === 'text' && diallo.elements[0].el.text).toBe('10');
    // Sponsor : zone proportionnelle, une pièce par taille ; la taille L compte 2 maillots.
    const sponsorL = pieces.find(
      (p) => p.key.startsWith('commun_front_sponsor') && p.sizes.includes('L'),
    )!;
    expect(sponsorL.quantity).toBe(2);
  });

  it('condense un nom long jusqu’à 80 %, puis réduit sa hauteur et le signale', () => {
    const long = {
      displayName: 'KOUROUMA-CAMARA SOUMAH DIABATÉ',
      number: '9',
      size: 'M',
      quantity: 1,
    };
    const piece = buildPiece({
      key: 'k',
      player: 'k',
      zone: { ...zone('back_name') },
      sizes: ['M'],
      elements: [name],
      scale: 1,
      playerData: long,
      quantity: 1,
      minNameHeightMm: 50,
    })!;
    expect(piece.elements[0].scaleX).toBeCloseTo(0.8, 5);
    expect(piece.elements[0].el.height).toBeLessThan(60);
    expect(piece.warnings[0]).toMatch(/réduit à \d+ mm de haut \(minimum 50 mm\)/);
  });

  it('dessine à l’échelle 1:1 : unités en mm, PNG à 300 dpi', () => {
    const piece = collectPieces(input()).pieces.find((p) => p.key === '10_DIALLO_M_back_number')!;
    const svg = pieceSvg(piece);
    expect(svg).toContain(`width="${piece.widthMm}mm" height="${piece.heightMm}mm"`);
    // Le numéro de 300 mm garde sa boîte de 300 mm dans la pièce (marges autour).
    expect(piece.elements[0].el.height).toBe(300);
    expect(piece.heightMm).toBeGreaterThan(300);
  });
});

describe('pack atelier : découpe et planches', () => {
  it('aplatit les courbes et réunit les contours', () => {
    const square = pathPolygons('M0 0L10 0L10 10L0 10Z');
    expect(square).toHaveLength(1);
    const curved = pathPolygons('M0 0Q5 10 10 0Z');
    expect(curved[0].length).toBeGreaterThan(3);
    const merged = union([...square, ...pathPolygons('M5 5L15 5L15 15L5 15Z')]);
    expect(merged).toHaveLength(1);
    // Élargi de 2 mm : 14 mm de côté au lieu de 10.
    const grown = inflate(square, 2)[0];
    const xs = grown.map(([x]) => x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(14, 1);
  });

  it('découpe un numéro à contour en deux films : remplissage et contour élargi', () => {
    const piece = collectPieces(input()).pieces.find((p) => p.key === '10_DIALLO_M_back_number')!;
    const { layers, skipped } = pieceCutLayers(piece);
    expect(layers.map((l) => l.color).sort((a, b) => a.localeCompare(b))).toEqual([
      '#ce1126',
      '#ffffff',
    ]);
    expect(skipped).toEqual([]);
    const extent = (color: string) => {
      const xs = layers
        .find((l) => l.color === color)!
        .polygons.flat()
        .map(([x]) => x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent('#ce1126') - extent('#ffffff')).toBeCloseTo(10, 0);
  });

  it('imbrique les exemplaires, tourne une pièce trop large et écarte celles trop grandes', () => {
    const { pieces } = collectPieces(input());
    const names = pieces.filter((p) => p.key.endsWith('back_name'));
    const a4 = packPieces(names, { format: 'A4' });
    // DIALLO ×1 et BAH ×2 : trois noms posés, tournés (plus larges que l'A4 en portrait).
    expect(a4.pages.flatMap((p) => p.placements)).toHaveLength(3);
    expect(a4.pages[0].placements.every((p) => p.rotated)).toBe(true);
    const numbers = pieces.filter((p) => p.key.endsWith('back_number'));
    expect(packPieces(numbers, { format: 'A4' }).oversized).toHaveLength(2);
  });
});

describe('pack atelier : archives', () => {
  jest.setTimeout(60_000);

  it('produit un fichier par joueur et le récapitulatif par taille (25 joueurs)', async () => {
    const sizes = ['S', 'M', 'L', 'XL'];
    const players = Array.from({ length: 25 }, (_, i) => ({
      displayName: `JOUEUR ${String.fromCharCode(65 + i)}`,
      number: String(i + 1),
      size: sizes[i % 4],
      quantity: 1,
    }));
    const pack = await buildProductionPack(
      input({ players, elements: [name], support: 'TRANSFER_DARK', mirror: false }),
    );
    const files = pack.entries.map((e) => e.path);
    expect(
      files.filter((f) => /\/joueurs\/\d+_JOUEUR-[A-Z]_(S|M|L|XL)\.pdf$/.test(f)),
    ).toHaveLength(25);
    expect(files).toEqual(expect.arrayContaining(['fiche-technique.pdf', 'LISEZ-MOI.txt']));
    expect(pack.techSheet.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('flex : contours fermés par couleur, en miroir, sans dégradé', async () => {
    const plain = await buildProductionPack(
      input({ elements: [number], support: 'FLEX', mirror: false }),
    );
    const mirrored = await buildProductionPack(
      input({ elements: [number], support: 'FLEX', mirror: true }),
    );
    const svgOf = (pack: typeof plain) =>
      String(pack.entries.find((e) => /decoupe\/\d-CE1126\/planche-1\.svg$/.test(e.path))!.data);
    const svg = svgOf(plain);
    const subpaths = svg.match(/M[^MZ]+Z/g) ?? [];
    expect(subpaths.length).toBeGreaterThan(0);
    expect(svg).not.toMatch(/Gradient/);
    const minX = (s: string) =>
      Math.min(...[...s.matchAll(/[ML]([\d.]+) /g)].map((m) => Number(m[1])));
    // Miroir : le dessin passe du bord gauche au bord droit du rouleau.
    expect(minX(svgOf(mirrored))).toBeGreaterThan(minX(svg));
    expect(plain.entries.some((e) => e.path.endsWith('.dxf'))).toBe(true);
    expect(SUPPORTS.FLEX.mirror).toBe(true);
  });

  it('papier transfert clair : signale le blanc, impossible à imprimer', async () => {
    const pack = await buildProductionPack(
      input({ elements: [name], support: 'TRANSFER_LIGHT', mirror: true }),
    );
    expect(pack.warnings.join(' ')).toMatch(/blanc ne s’imprime pas/);
    const png = pack.entries.find((e) => e.path.endsWith('.png'))!;
    const size = pngSize(png.data as Buffer)!;
    const piece = collectPieces(input({ elements: [name] })).pieces[0];
    expect(Math.abs(size.width - Math.round((piece.widthMm / 25.4) * 300))).toBeLessThanOrEqual(1);
  });

  it('sérigraphie : un film par couleur pour les visuels communs', async () => {
    const pack = await buildProductionPack(
      input({ elements: [sponsor, name], support: 'SCREEN_FILM', mirror: false }),
    );
    const films = pack.entries.filter((e) => e.path.includes('/films/') && e.path.endsWith('.pdf'));
    expect(films.length).toBeGreaterThan(0);
    expect(films.every((f) => /FCD116\.pdf$/.test(f.path))).toBe(true);
    expect(pack.warnings.join(' ')).toMatch(/Noms et numéros/);
  });
});
