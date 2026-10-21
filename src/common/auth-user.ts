import { PlatformRole, WorkspaceRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: PlatformRole;
  /** Vrai si la session a été ouverte avec un code TOTP. */
  mfa: boolean;
}

export interface WorkspaceContext {
  workspaceId: string;
  /** Rôle de l'utilisateur dans l'espace ; null pour un accès plateforme (support, admin). */
  role: WorkspaceRole | null;
  projectId?: string;
  /** Téléchargement des fichiers et exports : Éditeur et Propriétaire, Lecteur si l'espace l'autorise. */
  canDownload: boolean;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
    workspace?: WorkspaceContext;
  }
}

export const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  USER: 0,
  SUPPORT: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};
