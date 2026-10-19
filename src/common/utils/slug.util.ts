import { randomBytes } from 'node:crypto';

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Slug unique par suffixe aléatoire court. */
export function uniqueSlug(input: string): string {
  return `${slugify(input) || 'espace'}-${randomBytes(3).toString('hex')}`;
}
