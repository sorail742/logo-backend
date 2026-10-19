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
import { MailService } from '../mail/mail.service';
import { CreateInvitationDto, CreateWorkspaceDto, UpdateWorkspaceDto } from './workspaces.dto';

const INVITATION_TTL_DAYS = 7;
/** Invitation par lien : pas d'adresse cible, réutilisable jusqu'à expiration. */
const LINK_INVITATION_EMAIL = '*';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  list(userId: string) {
    return this.prisma.workspace.findMany({
      where: { members: { some: { userId } } },
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        creditBalance: true,
        members: { where: { userId }, select: { role: true } },
        _count: { select: { projects: { where: { deletedAt: null } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  create(userId: string, dto: CreateWorkspaceDto) {
    return this.prisma.workspace.create({
      data: {
        name: dto.name,
        slug: uniqueSlug(dto.name),
        kind: WorkspaceKind.ORGANIZATION,
        members: { create: { userId, role: WorkspaceRole.OWNER } },
      },
    });
  }

  async get(workspaceId: string) {
    return this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      include: { subscription: { include: { plan: true } } },
    });
  }

  update(workspaceId: string, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({ where: { id: workspaceId }, data: dto });
  }

  members(workspaceId: string) {
    return this.prisma.membership.findMany({
      where: { workspaceId },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, fullName: true, email: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateMember(workspaceId: string, userId: string, role: WorkspaceRole) {
    const member = await this.findMember(workspaceId, userId);
    if (member.role === WorkspaceRole.OWNER && role !== WorkspaceRole.OWNER) {
      await this.assertAnotherOwner(workspaceId);
    }
    return this.prisma.membership.update({ where: { id: member.id }, data: { role } });
  }

  async removeMember(workspaceId: string, userId: string) {
    const member = await this.findMember(workspaceId, userId);
    if (member.role === WorkspaceRole.OWNER) await this.assertAnotherOwner(workspaceId);
    await this.prisma.membership.delete({ where: { id: member.id } });
  }

  // ─── Invitations (COL-01) ───

  async invite(workspaceId: string, dto: CreateInvitationDto) {
    const ws = await this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    if (ws.kind === WorkspaceKind.PERSONAL) {
      throw new BadRequestException('Créez un espace d’organisation pour inviter des membres');
    }
    await this.assertSeatAvailable(workspaceId);

    const token = randomToken(24);
    const email = dto.email?.toLowerCase() ?? LINK_INVITATION_EMAIL;
    const invitation = await this.prisma.invitation.create({
      data: {
        workspaceId,
        email,
        role: dto.role,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
      },
    });
    if (dto.email) await this.mail.sendInvitation(dto.email, ws.name, token);

    return { id: invitation.id, role: invitation.role, expiresAt: invitation.expiresAt, token };
  }

  async accept(token: string, user: { id: string }) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: { select: { id: true, name: true } } },
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
    if (existing) return { workspace: invitation.workspace, role: existing.role };

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
    return { workspace: invitation.workspace, role: invitation.role };
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
