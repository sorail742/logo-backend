import type { Prisma } from '@prisma/client';

/** Relations nécessaires à la présentation d'un nom (type NameSuggestion du front). */
export const NAME_INCLUDE = {
  checks: { orderBy: { kind: 'asc' } },
  votes: { select: { userId: true, value: true } },
} satisfies Prisma.NameSuggestionInclude;

type NameRow = Prisma.NameSuggestionGetPayload<{ include: typeof NAME_INCLUDE }>;
type CheckRow = NameRow['checks'][number];

/** Vérification de disponibilité : lien de vérification manuelle quand il existe. */
export function toCheckDto({ kind, target, status, details, checkedAt }: CheckRow) {
  const extra = (details ?? {}) as { url?: string; manualCheck?: string };
  return { kind, target, status, url: extra.url ?? extra.manualCheck, checkedAt };
}

/** Nom avec total des votes et vote de l'utilisateur courant (NOM-31). */
export function toNameDto({ checks, votes, jobId: _jobId, ...name }: NameRow, userId: string) {
  return {
    ...name,
    votes: votes.reduce((sum, v) => sum + v.value, 0),
    myVote: votes.find((v) => v.userId === userId)?.value ?? 0,
    checks: checks.map(toCheckDto),
  };
}
