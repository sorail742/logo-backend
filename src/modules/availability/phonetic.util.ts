/**
 * Clé phonétique adaptée au français (inspirée de Soundex2 / Phonex), pour NOM-23 :
 * deux noms dont les clés sont égales ou à une modification près se prononcent de façon proche.
 */
const RULES: [RegExp, string][] = [
  [/GUI/g, 'KI'],
  [/GUE/g, 'KE'],
  [/GA/g, 'KA'],
  [/GO/g, 'KO'],
  [/GU/g, 'K'],
  [/CA/g, 'KA'],
  [/CO/g, 'KO'],
  [/CU/g, 'KU'],
  [/QU?/g, 'K'],
  [/CK|CC/g, 'K'],
  [/SCH|SH|CH/g, 'S'],
  [/PH/g, 'F'],
  [/C(?=[EIY])/g, 'S'],
  [/C/g, 'K'],
  [/X/g, 'KS'],
  [/Z/g, 'S'],
  [/W/g, 'V'],
  [/EAU|AU/g, 'O'],
  [/OU/g, 'U'],
  [/AI|EI/g, 'E'],
  [/ET$/, 'E'],
  [/EN|AN|AM|EM/g, 'AN'],
  [/IN|EIN|AIN|UN/g, 'IN'],
  [/ON|OM/g, 'ON'],
  [/Y/g, 'I'],
  [/(?<![CS])H/g, ''],
];

export function phoneticKey(input: string): string {
  let s = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!s) return '';
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  // Lettres finales muettes fréquentes en français.
  s = s.replace(/[DTSXP]$/, '').replace(/E$/, '');
  // Lettres doublées réduites.
  return s.replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function soundsSimilar(a: string, b: string): boolean {
  const ka = phoneticKey(a);
  const kb = phoneticKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 4 && levenshtein(ka, kb) <= 1;
}
