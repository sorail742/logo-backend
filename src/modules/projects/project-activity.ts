import type { Prisma } from '@prisma/client';
import type { AuditEntry } from '../audit/audit.service';

const SIGNATURE_LABELS: Record<string, string> = {
  EMAIL: 'la signature e-mail',
  HANDWRITTEN: 'un paraphe',
  STAMP: 'un cachet',
};

/**
 * Actions d'un projet enregistrées dans le journal (entityType « Project ») et affichées dans
 * son historique (COL-04). Le libellé est calculé à la lecture.
 */
export const PROJECT_ACTIONS = {
  'project.create': () => 'a créé le projet',
  'project.brief': () => 'a enregistré le brief',
  'project.delete': () => 'a placé le projet dans la corbeille',
  'project.restore': () => 'a restauré le projet',
  'names.generate': () => 'a lancé un lot de noms',
  'names.choose': (after) => `a retenu le nom « ${String(after.value ?? '')} »`,
  'logos.generate': () => 'a lancé un lot de logos',
  'logos.import': () => 'a importé un logo existant',
  'logos.version': (after) => `a enregistré la version ${String(after.number ?? '')} d'un logo`,
  'logos.export': () => 'a exporté un logo',
  'slogans.generate': (after) =>
    after.kind === 'DEVISE'
      ? 'a lancé un lot de devises'
      : after.kind === 'MISSION'
        ? 'a lancé un lot de phrases de mission'
        : 'a lancé un lot de slogans',
  'slogans.choose': (after) => `a retenu « ${String(after.text ?? '')} »`,
  'signatures.create': (after) => `a créé ${SIGNATURE_LABELS[String(after.kind)] ?? 'une signature'}`,
  'signatures.update': (after) => `a modifié ${SIGNATURE_LABELS[String(after.kind)] ?? 'une signature'}`,
  'signatures.batch': (after) => `a lancé ${String(after.count ?? '')} signatures e-mail en lot`,
} satisfies Record<string, (after: Record<string, unknown>) => string>;

export type ProjectAction = keyof typeof PROJECT_ACTIONS;

export function activityLabel(action: string, after: Prisma.JsonValue) {
  const label = PROJECT_ACTIONS[action as ProjectAction] as
    | ((after: Record<string, unknown>) => string)
    | undefined;
  const data = after && typeof after === 'object' && !Array.isArray(after) ? (after as Record<string, unknown>) : {};
  return label ? label(data) : action;
}

/** Entrée du journal pour une action sur un projet. */
export function projectEvent(
  projectId: string,
  actorId: string,
  action: ProjectAction,
  after?: Record<string, unknown>,
  ip?: string,
): AuditEntry {
  return { actorId, action, entityType: 'Project', entityId: projectId, after, ip };
}
