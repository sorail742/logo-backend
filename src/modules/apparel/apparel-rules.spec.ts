import { DEFAULT_RULE_PRESETS, DEFAULT_SIZES, DEFAULT_TEMPLATES } from './apparel-defaults';
import {
  checkDesign,
  checkRoster,
  contrastRatio,
  Element,
  fitText,
  parseRosterCsv,
  productionFileName,
  resolveZone,
  Zone,
} from './apparel-rules';

const preset = (code: string) => DEFAULT_RULE_PRESETS.find((p) => p.code === code)!.rules;
const football = DEFAULT_TEMPLATES.find((t) => t.category === 'FOOTBALL_JERSEY')!.zones as Zone[];
const tshirt = DEFAULT_TEMPLATES.find((t) => t.category === 'TSHIRT')!.zones as Zone[];
const size = (l: string) => DEFAULT_SIZES.find((s) => s.label === l)!;

const backNumber = (heightMm: number, extra: Partial<Element> = {}): Element => ({
  id: 'n',
  zoneKey: 'back_number',
  kind: 'PLAYER_NUMBER',
  widthMm: heightMm * 0.6,
  heightMm,
  offsetXMm: 50,
  offsetYMm: 0,
  content: { colors: ['#FFFFFF'], strokeMm: 30 },
  ...extra,
});

const base = {
  zones: football,
  technique: 'HEAT_TRANSFER_VINYL' as const,
  garmentColor: '#0B3D91',
};

describe('checkDesign — règlement football', () => {
  it('signale un numéro dos de 22 cm non conforme en football hommes (critère de recette §16.13)', () => {
    const issues = checkDesign({
      ...base,
      elements: [backNumber(220)],
      preset: preset('FOOTBALL_MEN'),
    });
    expect(issues).toEqual([expect.objectContaining({ code: 'NUMBER_HEIGHT', severity: 'error' })]);
  });

  it('accepte 22 cm en football femmes', () => {
    const issues = checkDesign({
      ...base,
      elements: [backNumber(220)],
      preset: preset('FOOTBALL_WOMEN'),
    });
    expect(issues).toEqual([]);
  });

  it('exige 4 cm entre le nom et le numéro', () => {
    const name: Element = {
      id: 'name',
      zoneKey: 'back_name',
      kind: 'PLAYER_NAME',
      widthMm: 200,
      heightMm: 70,
      offsetXMm: 40,
      offsetYMm: 0,
      content: { colors: ['#FFFFFF'] },
    };
    // Nom de 70 à 140 mm sous le col, numéro à partir de 185 mm : écart 45 mm, conforme.
    expect(
      checkDesign({ ...base, elements: [name, backNumber(300)], preset: preset('FOOTBALL_MEN') }),
    ).toEqual([]);
    // Numéro décalé à 170 mm : écart 30 mm.
    const issues = checkDesign({
      ...base,
      zones: football.map((z) => (z.key === 'back_number' ? { ...z, offsetYMm: 170 } : z)),
      elements: [name, backNumber(300)],
      preset: preset('FOOTBALL_MEN'),
    });
    expect(issues.map((i) => i.code)).toContain('NAME_NUMBER_GAP');
  });

  it('interdit le ruban 3D multicolore en compétition', () => {
    const el = backNumber(300, { content: { style: 'RIBBON_3D', colors: ['#FFFFFF', '#FFD700'] } });
    const codes = checkDesign({
      ...base,
      technique: 'SUBLIMATION',
      garmentColor: '#F2F2F2',
      elements: [el],
      preset: preset('FOOTBALL_MEN'),
    }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['STYLE_FORBIDDEN', 'NUMBER_COLORS']));
  });

  it('le préréglage libre ne produit aucune alerte sportive', () => {
    expect(checkDesign({ ...base, elements: [backNumber(120)], preset: preset('FREE') })).toEqual(
      [],
    );
  });
});

describe('checkDesign — zones, technique, droits', () => {
  it('détecte un élément qui sort de sa zone', () => {
    const el = backNumber(300, { offsetXMm: 200 });
    expect(checkDesign({ ...base, elements: [el] }).map((i) => i.code)).toContain('OUT_OF_ZONE');
  });

  it('empêche de combiner devant plein et cœur', () => {
    const el = (zoneKey: string): Element => ({
      zoneKey,
      kind: 'LOGO',
      widthMm: 50,
      heightMm: 50,
      offsetXMm: 0,
      offsetYMm: 0,
      content: {},
    });
    const codes = checkDesign({
      ...base,
      zones: tshirt,
      elements: [el('front_full'), el('left_chest')],
    }).map((i) => i.code);
    expect(codes).toContain('ZONE_OVERLAP');
  });

  it('refuse un trait trop fin, une image et un dégradé en flex', () => {
    const thin = backNumber(300, { content: { strokeMm: 1.5, colors: ['#FFFFFF'] } });
    const img: Element = {
      id: 'i',
      zoneKey: 'back_sponsor',
      kind: 'IMAGE',
      widthMm: 100,
      heightMm: 50,
      offsetXMm: 0,
      offsetYMm: 0,
      content: { pixelWidth: 2000 },
    };
    const codes = checkDesign({ ...base, elements: [thin, img] }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['STROKE_TOO_THIN', 'NOT_CUTTABLE']));
  });

  it('signale une image sous 300 dpi à taille réelle', () => {
    const img: Element = {
      zoneKey: 'back_sponsor',
      kind: 'IMAGE',
      widthMm: 200,
      heightMm: 50,
      offsetXMm: 0,
      offsetYMm: 0,
      content: { pixelWidth: 1000 },
    };
    expect(checkDesign({ ...base, technique: 'DTF', elements: [img] }).map((i) => i.code)).toEqual([
      'LOW_RESOLUTION',
    ]);
  });

  it('bloque un écusson importé sans attestation de droits', () => {
    const crest: Element = {
      zoneKey: 'left_chest',
      kind: 'LOGO',
      widthMm: 70,
      heightMm: 80,
      offsetXMm: 10,
      offsetYMm: 5,
      content: { source: 'upload' },
    };
    expect(checkDesign({ ...base, elements: [crest] }).map((i) => i.code)).toEqual([
      'RIGHTS_REQUIRED',
    ]);
    expect(
      checkDesign({
        ...base,
        elements: [{ ...crest, content: { source: 'upload', rightsAttested: true } }],
      }),
    ).toEqual([]);
  });

  it('avertit d’un contraste faible avec le tissu', () => {
    const el = backNumber(300, { content: { colors: ['#123F99'], strokeMm: 30 } });
    expect(checkDesign({ ...base, elements: [el] })).toEqual([
      expect.objectContaining({ code: 'LOW_CONTRAST', severity: 'warning' }),
    ]);
  });

  it('refuse la sublimation sur tissu foncé', () => {
    expect(
      checkDesign({ ...base, technique: 'SUBLIMATION', elements: [] }).map((i) => i.code),
    ).toEqual(['SUBLIMATION_DARK']);
  });
});

