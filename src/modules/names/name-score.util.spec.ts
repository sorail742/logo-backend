import { lengthScore, pronounceabilityScore, scoreName } from './name-score.util';

describe('name-score', () => {
  it('préfère les noms courts mais pas trop', () => {
    expect(lengthScore('Kalora')).toBe(1);
    expect(lengthScore('Ka')).toBeLessThan(1);
    expect(lengthScore('Organisationnalisation')).toBeLessThan(0.5);
  });

  it('pénalise les noms imprononçables', () => {
    expect(pronounceabilityScore('Kalora')).toBeGreaterThan(pronounceabilityScore('Xkrtzp'));
  });

  it('reste entre 0 et 100 et tient compte de la disponibilité', () => {
    const free = scoreName({ value: 'Kalora', availability: 1 });
    const taken = scoreName({ value: 'Kalora', availability: 0 });
    expect(free).toBeGreaterThan(taken);
    expect(free).toBeLessThanOrEqual(100);
    expect(taken).toBeGreaterThanOrEqual(0);
  });
});
