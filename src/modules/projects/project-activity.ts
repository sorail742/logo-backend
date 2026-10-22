import type { Prisma } from '@prisma/client';
import type { AuditEntry } from '../audit/audit.service';

/** Valeur affichable d'un détail du journal (texte ou nombre), sinon chaîne vide. */
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const SIGNATURE_LABELS: Record<string, string> = {
  EMAIL: 'la signature e-mail',
  HANDWRITTEN: 'un paraphe',
  STAMP: 'un cachet',
};

const SLOGAN_BATCH: Record<string, string> = { DEVISE: 'devises', MISSION: 'phrases de mission' };

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
  'names.choose': (after) => `a retenu le nom « ${text(after.value)} »`,
  'logos.generate': () => 'a lancé un lot de logos',
  'logos.import': () => 'a importé un logo existant',
  'logos.version': (after) => `a enregistré la version ${text(after.number)} d'un logo`,
  'logos.export': () => 'a exporté un logo',
  'slogans.generate': (after) => `a lancé un lot de ${SLOGAN_BATCH[text(after.kind)] ?? 'slogans'}`,
  'slogans.choose': (after) => `a retenu « ${text(after.text)} »`,
  'signatures.create': (after) =>
    `a créé ${SIGNATURE_LABELS[text(after.kind)] ?? 'une signature'}`,
  'signatures.update': (after) =>
    `a modifié ${SIGNATURE_LABELS[text(after.kind)] ?? 'une signature'}`,
  'signatures.batch': (after) => `a lancé ${text(after.count)} signatures e-mail en lot`,
  'kits.create': (after) => `a assemblé le kit v${text(after.version)}`,
  'kits.restore': (after) =>
    `a restauré le kit v${text(after.from)} (nouvelle version v${text(after.version)})`,
  'kits.guide': () => 'a demandé la charte graphique PDF',
  'kits.zip': () => 'a demandé l’archive du kit',
  'kits.share': (after) =>
    after.enabled ? 'a activé le lien de partage du kit' : 'a désactivé le lien de partage du kit',
  'comments.create': (after) => `a commenté ${text(after.target) || 'le projet'}`,
  'studio.create': (after) => `a créé « ${text(after.name)} » dans le Studio`,
  'studio.export': (after) => `a exporté une création du Studio (${text(after.format).toUpperCase()})`,
  'studio.images': () => 'a généré des images dans le Studio',
} satisfies Record<string, (after: Record<string, unknown>) => string>;

export type ProjectAction = keyof typeof PROJECT_ACTIONS;

export function activityLabel(action: string, after: Prisma.JsonValue) {
  const label = PROJECT_ACTIONS[action as ProjectAction] as
    ((after: Record<string, unknown>) => string) | undefined;
  const data =
    after && typeof after === 'object' && !Array.isArray(after)
      ? (after as Record<string, unknown>)
      : {};
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
