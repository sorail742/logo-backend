// Écriture N'Ko (U+07C0–U+07FF) : cursive, de droite à gauche. opentype.js ne façonne pas cette
// écriture ; on applique ici le minimum d'un moteur de mise en forme : ordre d'affichage des
// segments (droite à gauche), formes contextuelles des lettres (init, medi, fina) et position
// des signes diacritiques.

export const isNko = (char: string) => /[߀-߿]/.test(char);

/** Signes diacritiques N'Ko (tons, nasalisation) : sans chasse, posés sur la lettre précédente. */
export const isNkoMark = (char: string) => /[߫-߽߳]/.test(char);

type Joining = 'dual' | 'causing' | 'transparent' | 'none';

/** Type de liaison (Unicode, ArabicShaping.txt). */
function joiningType(char: string): Joining {
  if (/[ߊ-ߪ]/.test(char)) return 'dual';
  if (char === 'ߺ') return 'causing';
  if (isNkoMark(char)) return 'transparent';
  return 'none';
}

export type NkoForm = 'init' | 'medi' | 'fina' | null;

/** Forme contextuelle de chaque caractère (ordre logique) ; null : forme isolée ou sans forme. */
export function nkoForms(chars: string[]): NkoForm[] {
  const types = chars.map(joiningType);
  /** Voisin non transparent dans la direction donnée. */
  const neighbour = (index: number, step: 1 | -1) => {
    for (let i = index + step; i >= 0 && i < types.length; i += step) {
      if (types[i] !== 'transparent') return types[i];
    }
    return 'none';
  };
  return types.map((type, i) => {
    if (type !== 'dual') return null;
    const before = neighbour(i, -1);
    const after = neighbour(i, 1);
    const joinsBefore = before === 'dual' || before === 'causing';
    const joinsAfter = after === 'dual' || after === 'causing';
    if (joinsBefore && joinsAfter) return 'medi';
    if (joinsBefore) return 'fina';
    if (joinsAfter) return 'init';
    return null;
  });
}

export interface BidiRun {
  text: string;
  rtl: boolean;
}

type BidiClass = 'L' | 'R' | 'EN' | 'N';

/** Classe bidirectionnelle simplifiée (les signes N'Ko prennent celle de leur lettre). */
function bidiClass(char: string): BidiClass {
  if (isNko(char)) return 'R';
  if (/\p{Nd}/u.test(char)) return 'EN';
  return /\p{L}/u.test(char) ? 'L' : 'N';
}

/**
 * Segments d'une ligne dans l'ordre d'affichage (gauche à droite), selon l'algorithme
 * bidirectionnel d'Unicode réduit à ce qu'une ligne de logo contient, avec une direction de base
 * gauche-à-droite comme le texte SVG du navigateur : l'aperçu de l'éditeur et l'export
 * concordent. Le texte d'un segment droite-à-gauche reste en ordre logique : c'est à la mise en
 * forme d'inverser ses glyphes.
 */
export function bidiRuns(text: string): BidiRun[] {
  const chars = Array.from(text);
  if (!chars.some(isNko)) return text ? [{ text, rtl: false }] : [];
  const classes = chars.map(bidiClass);
  // W7 : chiffres précédés (au plus près) d'une lettre latine, ou en début de ligne → gauche-à-droite.
  let lastStrong: BidiClass = 'L';
  classes.forEach((c, i) => {
    if (c === 'L' || c === 'R') lastStrong = c;
    if (c === 'EN' && lastStrong === 'L') classes[i] = 'L';
  });
  // N1, N2 : un neutre prend la direction de ses voisins forts s'ils l'ont en commun (les chiffres
  // comptent comme droite-à-gauche), sinon la direction de base.
  const strongAround = (index: number, step: 1 | -1) => {
    for (let i = index + step; i >= 0 && i < classes.length; i += step) {
      if (classes[i] !== 'N') return classes[i] === 'L' ? 'L' : 'R';
    }
    return 'L';
  };
  // I1 : niveaux 0 (gauche-à-droite), 1 (droite-à-gauche), 2 (chiffres dans un texte N'Ko).
  const levels = classes.map((c, i) => {
    if (c === 'EN') return 2;
    if (c === 'R') return 1;
    if (c === 'L') return 0;
    const before = strongAround(i, -1);
    return before === strongAround(i, 1) && before === 'R' ? 1 : 0;
  });

  const runs: (BidiRun & { level: number })[] = [];
  chars.forEach((char, i) => {
    const last = runs.at(-1);
    if (last?.level === levels[i]) last.text += char;
    else runs.push({ text: char, rtl: levels[i] % 2 === 1, level: levels[i] });
  });
  // L2 : du niveau le plus haut au niveau 1, inverser l'ordre de chaque suite de segments de
  // niveau supérieur ou égal.
  for (let level = 2; level >= 1; level--) {
    let i = 0;
    while (i < runs.length) {
      if (runs[i].level < level) {
        i++;
        continue;
      }
      let end = i;
      while (end + 1 < runs.length && runs[end + 1].level >= level) end++;
      runs.splice(i, end - i + 1, ...runs.slice(i, end + 1).reverse());
      i = end + 1;
    }
  }
  return runs.map(({ text: runText, rtl }) => ({ text: runText, rtl }));
}