describe('fitText — noms longs (TEX-23)', () => {
  it('garde la taille si le nom tient', () => {
    expect(fitText('DIALLO', 280, 70)).toMatchObject({ scaleX: 1, heightMm: 70, fits: true });
  });

  it('condense jusqu’à 80 % puis réduit sans descendre sous 5 cm (critère de recette)', () => {
    // 11 caractères : tient dans 280 mm à 5,1 cm, condensé à 80 %.
    const fit = fitText('KEITA-BALDE', 280, 70, 50);
    expect(fit.scaleX).toBe(0.8);
    expect(fit.heightMm).toBeGreaterThanOrEqual(50);
    expect(fit.widthMm).toBeLessThanOrEqual(280);
    expect(fit.fits).toBe(true);
  });

  it('signale un nom impossible à faire tenir au minimum', () => {
    expect(fitText('NOMEXTREMEMENTLONGPOURLEDOS', 280, 70, 50).fits).toBe(false);
  });
});

describe('zones et tailles (TEX-03)', () => {
  const sponsor = football.find((z) => z.key === 'front_sponsor')!;
  const number = football.find((z) => z.key === 'back_number')!;

  it('une zone proportionnelle suit la largeur de poitrine', () => {
    expect(resolveZone(sponsor, size('XL'), size('M')).maxWidthMm).toBeCloseTo(
      250 * (580 / 520),
      0,
    );
  });

  it('une zone fixe reste identique en adulte et se réduit pour un enfant', () => {
    expect(resolveZone(number, size('3XL'), size('M')).maxHeightMm).toBe(350);
    expect(resolveZone(number, size('8 ANS'), size('M')).maxHeightMm).toBeLessThan(350);
  });
});

describe('effectif (TEX-40, TEX-41)', () => {
  const csv =
    'nom,nom_imprime,numero,taille,poste,quantite\nMamadou Diallo,DIALLO,10,M,Joueur,1\nIbrahima Bah,I. BAH,1,L,Gardien,1\n"Camara, Aïssatou",CAMARA,7,s,Joueur,2';

  it('lit le format d’import du cahier, guillemets compris', () => {
    const { rows, errors } = parseRosterCsv(csv);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ playerName: 'Camara, Aïssatou', size: 'S', quantity: 2 });
  });

  it('ignore le BOM des CSV exportés par Excel', () => {
    expect(
      parseRosterCsv(String.fromCharCode(0xfeff) + 'nom,nom_imprime,numero,taille\nA,A,1,M').rows,
    ).toHaveLength(1);
  });

  it('détecte doublons, numéros interdits et tailles inconnues', () => {
    const rows = [
      { playerName: 'A', displayName: 'A', number: '10', size: 'M' },
      { playerName: 'B', displayName: 'B', number: '10', size: 'M' },
      { playerName: 'C', displayName: 'C', number: '00', size: '5XL' },
      { playerName: 'D', displayName: 'D', number: '7', size: '' },
    ];
    const codes = checkRoster(
      rows,
      DEFAULT_SIZES.map((s) => s.label),
      preset('FOOTBALL_MEN'),
    ).map((i) => i.code);
    expect(codes).toEqual(['NUMBER_DUPLICATE', 'SIZE_UNKNOWN', 'NUMBER_FORBIDDEN', 'SIZE_MISSING']);
  });

  it('accepte 0 et 00 en FIBA', () => {
    const rows = [
      { playerName: 'A', displayName: 'A', number: '0', size: 'M' },
      { playerName: 'B', displayName: 'B', number: '00', size: 'M' },
    ];
    expect(checkRoster(rows, ['M'], preset('FIBA'))).toEqual([]);
  });

  it('nomme les fichiers NUMERO_NOM_TAILLE', () => {
    expect(
      productionFileName({ playerName: 'x', displayName: 'I. Bah', number: '1', size: 'L' }),
    ).toBe('1_I-BAH_L');
  });
});

it('contraste : blanc sur noir = 21:1', () => {
  expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
});
