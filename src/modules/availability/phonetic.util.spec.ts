import { phoneticKey, soundsSimilar } from './phonetic.util';

describe('phonetic', () => {
  it.each([
    ['Kalora', 'Calora'],
    ['Phénix', 'Fénix'],
    ['Solidario', 'Solidaryo'],
    ['Kamara', 'Kammara'],
    ['Teranga', 'Térenga'],
  ])('%s et %s se prononcent de façon proche', (a, b) => {
    expect(soundsSimilar(a, b)).toBe(true);
  });

  it.each([
    ['Kalora', 'Baobab'],
    ['Nova', 'Sira'],
  ])('%s et %s sont différents', (a, b) => {
    expect(soundsSimilar(a, b)).toBe(false);
  });

  it('ignore les accents et la casse', () => {
    expect(phoneticKey('ÉLAN')).toBe(phoneticKey('elan'));
  });
});
