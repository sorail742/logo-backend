import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkspaceKind, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { randomToken, sha256 } from '../../common/utils/crypto.util';
import { uniqueSlug } from '../../common/utils/slug.util';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  LINK_INVITATION_EMAIL,
  toInvitationDto,
  toWorkspaceDto,
  workspaceSelect,
} from './workspace.presenter';
import {
  CreateInvitationDto,
  CreateWorkspaceDto,
  DeleteWorkspaceDto,
  UpdateWorkspaceDto,
} from './workspaces.dto';

const INVITATION_TTL_DAYS = 7;

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  OWNER: 'propriétaire',
  EDITOR: 'éditeur',
  VIEWER: 'lecteur',
};

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.workspace.findMany({
      where: { members: { some: { userId } }, deletedAt: null },
      select: {
        ...workspaceSelect(userId),
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...ws }) => ({
      ...toWorkspaceDto(ws),
      projectCount: _count.projects,
    }));
  }

  async create(userId: string, dto: CreateWorkspaceDto) {
    const ws = await this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug: uniqueSlug(dto.name),
        kind: WorkspaceKind.ORGANIZATION,
        members: { create: { userId, role: WorkspaceRole.OWNER } },
      },
      select: workspaceSelect(userId),
    });
    return toWorkspaceDto(ws);
  }

  /** Espace vu par un membre (type Workspace du front) ; rôle null pour le support ou un admin. */
  async get(workspaceId: string, userId: string, role: WorkspaceRole | null) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: workspaceSelect(userId),
    });
    return toWorkspaceDto(ws, role);
  }

  async update(workspaceId: string, userId: string, dto: UpdateWorkspaceDto) {
    const ws = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: dto,
      select: workspaceSelect(userId),
    });
    await this.audit.log({
      actorId: userId,
      action: 'workspace.update',
      entityType: 'Workspace',
      entityId: workspaceId,
      after: dto,
    });
    return toWorkspaceDto(ws);
  }

  /**
   * Suppression d'un espace d'organisation (§3 : propriétaire ou admin), confirmée par son nom.
   * L'espace disparaît, ses projets partent à la corbeille (purge à 30 jours) ; le grand livre,
   * les paiements et l'abonnement restent conservés.
   */
  async remove(workspaceId: string, actorId: string, dto: DeleteWorkspaceDto) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true, kind: true },
    });
    if (ws.kind === WorkspaceKind.PERSONAL) {
      throw new BadRequestException(
        'L’espace personnel disparaît avec le compte : supprimez votre compte depuis votre profil',
      );
    }
    if (dto.confirm.trim() !== ws.name) {
      throw new BadRequestException('Saisissez le nom exact de l’espace pour confirmer');
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.project.updateMany({ where: { workspaceId, deletedAt: null }, data: { deletedAt: now } }),
      this.prisma.invitation.deleteMany({ where: { workspaceId, acceptedAt: null } }),
      this.prisma.workspace.update({ where: { id: workspaceId }, data: { deletedAt: now } }),
    ]);
    await this.audit.log({
      actorId,
      action: 'workspace.delete',
      entityType: 'Workspace',
      entityId: workspaceId,
      before: { name: ws.name },
    });
  }

  /** Membres (type Member du front). */
  async members(workspaceId: string) {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ role, createdAt, user }) => ({
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role,
      joinedAt: createdAt,
    }));
  }

  /** Invitations en attente (ni acceptées ni expirées). */
  async invitations(workspaceId: string) {
    const rows = await this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    return rows.map((invitation) => toInvitationDto(invitation));
  }

  async updateMember(workspaceId: string, userId: string, role: WorkspaceRole, actorId: string) {
    const member = await this.findMember(workspaceId, userId);
    if (member.role === WorkspaceRole.OWNER && role !== WorkspaceRole.OWNER) {
      await this.assertAnotherOwner(workspaceId);
    }
    const updated = await this.prisma.membership.update({ where: { id: member.id }, data: { role } });
    await this.audit.log({
      actorId,
      action: 'workspace.member.update',
      entityType: 'Workspace',
      entityId: workspaceId,
      before: { userId, role: member.role },
      after: { userId, role },
    });
    return updated;
  }

  /**
   * Retrait d'un membre par un propriétaire, ou départ volontaire de n'importe quel membre.
   * L'espace garde toujours au moins un propriétaire.
   */
  async removeMember(
    workspaceId: string,
    userId: string,
    actor: { id: string; role: WorkspaceRole | null },
  ) {
    if (userId !== actor.id && actor.role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException('Seul un propriétaire peut retirer un autre membre');
    }
    const member = await this.findMember(workspaceId, userId);
    if (member.role === WorkspaceRole.OWNER) await this.assertAnotherOwner(workspaceId);
    await this.prisma.membership.delete({ where: { id: member.id } });
    await this.audit.log({
      actorId: actor.id,
      action: userId === actor.id ? 'workspace.member.leave' : 'workspace.member.remove',
      entityType: 'Workspace',
      entityId: workspaceId,
      before: { userId, role: member.role },
    });
  }

  // ─── Invitations (COL-01) ───

  async invite(workspaceId: string, dto: CreateInvitationDto) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (ws.kind === WorkspaceKind.PERSONAL) {
      throw new BadRequestException('Créez un espace d’organisation pour inviter des membres');
    }
    await this.assertSeatAvailable(workspaceId);

    const token = randomToken(24);
    const email = dto.asLink || !dto.email ? LINK_INVITATION_EMAIL : dto.email.toLowerCase();
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        email,
        role: dto.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    if (email !== LINK_INVITATION_EMAIL) {
      await this.mail.sendInvitation(email, ws.name, token);
      // Invité déjà inscrit : l'invitation apparaît aussi dans ses notifications (COL-03).
      const invitee = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
      if (invitee) {
        await this.notifications.notify([invitee.id], {
          type: 'INVITATION',
          title: `Invitation à rejoindre « ${ws.name} »`,
          body: `Vous êtes invité comme ${ROLE_LABELS[dto.role]}.`,
          href: `/invitation/${encodeURIComponent(token)}`,
        });
      }
    }

    return toInvitationDto(invitation, token);
  }

  async accept(token: string, user: { id: string }) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!invitation) throw new NotFoundException('Invitation introuvable');
    if (invitation.expiresAt < new Date()) throw new GoneException('Invitation expirée');

    const isLink = invitation.email === LINK_INVITATION_EMAIL;
    if (!isLink) {
      if (invitation.acceptedAt) throw new GoneException('Invitation déjà utilisée');
      const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      if (u.email?.toLowerCase() !== invitation.email) {
        throw new ForbiddenException('Cette invitation est destinée à une autre adresse');
      }
    }

    const existing = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: invitation.workspaceId } },
    });
    if (existing) return this.forMember(invitation.workspaceId, user.id);

    await this.assertSeatAvailable(invitation.workspaceId);
    await this.prisma.$transaction([
      this.prisma.membership.create({
        data: { userId: user.id, workspaceId: invitation.workspaceId, role: invitation.role },
      }),
      ...(isLink
        ? []
        : [
            this.prisma.invitation.update({
              where: { id: invitation.id },
              data: { acceptedAt: new Date() },
            }),
          ]),
    ]);
    return this.forMember(invitation.workspaceId, user.id);
  }

  private async forMember(workspaceId: string, userId: string) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: workspaceSelect(userId),
    });
    return toWorkspaceDto(ws);
  }

  // ─── Règles ───

  private async findMember(workspaceId: string, userId: string) {
    const member = await this.prisma.membership.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new NotFoundException('Membre introuvable');
    return member;
  }

  private async assertAnotherOwner(workspaceId: string) {
    const owners = await this.prisma.membership.count({
      where: { workspaceId, role: WorkspaceRole.OWNER },
    });
    if (owners <= 1) throw new ConflictException('L’espace doit garder au moins un propriétaire');
  }

  /** Nombre de membres limité par l'offre (§8.2). */
  private async assertSeatAvailable(workspaceId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { workspaceId },
      include: { plan: true },
    });
    const plan =
      sub && sub.status === 'ACTIVE'
        ? sub.plan
        : await this.prisma.plan.findUnique({ where: { code: 'FREE' } });
    const max = plan?.maxMembers ?? 1;
    const count = await this.prisma.membership.count({ where: { workspaceId } });
    if (count >= max) {
      throw new ForbiddenException(`Votre offre est limitée à ${max} membre(s)`);
    }
  }
}
