import type { Prisma } from '@prisma/client';
import { NAME_INCLUDE, toNameDto } from '../names/name.presenter';
import { omit } from '../../common/utils/object.util';

/** Relations nécessaires à la présentation d'un projet (type Project du front). */
export const PROJECT_INCLUDE = {
  brief: true,
  chosenName: { include: NAME_INCLUDE },
  // Logo d'aperçu : le favori, sinon le plus récent.
  logos: {
    orderBy: [{ isFavorite: 'desc' }, { createdAt: 'desc' }],
    take: 1,
    select: { versions: { orderBy: { number: 'desc' }, take: 1, select: { spec: true } } },
  },
  website: { select: { published: true } },
  _count: {
    select: {
      logos: true,
      signatures: true,
      brandKits: true,
      slogans: { where: { isChosen: true } },
    },
  },
} satisfies Prisma.ProjectInclude;

type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

/** Brief tel que l'éditeur l'attend : champs texte facultatifs vides plutôt que null. */
export function toBriefDto(brief: NonNullable<ProjectRow['brief']>) {
  const fields = omit(brief, ['id', 'projectId', 'updatedAt']);
  return { ...fields, audience: fields.audience ?? '', tone: fields.tone ?? '' };
}

/** Projet avec l'avancement du parcours (§2.1) et l'aperçu de son logo. */
export function toProjectDto(project: ProjectRow, userId: string) {
  const { brief, chosenName, logos, website, _count, ...rest } = project;
  return {
    ...rest,
    brief: brief && toBriefDto(brief),
    chosenName: chosenName && toNameDto(chosenName, userId),
    progress: {
      brief: !!brief,
      name: !!chosenName,
      logo: _count.logos > 0,
      signatures: _count.signatures > 0 || _count.slogans > 0,
      kit: _count.brandKits > 0,
      site: !!website?.published,
    },
    previewSpec: logos[0]?.versions[0]?.spec ?? null,
  };
}
