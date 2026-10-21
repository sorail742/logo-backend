/**
 * Liste de référence interne de slogans connus (SIG-04), complétée par l'administration au fil
 * du temps. Un slogan généré trop proche est signalé, pas supprimé : l'utilisateur décide.
 */
import { words } from '../../shared/text';

export const KNOWN_SLOGANS = [
  'Just do it',
  'Impossible is nothing',
  'Think different',
  "I'm lovin' it",
  'Because you are worth it',
  'Parce que vous le valez bien',
  'Connecting people',
  'Open happiness',
  'Taste the feeling',
  'The best a man can get',
  'Il faut que ça change',
  'Venez comme vous êtes',
  "C'est bon la vie",
  'Ensemble, tout devient possible',
  'Le meilleur est à venir',
  "L'avenir appartient à ceux qui se lèvent tôt",
  'Unis pour le meilleur',
  'Ensemble, on va plus loin',
  "Plus qu'une passion",
  'Your potential, our passion',
  'Empowering people',
  'Making the world a better place',
  'Every little helps',
  'Have it your way',
  'The happiest place on earth',
  'Melts in your mouth, not in your hands',
  'Travail Justice Solidarité',
  'Liberté Égalité Fraternité',
  'Union Discipline Travail',
  'Paix Travail Patrie',
];

/** Similarité de Jaccard sur les mots (sans accents, ponctuation ni mots vides). */
const STOP = new Set([
  'le',
  'la',
  'les',
  'de',
  'des',
  'du',
  'un',
  'une',
  'et',
  'a',
  'the',
  'of',
  'to',
  'it',
  'is',
  'en',
  'pour',
  'your',
  'our',
]);

function tokens(s: string): Set<string> {
  return new Set(words(s).filter((w) => !STOP.has(w)));
}

export function similarity(a: string, b: string): number {
  const [ta, tb] = [tokens(a), tokens(b)];
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return inter / (ta.size + tb.size - inter);
}

export const SIMILARITY_THRESHOLD = 0.6;

/** Slogan connu le plus proche au-delà du seuil, sinon null. */
export function closestKnownSlogan(
  text: string,
  reference: string[] = KNOWN_SLOGANS,
): string | null {
  let best: { s: string; score: number } | null = null;
  for (const s of reference) {
    const score = similarity(text, s);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) best = { s, score };
  }
  return best?.s ?? null;
}
