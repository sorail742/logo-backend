import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  JobKind,
  LedgerReason,
  PaymentStatus,
  PlatformRole,
  Prisma,
  SignatureKind,
  SignatureStatus,
  WorkspaceRole,
} from '@prisma/client';
import { AuthUser, PLATFORM_ROLE_RANK } from '../../common/auth-user';
import { cursorArgs, toPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { renderStampSvg, stampDataSchema } from '../../render/stamp';
import { AuditService } from '../audit/audit.service';
import { SessionService } from '../auth/session.service';
import { CreditsService } from '../credits/credits.service';
import { ModerationService } from '../moderation/moderation.service';
import { stampReviewTerms, stampTerms } from '../signatures/signature-data';
import {
  AdjustCreditsDto,
  AdminListUsersDto,
  AdminUpdateUserDto,
  AuditQueryDto,
  BlockedTermDto,
  CreditRequestDecisionDto,
  ListCreditRequestsDto,
  ReviewSignatureDto,
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

/** Ligne de la liste des utilisateurs du back-office (type AdminUser du front). */
const ADMIN_USER_SELECT = {
  ...USER_SELECT,
  totpSecret: true,
  _count: { select: { memberships: true } },
} satisfies Prisma.UserSelect;

function toAdminUser({
  totpSecret,
  _count,
  ...user
}: Prisma.UserGetPayload<{ select: typeof ADMIN_USER_SELECT }>) {
  return { ...user, totpEnabled: !!totpSecret, workspaces: _count.memberships };
}

/** Période des indicateurs du tableau de bord (§9, ADM-01). */
const STATS_DAYS = 14;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly credits: CreditsService,
    private readonly sessions: SessionService,
    private readonly moderation: ModerationService,
    private readonly storage: StorageService,
  ) {}

  /** ADM-01 : indicateurs des 14 derniers jours (type AdminStats du front). */
  async stats() {
    const since = new Date(Date.now() - STATS_DAYS * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const [users, signups, activeUsers, projects, jobsByKind, aiCost, revenue, workspaces, paying, jobsDaily, revenueDaily] =
      await Promise.all([
        this.prisma.user.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { createdAt: { gte: since } } }),
        // Actif : au moins une session ouverte ou renouvelée sur la période.
        this.prisma.user.count({ where: { refreshTokens: { some: { createdAt: { gte: since } } } } }),
        this.prisma.project.count({ where: { deletedAt: null } }),
        this.prisma.generationJob.groupBy({ by: ['kind'], where: { createdAt: { gte: since } }, _count: true }),
        this.prisma.generationJob.aggregate({ where: { createdAt: { gte: since } }, _sum: { costUsdMicros: true } }),
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.SUCCEEDED, createdAt: { gte: since } },
          _sum: { amountGnf: true },
        }),
        this.prisma.workspace.count(),
        this.prisma.payment.groupBy({ by: ['workspaceId'], where: { status: PaymentStatus.SUCCEEDED } }),
        this.prisma.$queryRaw<{ day: Date; generations: bigint; cost: bigint | null }[]>`
          SELECT date_trunc('day', "createdAt") AS day, count(*) AS generations, sum("costUsdMicros") AS cost
          FROM "GenerationJob" WHERE "createdAt" >= ${since} GROUP BY 1`,
        this.prisma.$queryRaw<{ day: Date; amount: bigint | null }[]>`
          SELECT date_trunc('day', "createdAt") AS day, sum("amountGnf") AS amount
          FROM "Payment" WHERE status = 'SUCCEEDED' AND "createdAt" >= ${since} GROUP BY 1`,
      ]);

    const generations = Object.fromEntries(Object.values(JobKind).map((kind) => [kind, 0])) as Record<JobKind, number>;
    for (const g of jobsByKind) generations[g.kind] = g._count;

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const jobsByDay = new Map(jobsDaily.map((r) => [key(r.day), r]));
    const revenueByDay = new Map(revenueDaily.map((r) => [key(r.day), Number(r.amount ?? 0)]));
    const daily = Array.from({ length: STATS_DAYS + 1 }, (_, i) => {
      const date = key(new Date(since.getTime() + i * 86_400_000));
      const jobs = jobsByDay.get(date);
      return {
        date,
        revenueGnf: revenueByDay.get(date) ?? 0,
        aiCostUsd: Number(jobs?.cost ?? 0) / 1_000_000,
        generations: Number(jobs?.generations ?? 0),
      };
    });

    return {
      period: { from: since, to: new Date() },
      users,
      projects,
      signups,
      activeUsers,
      generations,
      // Part des espaces ayant déjà payé (§9) ; nulle tant que les paiements ne sont pas ouverts.
      conversionRate: workspaces ? paying.length / workspaces : 0,
      revenueGnf: Number(revenue._sum.amountGnf ?? 0),
      aiCostUsd: (aiCost._sum.costUsdMicros ?? 0) / 1_000_000,
      daily,
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
      select: ADMIN_USER_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    const page = toPage(rows, q.limit);
    return { ...page, items: page.items.map(toAdminUser) };
  }

  async getUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...USER_SELECT,
        memberships: { select: { role: true, workspace: { select: { id: true, name: true, creditBalance: true } } } },
      },
    });
  }

  async updateUser(actor: AuthUser, userId: string, dto: AdminUpdateUserDto, ip: string) {
    if (dto.role !== undefined && actor.role !== PlatformRole.SUPER_ADMIN) {
      throw new ForbiddenException('Seul un super admin peut changer un rôle plateforme');
    }
    if (userId === actor.id && (dto.suspended || dto.role !== undefined)) {
      throw new ForbiddenException('Action impossible sur votre propre compte');
    }

    const before = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    // Hiérarchie : on n'agit que sur un rôle inférieur au sien (le super admin agit sur tous).
    if (
      userId !== actor.id &&
      actor.role !== PlatformRole.SUPER_ADMIN &&
      PLATFORM_ROLE_RANK[before.role] >= PLATFORM_ROLE_RANK[actor.role]
    ) {
      throw new ForbiddenException('Action impossible sur un compte de rang égal ou supérieur');
    }
    const data: Prisma.UserUpdateInput = {};
    if (dto.suspended !== undefined) data.suspendedAt = dto.suspended ? new Date() : null;
    if (dto.resetTwoFactor) {
      data.totpSecret = null;
      data.totpBackupCodes = [];
    }
    if (dto.role !== undefined) data.role = dto.role;

    const after = await this.prisma.user.update({ where: { id: userId }, data, select: USER_SELECT });
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
    return toAdminUser(
      await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: ADMIN_USER_SELECT }),
    );
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

  // ─── Ajustements proposés par le support (§3 : « avec validation ») ───

  async requestCreditAdjustment(actor: AuthUser, dto: AdjustCreditsDto, ip: string) {
    await this.prisma.workspace.findUniqueOrThrow({ where: { id: dto.workspaceId }, select: { id: true } });
    const request = await this.prisma.creditAdjustmentRequest.create({
      data: { workspaceId: dto.workspaceId, delta: dto.delta, reason: dto.reason, requestedById: actor.id },
    });
    await this.audit.log({
      actorId: actor.id,
      action: 'credits.request',
      entityType: 'Workspace',
      entityId: dto.workspaceId,
      after: { requestId: request.id, delta: dto.delta, reason: dto.reason },
      ip,
    });
    return this.presentCreditRequest(request.id);
  }

  async creditRequests(q: ListCreditRequestsDto) {
    const rows = await this.prisma.creditAdjustmentRequest.findMany({
      where: { ...(q.status && { status: q.status }) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.presentCreditRequest(r.id)));
  }

  /** Décision d'un admin, distinct du demandeur (double regard) ; une demande ne se décide qu'une fois. */
  async decideCreditRequest(actor: AuthUser, id: string, dto: CreditRequestDecisionDto, ip: string) {
    const request = await this.prisma.creditAdjustmentRequest.findUniqueOrThrow({ where: { id } });
    if (request.status !== 'PENDING') throw new ConflictException('Cette demande a déjà été traitée');
    if (request.requestedById === actor.id) {
      throw new ForbiddenException('Une demande est validée par un autre administrateur que son auteur');
    }
    if (dto.approve) {
      await this.adjustCredits(
        actor,
        { workspaceId: request.workspaceId, delta: request.delta, reason: `Demande du support validée : ${request.reason}` },
        ip,
      );
    }
    await this.prisma.creditAdjustmentRequest.update({
      where: { id },
      data: {
        status: dto.approve ? 'APPROVED' : 'REJECTED',
        decidedById: actor.id,
        decisionNote: dto.note,
        decidedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId: actor.id,
      action: dto.approve ? 'credits.request.approve' : 'credits.request.reject',
      entityType: 'Workspace',
      entityId: request.workspaceId,
      after: { requestId: id, delta: request.delta, note: dto.note },
      ip,
    });
    return this.presentCreditRequest(id);
  }

  private async presentCreditRequest(id: string) {
    const r = await this.prisma.creditAdjustmentRequest.findUniqueOrThrow({
      where: { id },
      include: { workspace: { select: { name: true } } },
    });
    const people = await this.prisma.user.findMany({
      where: { id: { in: [r.requestedById, r.decidedById].filter((x): x is string => !!x) } },
      select: { id: true, fullName: true },
    });
    const nameOf = (uid: string | null) => people.find((p) => p.id === uid)?.fullName ?? null;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      workspaceName: r.workspace.name,
      delta: r.delta,
      reason: r.reason,
      status: r.status,
      requestedBy: nameOf(r.requestedById),
      decidedBy: nameOf(r.decidedById),
      decisionNote: r.decisionNote,
      decidedAt: r.decidedAt,
      createdAt: r.createdAt,
    };
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
    const page = toPage(rows, q.limit);
    // Type AuditEntry du front : nom de l'auteur à plat, détails avant / après conservés.
    return { ...page, items: page.items.map((row) => ({ ...row, actorName: row.actor?.fullName ?? 'Système' })) };
  }

  // ─── Liste noire (ADM-12) ───

  blockedTerms() {
    return this.prisma.blockedTerm.findMany({ orderBy: [{ scope: 'asc' }, { term: 'asc' }] });
  }

  async addBlockedTerm(actor: AuthUser, dto: BlockedTermDto, ip: string) {
    const term = await this.prisma.blockedTerm.create({ data: dto });
    this.moderation.invalidate();
    await this.audit.log({ actorId: actor.id, action: 'blocked-term.create', entityType: 'BlockedTerm', entityId: term.id, after: term, ip });
    return term;
  }

  async removeBlockedTerm(actor: AuthUser, id: string, ip: string) {
    const term = await this.prisma.blockedTerm.delete({ where: { id } });
    this.moderation.invalidate();
    await this.audit.log({ actorId: actor.id, action: 'blocked-term.delete', entityType: 'BlockedTerm', entityId: id, before: term, ip });
  }

  // ─── Modération des cachets (§6.4) ───

  /** File de modération (type ModerationItem du front) : cachets en attente, du plus ancien. */
  async moderationQueue() {
    const pending = await this.prisma.signature.findMany({
      where: { kind: SignatureKind.STAMP, status: SignatureStatus.PENDING_REVIEW },
      include: { project: { select: { workspace: { select: { name: true } } } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return Promise.all(
      pending.map(async (signature) => {
        const stamp = stampDataSchema.parse(signature.data);
        const blocked = await this.moderation.findBlocked(stampTerms(stamp).join(' '), 'STAMP');
        const terms = stampReviewTerms(stamp, blocked);
        return {
          id: signature.id,
          kind: 'STAMP' as const,
          title: stamp.ringText,
          reason: terms.length ? `Termes officiels : ${terms.join(', ')}` : 'Validation manuelle demandée',
          workspaceName: signature.project.workspace.name,
          createdAt: signature.createdAt,
          // Le fichier rendu (logo compris) quand il existe, sinon un rendu à la volée.
          previewSvg: signature.fileKey
            ? (await this.storage.get(signature.fileKey).catch(() => null))?.toString('utf8') ??
              renderStampSvg(stamp)
            : renderStampSvg(stamp),
        };
      }),
    );
  }

  /** Validation ou refus d'un cachet, tracé et notifié aux propriétaires de l'espace. */
  async reviewSignature(actor: AuthUser, signatureId: string, dto: ReviewSignatureDto, ip: string) {
    const signature = await this.prisma.signature.findUniqueOrThrow({
      where: { id: signatureId },
      include: { project: { select: { id: true, workspaceId: true } } },
    });
    if (signature.status !== SignatureStatus.PENDING_REVIEW) {
      throw new ConflictException('Cette signature n’est pas en attente de validation');
    }
    const status = dto.decision === 'APPROVE' ? SignatureStatus.ACTIVE : SignatureStatus.REJECTED;
    const owners = await this.prisma.membership.findMany({
      where: { workspaceId: signature.project.workspaceId, role: WorkspaceRole.OWNER },
      select: { userId: true },
    });
    const approved = status === SignatureStatus.ACTIVE;
    await this.prisma.$transaction(async (tx) => {
      await tx.signature.update({ where: { id: signatureId }, data: { status } });
      await tx.notification.createMany({
        data: owners.map(({ userId }) => ({
          userId,
          type: approved ? 'signature.approved' : 'signature.rejected',
          payload: {
            title: approved ? 'Cachet validé' : 'Cachet refusé',
            body: approved
              ? 'Votre cachet a été validé : vous pouvez le télécharger.'
              : `Votre cachet a été refusé.${dto.note ? ` Motif : ${dto.note}` : ''}`,
            href: `/app/projets/${signature.project.id}/signatures?onglet=stamp`,
          },
        })),
      });
      await this.audit.log(
        {
          actorId: actor.id,
          action: approved ? 'signature.approve' : 'signature.reject',
          entityType: 'Signature',
          entityId: signatureId,
          before: { status: signature.status },
          after: { status, note: dto.note ?? null },
          ip,
        },
        tx,
      );
    });
  }
}
