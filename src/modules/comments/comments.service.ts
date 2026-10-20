import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { WorkspaceRole, type Comment } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { CommentTarget, CreateCommentDto, ListCommentsDto } from './comments.dto';
import { resolveMentions, type Mentionable } from './mentions';

interface Ctx {
  projectId: string;
  workspaceId: string;
  actorId: string;
}

const MAX_COMMENTS = 200;
const EXCERPT_LENGTH = 140;

type CommentRow = Comment & { author: { fullName: string } };

/** Commentaire (type Comment du front), avec les membres mentionnés. */
function toCommentDto(comment: CommentRow, members: Mentionable[]) {
  const { author, projectId: _projectId, ...rest } = comment;
  return {
    ...rest,
    authorName: author.fullName,
    mentions: resolveMentions(comment.body, members).map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
    })),
  };
}

/** Commentaires sur un nom, un logo, une signature, un slogan, le kit ou le projet (COL-02). */
@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(projectId: string, workspaceId: string, q: ListCommentsDto) {
    const [rows, members] = await Promise.all([
      this.prisma.comment.findMany({
        where: {
          projectId,
          ...(q.targetType && { targetType: q.targetType }),
          ...(q.targetId && { targetId: q.targetId }),
        },
        include: { author: { select: { fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_COMMENTS,
      }),
      this.members(workspaceId),
    ]);
    return rows.map((row) => toCommentDto(row, members));
  }

  /**
   * Nouveau commentaire : les membres mentionnés sont prévenus dans l'application et par
   * e-mail, les autres participants de la discussion dans l'application (COL-03).
   */
  async create(ctx: Ctx, dto: CreateCommentDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Le commentaire est vide');
    const target = await this.target(ctx.projectId, dto.targetType, dto.targetId);

    const comment = await this.prisma.comment.create({
      data: {
        projectId: ctx.projectId,
        authorId: ctx.actorId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        body,
      },
      include: { author: { select: { fullName: true } } },
    });

    const members = await this.members(ctx.workspaceId);
    const mentioned = resolveMentions(body, members)
      .map((m) => m.userId)
      .filter((id) => id !== ctx.actorId);
    const participants = await this.prisma.comment.findMany({
      where: {
        projectId: ctx.projectId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        authorId: { notIn: [ctx.actorId, ...mentioned] },
      },
      distinct: ['authorId'],
      select: { authorId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    const author = comment.author.fullName;
    const excerpt = body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH - 1)}…` : body;
    await this.notifications.notify(
      mentioned,
      {
        type: 'COMMENT',
        title: `${author} vous a mentionné`,
        body: `Sur ${target.label} : « ${excerpt} »`,
        href: target.href,
      },
      { email: true },
    );
    await this.notifications.notify(
      participants.map((p) => p.authorId).filter((id) => memberIds.has(id)),
      {
        type: 'COMMENT',
        title: `${author} a commenté ${target.label}`,
        body: excerpt,
        href: target.href,
      },
    );
    return { comment: toCommentDto(comment, members), target: target.label };
  }

  /** Suppression par son auteur ou par un propriétaire de l'espace. */
  async remove(commentId: string, userId: string, role: WorkspaceRole | null) {
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    if (comment.authorId !== userId && role !== WorkspaceRole.OWNER) {
      throw new ForbiddenException(
        'Seul son auteur ou un propriétaire peut supprimer ce commentaire',
      );
    }
    await this.prisma.comment.delete({ where: { id: commentId } });
  }

  private async members(workspaceId: string): Promise<Mentionable[]> {
    const rows = await this.prisma.membership.findMany({
      where: { workspaceId, user: { deletedAt: null } },
      select: { user: { select: { id: true, fullName: true, email: true } } },
    });
    return rows.map(({ user }) => ({
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
    }));
  }

  /** Vérifie que l'élément commenté appartient au projet ; libellé et lien pour les notifications. */
  private async target(projectId: string, type: CommentTarget, id: string) {
    const base = `/app/projets/${projectId}`;
    const missing = () => new BadRequestException('Cet élément n’appartient pas au projet');
    switch (type) {
      case 'PROJECT':
        if (id !== projectId) throw missing();
        return { label: 'le projet', href: base };
      case 'NAME': {
        const name = await this.prisma.nameSuggestion.findFirst({ where: { id, projectId } });
        if (!name) throw missing();
        return { label: `le nom « ${name.value} »`, href: `${base}/noms` };
      }
      case 'LOGO': {
        if (!(await this.prisma.logo.count({ where: { id, projectId } }))) throw missing();
        return { label: 'un logo', href: `${base}/logos/${id}` };
      }
      case 'SIGNATURE': {
        if (!(await this.prisma.signature.count({ where: { id, projectId } }))) throw missing();
        return { label: 'une signature', href: `${base}/signatures` };
      }
      case 'SLOGAN': {
        const slogan = await this.prisma.slogan.findFirst({ where: { id, projectId } });
        if (!slogan) throw missing();
        return { label: `« ${slogan.text} »`, href: `${base}/signatures` };
      }
      case 'KIT': {
        const kit = await this.prisma.brandKit.findFirst({ where: { id, projectId } });
        if (!kit) throw missing();
        return { label: `le kit v${kit.version}`, href: `${base}/kit` };
      }
    }
  }
}
