import type { StudioDesign } from '@prisma/client';

/** Création sans son document (listes). */
export function toStudioSummary({ doc: _doc, createdById: _by, ...design }: StudioDesign) {
  return design;
}

/** Création complète (type StudioDesign du front). */
export function toStudioDesign({ createdById: _by, ...design }: StudioDesign) {
  return design;
}
