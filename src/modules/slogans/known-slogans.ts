import { normalizeText } from '../moderation/moderation.service';

/**
 * Liste de référence interne des slogans connus (SIG-04) : une proposition trop proche est
 * écartée. Le contrôle IA complémentaire viendra avec le fournisseur réel.
 */
export const KNOWN_SLOGANS = [
  'just do it',
  'impossible is nothing',
  'think different',
  'i m lovin it',
  'because you re worth it',
  'connecting people',
  'the best a man can get',
  'open happiness',
  'taste the feeling',
  'have it your way',
  'finger lickin good',
  'the ultimate driving machine',
  'every little helps',
  'belong anywhere',
  'do what you can t',
  'be moved',
  'everyone s invited',
  'la vie la vraie',
  'parce que vous le valez bien',
  'venez comme vous etes',
  'le meilleur est a venir',
  'ensemble tout devient possible',
  'la banque d un monde qui change',
  'c est bon la france',
  'what else',
];

function words(text: string) {
  return normalizeText(text).trim().split(' ').filter(Boolean);
}

/**
 * Similarité de Jaccard sur les bigrammes de mots, ou sur les mots seuls dès qu'un des deux
 * textes est court.
 */
function similarity(a: string[], b: string[]) {
  const short = a.length < 3 || b.length < 3;
  const grams = (w: string[]) =>
    new Set(short ? w : w.slice(1).map((word, i) => `${w[i]} ${word}`));
  const x = grams(a);
  const y = grams(b);
  const common = [...x].filter((g) => y.has(g)).length;
  return common / Math.max(x.size + y.size - common, 1);
}

/** Slogan connu dont la proposition est trop proche, ou null. */
export function closeKnownSlogan(text: string, threshold = 0.6): string | null {
  const w = words(text);
  const joined = w.join(' ');
  for (const known of KNOWN_SLOGANS) {
    const k = words(known);
    if (joined === k.join(' ')) return known;
    // Un slogan connu de trois mots ou plus repris tel quel dans la proposition.
    if (k.length >= 3 && ` ${joined} `.includes(` ${k.join(' ')} `)) return known;
    if (similarity(w, k) >= threshold) return known;
  }
  return null;
}
