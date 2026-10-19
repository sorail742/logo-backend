import type { Prisma, WorkspaceRole } from '@prisma/client';
import { activePlanCode } from '../billing/plan-features';

/** Champs d'un espace vu par un membre (type Workspace du front). */
export const workspaceSelect = (userId: string) =>
  ({
    id: true,
    name: true,
    slug: true,
    kind: true,
    creditBalance: true,
    members: { where: { userId }, select: { role: true } },
    subscription: { select: { status: true, currentPeriodEnd: true, plan: { select: { code: true } } } },
  }) satisfies Prisma.WorkspaceSelect;

type WorkspaceRow = Prisma.WorkspaceGetPayload<{ select: ReturnType<typeof workspaceSelect> }>;

export function toWorkspaceDto({ members, subscription, ...ws }: WorkspaceRow, role?: WorkspaceRole | null) {
  return {
    ...ws,
    role: role ?? members[0]?.role ?? null,
    planCode: activePlanCode(subscription),
    renewsAt: subscription?.currentPeriodEnd ?? null,
  };
}

/** Invitation en attente ; une invitation par lien n'a pas d'adresse cible. */
export function toInvitationDto(
  invitation: { id: string; email: string; role: WorkspaceRole; expiresAt: Date },
  token?: string,
) {
  const isLink = invitation.email === LINK_INVITATION_EMAIL;
  return {
    id: invitation.id,
    email: isLink ? '' : invitation.email,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    isLink,
    // Le jeton n'est connu qu'à la création : le lien n'est donné qu'à ce moment-là.
    ...(token && { link: `/invitation/${token}`, token }),
  };
}

/** Invitation par lien : pas d'adresse cible, réutilisable jusqu'à expiration. */
export const LINK_INVITATION_EMAIL = '*';
