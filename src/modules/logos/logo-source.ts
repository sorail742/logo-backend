import { BadRequestException } from '@nestjs/common';
import { LogoEngine, Prisma } from '@prisma/client';
import type { LogoSource } from '../../render/logo-assets';
import { renderLogoSvg } from '../../render/logo';
import { logoSpecSchema, type LogoSpec } from '../../render/logo-spec';
import { optimizeSvg } from '../../render/svg';

/** Dernière version d'un logo, sans le SVG (listes). */
export const CURRENT_VERSION = {
  versions: {
    orderBy: { number: 'desc' },
    take: 1,
    select: { id: true, number: true, label: true, spec: true, createdAt: true },
  },
} satisfies Prisma.LogoInclude;

type LogoWithVersions<V> = { versions: V[] } & Record<string, unknown>;

/** Forme exposée par l'API : le logo et sa version courante (type Logo du front). */
export function toLogoDto<V>(logo: LogoWithVersions<V>) {
  const { versions, phash: _phash, ...rest } = logo;
  return { ...rest, current: versions[0] ?? null };
}

/** Valide une spec reçue (éditeur) ou relue en base ; erreurs au format problem+json. */
export function parseSpec(raw: unknown): LogoSpec {
  const parsed = logoSpecSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Spécification de logo invalide',
      errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
  }
  return parsed.data;
}

/** SVG final d'une spec : composition, texte en tracés, optimisation (§5.5). */
export function specToSvg(spec: LogoSpec) {
  return optimizeSvg(renderLogoSvg(spec).svg);
}

/**
 * Source de rendu d'une version : un logo importé garde son SVG d'origine tant qu'il n'a pas
 * été retravaillé dans l'éditeur (version 1) ; ensuite, la spec fait foi.
 */
export function logoSource(
  logo: { engine: LogoEngine },
  version: { number: number; spec: unknown; svg: string },
): LogoSource {
  const spec = parseSpec(version.spec);
  if (logo.engine === LogoEngine.UPLOAD && version.number === 1) {
    return { kind: 'svg', svg: version.svg, title: spec.text, background: spec.colors.background };
  }
  return { kind: 'spec', spec };
}
