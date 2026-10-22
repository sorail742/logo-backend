import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PlatformRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken, sha256 } from '../../common/utils/crypto.util';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  userId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Jetons d'accès JWT (15 min) et jetons de rafraîchissement opaques (30 j) avec rotation
 * et détection de réutilisation (§14.1).
 *
 * Le jeton de rafraîchissement a la forme `<aléa>.<mfa>` ; seule son empreinte est stockée,
 * donc l'indicateur mfa ne peut pas être modifié par le client.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(
    user: { id: string; role: PlatformRole },
    mfa: boolean,
    meta: SessionMeta,
  ): Promise<IssuedSession> {
    const refreshToken = `${randomToken(32)}.${mfa ? 1 : 0}`;
    const days = this.config.getOrThrow<number>('REFRESH_TOKEN_TTL_DAYS');
    const refreshExpiresAt = new Date(Date.now() + days * 86_400_000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 255),
      },
    });

    const accessToken = await this.jwt.signAsync({ sub: user.id, role: user.role, mfa });
    return { userId: user.id, accessToken, refreshToken, refreshExpiresAt };
  }

  async rotate(refreshToken: string, meta: SessionMeta): Promise<IssuedSession> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { id: true, role: true, suspendedAt: true, deletedAt: true } } },
    });
    if (!stored) throw new UnauthorizedException('Session invalide');

    if (stored.revokedAt) {
      // Réutilisation d'un jeton déjà tourné : vol probable, toutes les sessions sont révoquées.
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException('Session révoquée, reconnectez-vous');
    }
    if (stored.expiresAt < new Date() || stored.user.suspendedAt || stored.user.deletedAt) {
      throw new UnauthorizedException('Session expirée');
    }

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new UnauthorizedException('Session invalide');

    const mfa = refreshToken.endsWith('.1');
    return this.issue(stored.user, mfa, meta);
  }

  async revoke(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
