import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformRole } from '@prisma/client';
import type { Request } from 'express';
import { PLATFORM_ROLE_RANK } from '../auth-user';
import { ROLES } from '../decorators';

/** Vérifie le rôle plateforme (§3). Les rôles internes exigent une session ouverte avec TOTP. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const minRole = this.reflector.getAllAndOverride<PlatformRole | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!minRole) return true;

    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user || PLATFORM_ROLE_RANK[user.role] < PLATFORM_ROLE_RANK[minRole]) {
      throw new ForbiddenException('Droits insuffisants');
    }
    if (PLATFORM_ROLE_RANK[minRole] > 0 && !user.mfa) {
      throw new ForbiddenException('Double authentification requise pour le back-office');
    }
    return true;
  }
}
