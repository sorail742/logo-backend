/**
 * Score sur 100 (NOM-12) : longueur, facilité de prononciation, originalité, disponibilité.
 * Sans vérification de disponibilité, le critère compte pour une valeur neutre.
 */
export interface ScoreInput {
  value: string;
  /** Part des vérifications « disponible » parmi les vérifications concluantes, 0 à 1. */
  availability?: number;
  /** Mots du brief : un nom qui les reprend tels quels est moins original. */
  briefWords?: string[];
}

const VOWELS = /[aeiouyàâäéèêëîïôöùûü]/i;

export function lengthScore(value: string): number {
  const n = value.replace(/\s/g, '').length;
  if (n <= 3) return 0.6;
  if (n <= 8) return 1;
  if (n <= 12) return 0.75;
  return Math.max(0.2, 1 - (n - 12) * 0.08);
}

export function pronounceabilityScore(value: string): number {
  const letters = value.toLowerCase().replace(/[^a-zàâäéèêëîïôöùûüç]/g, '');
  if (!letters) return 0;
  // Pénalise les suites de 3 consonnes ou plus et les suites de 3 voyelles.
  let penalty = 0;
  let consonants = 0;
  let vowels = 0;
  for (const ch of letters) {
    if (VOWELS.test(ch)) {
      vowels++;
      consonants = 0;
      if (vowels >= 3) penalty++;
    } else {
      consonants++;
      vowels = 0;
      if (consonants >= 3) penalty++;
    }
  }
  const ratio = [...letters].filter((c) => VOWELS.test(c)).length / letters.length;
  const ratioScore = 1 - Math.min(1, Math.abs(ratio - 0.45) * 2);
  return Math.max(0, ratioScore - penalty * 0.2);
}

export function originalityScore(value: string, briefWords: string[] = []): number {
  const v = value.toLowerCase();
  const copies = briefWords.filter((w) => w.length > 3 && v.includes(w.toLowerCase())).length;
  return Math.max(0.3, 1 - copies * 0.3);
}

export function scoreName({ value, availability, briefWords }: ScoreInput): number {
  const score =
    0.25 * lengthScore(value) +
    0.25 * pronounceabilityScore(value) +
    0.2 * originalityScore(value, briefWords) +
    0.3 * (availability ?? 0.5);
  return Math.round(score * 100);
}
