import { ForbiddenException, Injectable } from '@nestjs/common';
import { LedgerReason, PlatformRole, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/auth-user';
import { cursorArgs, toPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CreditsService } from '../credits/credits.service';
import { ModerationService } from '../moderation/moderation.service';
import {
  AdjustCreditsDto,
  AdminListUsersDto,
  AdminUpdateUserDto,
  AuditQueryDto,
  BlockedTermDto,
} from './admin.dto';

const USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  role: true,
  country: true,
  emailVerifiedAt: true,
  suspendedAt: true,
  deletedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credits: CreditsService,
    private readonly sessions: SessionService,
    private readonly moderation: ModerationService,
  ) {}

  /** ADM-01 (indicateurs de base ; revenus et coût IA arriveront avec les paiements). */
  async stats() {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [users, newUsers, projects, jobsByKind, aiCost] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.project.count({ where: { deletedAt: null } }),
      this.prisma.generationJob.groupBy({
        by: ['kind', 'status'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.generationJob.aggregate({
        where: { createdAt: { gte: since } },
        _sum: { costUsdMicros: true },
      }),
    ]);
    return {
      period: { from: since, to: new Date() },
      users,
      newUsers,
      projects,
      generations: jobsByKind.map((g) => ({ kind: g.kind, status: g.status, count: g._count })),
      aiCostUsd: (aiCost._sum.costUsdMicros ?? 0) / 1_000_000,
    };
  }

  async listUsers(q: AdminListUsersDto) {
    const rows = await this.prisma.user.findMany({
      where: {
        ...(q.role && { role: q.role }),
        ...(q.suspended !== undefined && { suspendedAt: q.suspended ? { not: null } : null }),
        ...(q.q && {
          OR: [
            { email: { contains: q.q, mode: 'insensitive' } },
            { phone: { contains: q.q } },
            { fullName: { contains: q.q, mode: 'insensitive' } },
          ],
        }),
      },
      select: USER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    return toPage(rows, q.limit);
  }

  async getUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...USER_SELECT,
        memberships: {
          select: {
            role: true,
            workspace: { select: { id: true, name: true, creditBalance: true } },
          },
        },
      },
    });
  }

  async updateUser(actor: AuthUser, userId: string, dto: AdminUpdateUserDto, ip: string) {
    if (dto.role !== undefined && actor.role !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Seul un super admin peut changer un rôle plateforme');
    }
    if ((dto.resetTwoFactor || dto.role !== undefined) && actor.role === PlatformRole.SUPPORT) {
      throw new ForbiddenException('Action réservée aux administrateurs');
    }
    if (userId === actor.id && (dto.suspended || dto.role !== undefined)) {
      throw new ForbiddenException('Action impossible sur votre propre compte');
    }

    const before = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: USER_SELECT,
    });
    const data: Prisma.UserUpdateInput = {};
    if (dto.suspended !== undefined) data.suspendedAt = dto.suspended ? new Date() : null;
    if (dto.resetTwoFactor) data.totpSecret = null;
    if (dto.role !== undefined) data.role = dto.role;

    const after = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: USER_SELECT,
    });
    if (dto.suspended || dto.resetTwoFactor) await this.sessions.revokeAll(userId);

    await this.audit.log({
      actorId: actor.id,
      action: 'user.update',
      entityType: 'User',
      entityId: userId,
      before,
      after: { ...after, resetTwoFactor: dto.resetTwoFactor ?? false },
      ip,
    });
    return after;
  }

  /** ADM-06 : ajustement manuel avec motif obligatoire, tracé. */
  async adjustCredits(actor: AuthUser, dto: AdjustCreditsDto, ip: string) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.workspace.findUniqueOrThrow({
        where: { id: dto.workspaceId },
        select: { creditBalance: true },
      });
      await this.credits.adjust(tx, {
        workspaceId: dto.workspaceId,
        delta: dto.delta,
        reason: LedgerReason.ADMIN_ADJUSTMENT,
        actorId: actor.id,
        note: dto.reason,
      });
      const after = await tx.workspace.findUniqueOrThrow({
        where: { id: dto.workspaceId },
        select: { creditBalance: true },
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: 'credits.adjust',
          entityType: 'Workspace',
          entityId: dto.workspaceId,
          before,
          after: { ...after, delta: dto.delta, reason: dto.reason },
          ip,
        },
        tx,
      );
      return after;
    });
  }

  async auditLogs(q: AuditQueryDto) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        ...(q.action && { action: q.action }),
        ...(q.entityType && { entityType: q.entityType }),
        ...(q.entityId && { entityId: q.entityId }),
      },
      include: { actor: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    return toPage(rows, q.limit);
  }

  // ─── Liste noire (ADM-12) ───

  blockedTerms() {
    return this.prisma.blockedTerm.findMany({ orderBy: [{ scope: 'asc' }, { term: 'asc' }] });
  }

  async addBlockedTerm(actor: AuthUser, dto: BlockedTermDto, ip: string) {
    const term = await this.prisma.blockedTerm.create({ data: dto });
    this.moderation.invalidate();
    await this.audit.log({
      actorId: actor.id,
      action: 'blocked-term.create',
      entityType: 'BlockedTerm',
      entityId: term.id,
      after: term,
      ip,
    });
    return term;
  }

  async removeBlockedTerm(actor: AuthUser, id: string, ip: string) {
    const term = await this.prisma.blockedTerm.delete({ where: { id } });
    this.moderation.invalidate();
    await this.audit.log({
      actorId: actor.id,
      action: 'blocked-term.delete',
      entityType: 'BlockedTerm',
      entityId: id,
      before: term,
      ip,
    });
  }
}
