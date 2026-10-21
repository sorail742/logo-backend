import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { PlatformRole, type WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';
import { AuthUser, WorkspaceContext } from '../auth-user';

export const IS_PUBLIC = 'isPublic';
/** Route accessible sans jeton d'accès. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'platformRole';
/** Rôle plateforme minimal (USER < SUPPORT < ADMIN < SUPER_ADMIN). */
export const Roles = (minRole: PlatformRole) => SetMetadata(ROLES, minRole);

export const WORKSPACE_ACCESS = 'workspaceAccess';
export interface WorkspaceAccessOptions {
  /** Rôle minimal dans l'espace (VIEWER < EDITOR < OWNER). */
  role: WorkspaceRole;
  /** Rôle plateforme minimal autorisé à passer outre l'appartenance à l'espace. */
  staff?: PlatformRole;
  /** Autoriser l'accès à un projet dans la corbeille (restauration). */
  includeDeleted?: boolean;
  /** Téléchargement : un Lecteur passe aussi si l'espace autorise les téléchargements (§3). */
  download?: boolean;
}
export const WorkspaceAccess = (
  role: WorkspaceRole,
  opts: Omit<WorkspaceAccessOptions, 'role'> = {},
) =>
  SetMetadata(WORKSPACE_ACCESS, {
    role,
    // Par défaut, le support a accès en lecture (§3) ; `staff: undefined` explicite le retire.
    staff: 'staff' in opts ? opts.staff : role === 'VIEWER' ? PlatformRole.SUPPORT : undefined,
    includeDeleted: opts.includeDeleted,
    download: opts.download,
  } satisfies WorkspaceAccessOptions);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest<Request>().user!,
);

export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceContext =>
    ctx.switchToHttp().getRequest<Request>().workspace!,
);

/** Adresse IP du client (derrière proxy : app.set('trust proxy')). */
export const ClientIp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<Request>().ip ?? '',
);
