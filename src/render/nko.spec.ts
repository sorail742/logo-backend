import { FONTS, isLibraryFont, shapeText } from './fonts';
import { bidiRuns, nkoForms } from './nko';
import { nkoPieces } from './pdf';

describe('écriture N’Ko', () => {
  it('donne les formes contextuelles des lettres liées, signes diacritiques ignorés', () => {
    // Lettres à double liaison ; ߯ (ton) est un signe transparent, l'espace coupe la liaison.
    expect(nkoForms(Array.from('ߞߏ'))).toEqual(['init', 'fina']);
    expect(nkoForms(Array.from('ߓߊ߯ߞ'))).toEqual(['init', 'medi', null, 'fina']);
    expect(nkoForms(Array.from('ߞ ߏ'))).toEqual([null, null, null]);
  });

  it('ordonne les segments comme le navigateur (direction de base gauche-à-droite)', () => {
    expect(bidiRuns('Kafo')).toEqual([{ text: 'Kafo', rtl: false }]);
    expect(bidiRuns('ߊ߲ ߓߊ߯')).toEqual([{ text: 'ߊ߲ ߓߊ߯', rtl: true }]);
    expect(bidiRuns('Kafo ߒߞߏ !')).toEqual([
      { text: 'Kafo ', rtl: false },
      { text: 'ߒߞߏ', rtl: true },
      { text: ' !', rtl: false },
    ]);
    // Chiffres après une lettre N'Ko : affichés à gauche du segment, de gauche à droite.
    expect(bidiRuns('ߒߞߏ 2024 Conakry')).toEqual([
      { text: '2024', rtl: false },
      { text: 'ߒߞߏ ', rtl: true },
      { text: ' Conakry', rtl: false },
    ]);
  });

  it('dessine le N’Ko de droite à gauche avec la police de secours, en formes liées', () => {
    const forward = shapeText('ߞߏ', { fontId: 'montserrat', weight: 400, size: 100 }).glyphs();
    const isolated = shapeText('ߞ ߏ', { fontId: 'montserrat', weight: 400, size: 100 }).glyphs();
    expect(forward).toHaveLength(2);
    // ߏ (dernière lettre) à gauche, ߞ à droite ; formes liées différentes des formes isolées.
    expect(forward[0].d).not.toBe(isolated[0].d);
    expect(forward[1].d).not.toBe(isolated[2].d);
    expect(forward.every((g) => g.d.length > 0)).toBe(true);
  });

  it('écrit les mots d’un segment N’Ko dans l’ordre d’affichage des PDF', () => {
    expect(nkoPieces('ߊ߲ ߓߊ߯ ߞߊ߲ ')).toEqual([
      { text: 'ߞߊ߲', face: 'nko' },
      { text: ' ', face: 'latin' },
      { text: 'ߓߊ߯', face: 'nko' },
      { text: ' ', face: 'latin' },
      { text: 'ߊ߲', face: 'nko' },
      { text: ' ', face: 'latin' },
    ]);
  });

  it('garde la police de secours hors de la bibliothèque proposée', () => {
    expect(FONTS).toHaveLength(47);
    expect(isLibraryFont('noto-sans-nko')).toBe(false);
    expect(FONTS.filter((f) => f.scripts.includes('pular')).map((f) => f.id)).toContain(
      'montserrat',
    );
  });
});
