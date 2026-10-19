import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type TermScope = 'NAME' | 'SLOGAN' | 'STAMP';

/** Marques célèbres filtrées dans les briefs et les résultats (§14.2). */
const FAMOUS_BRANDS = [
  'google', 'apple', 'microsoft', 'amazon', 'facebook', 'meta', 'instagram', 'tiktok', 'whatsapp',
  'orange', 'mtn', 'coca cola', 'cocacola', 'pepsi', 'nike', 'adidas', 'samsung', 'netflix',
  'youtube', 'twitter', 'linkedin', 'uber', 'airbnb', 'visa', 'mastercard', 'disney', 'toyota',
];

const CACHE_TTL_MS = 5 * 60_000;

/** Normalisation : minuscules, sans accents, séparateurs uniformisés. */
export function normalizeText(s: string): string {
  return ` ${s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
}

/** Vrai si `text` contient `term` comme mot ou suite de mots entiers. */
export function containsTerm(text: string, term: string): boolean {
  return normalizeText(text).includes(normalizeText(term));
}

/**
 * Liste noire multilingue (NOM-14, §6.4, ADM-12). Les termes viennent de BlockedTerm,
 * mis en cache quelques minutes.
 */
@Injectable()
export class ModerationService {
  private cache: { at: number; terms: { term: string; scope: string }[] } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async terms() {
    if (!this.cache || Date.now() - this.cache.at > CACHE_TTL_MS) {
      const terms = await this.prisma.blockedTerm.findMany({ select: { term: true, scope: true } });
      this.cache = { at: Date.now(), terms };
    }
    return this.cache.terms;
  }

  invalidate() {
    this.cache = null;
  }

  /** Renvoie les termes interdits trouvés dans le texte pour ce périmètre. */
  async findBlocked(text: string, scope: TermScope): Promise<string[]> {
    const found = (await this.terms())
      .filter((t) => t.scope === scope && containsTerm(text, t.term))
      .map((t) => t.term);
    if (scope === 'NAME') {
      found.push(...FAMOUS_BRANDS.filter((b) => containsTerm(text, b)));
    }
    return found;
  }

  async isAllowed(text: string, scope: TermScope) {
    return (await this.findBlocked(text, scope)).length === 0;
  }
}
