import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC } from '../decorators';
import { PrismaService } from '../prisma/prisma.service';

interface AccessPayload {
  sub: string;
  mfa?: boolean;
}

/** Guard global : vérifie le jeton d'accès sauf sur les routes @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException('Jeton d’accès manquant');

    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton d’accès invalide ou expiré');
    }

    // Lecture fraîche du rôle et de l'état du compte : une suspension prend effet immédiatement.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, suspendedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) throw new UnauthorizedException('Compte introuvable');
    if (user.suspendedAt) throw new UnauthorizedException('Compte suspendu');

    req.user = { id: user.id, role: user.role, mfa: payload.mfa === true };
    return true;
  }
}
