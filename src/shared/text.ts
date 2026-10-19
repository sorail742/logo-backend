/** Outils de texte partagés. */

/** Minuscules sans accents (comparaisons, recherches). */
export function foldAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Mots d'un texte, normalisés (sans accents ni ponctuation). */
export function words(s: string): string[] {
  return foldAccents(s)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/** Nombre de mots tel qu'un lecteur le compte (apostrophes et traits d'union ne coupent pas). */
export function wordCount(s: string): number {
  return s
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
