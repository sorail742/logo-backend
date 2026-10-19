import { ConflictException, Injectable } from '@nestjs/common';
import { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import type { UpdateMeDto } from './users.controller';

const PROFILE_SELECT = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  avatarUrl: true,
  locale: true,
  country: true,
  role: true,
  emailVerifiedAt: true,
  totpSecret: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async profile(userId: string) {
    const { totpSecret, ...user } = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: PROFILE_SELECT,
    });
    const workspaces = await this.prisma.membership.findMany({
      where: { userId },
      select: {
        role: true,
        workspace: { select: { id: true, name: true, slug: true, kind: true } },
      },
    });
    return { ...user, twoFactorEnabled: !!totpSecret, workspaces };
  }

  async update(userId: string, dto: UpdateMeDto) {
    await this.prisma.user.update({ where: { id: userId }, data: dto });
    return this.profile(userId);
  }

  /**
   * Suppression logique ; la purge définitive intervient après 30 jours (§14.3).
   * Refusée si l'utilisateur est seul propriétaire d'un espace d'organisation avec d'autres membres.
   */
  async softDelete(userId: string) {
    const owned = await this.prisma.membership.findMany({
      where: { userId, role: WorkspaceRole.OWNER, workspace: { kind: 'ORGANIZATION' } },
      select: { workspaceId: true },
    });
    for (const { workspaceId } of owned) {
      const [owners, members] = await Promise.all([
        this.prisma.membership.count({ where: { workspaceId, role: WorkspaceRole.OWNER } }),
        this.prisma.membership.count({ where: { workspaceId } }),
      ]);
      if (owners === 1 && members > 1) {
        throw new ConflictException(
          'Transférez la propriété de vos espaces d’organisation avant de supprimer votre compte',
        );
      }
    }
    await this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await this.sessions.revokeAll(userId);
  }

  async exportData(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...PROFILE_SELECT,
        totpSecret: false,
        memberships: { include: { workspace: { select: { id: true, name: true } } } },
        comments: true,
        notifications: true,
        oauthAccounts: { select: { provider: true } },
      },
    });
    return { exportedAt: new Date().toISOString(), user };
  }
}
