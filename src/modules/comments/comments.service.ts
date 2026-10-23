import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, WorkspaceRole, type Comment } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CommentTarget,
  CreateCommentDto,
  ListCommentsDto,
  UpdateCommentDto,
} from './comments.dto';
import { resolveMentions, type Mentionable } from './mentions';
import { omit } from '../../common/utils/object.util';

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
  const { author } = comment;
  const rest = omit(comment, ['author', 'projectId']);
  return {
    ...rest,
    authorName: author.fullName,
    mentions: resolveMentions(comment.body, members).map((m) => ({
      userId: m.userId,
      fullName: m.fullName,
    })),
  };
}

interface Target {
  label: string;
  href: string;
  /** Pages d'une création du Studio (épingles). */
  pageIds?: string[];
}

/**
 * Commentaires sur un nom, un logo, une signature, un slogan, le kit, le projet (COL-02) ou une
 * création du Studio, épinglés sur la page, avec fil de réponses et résolution.
 */
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

    // Réponse : même élément, un seul niveau de fil ; l'épingle reste celle du fil.
    let threadId: string | null = null;
    if (dto.parentId) {
      const parent = await this.prisma.comment.findFirst({
        where: { id: dto.parentId, projectId: ctx.projectId },
      });
      if (
        !parent ||
        parent.parentId ||
        parent.targetType !== dto.targetType ||
        parent.targetId !== dto.targetId
      ) {
        throw new BadRequestException('Ce fil de discussion n’existe pas sur cet élément');
      }
      threadId = parent.id;
    }
    if (dto.anchor) {
      if (dto.targetType !== 'DESIGN' || threadId) {
        throw new BadRequestException('Une épingle ne se pose que sur une création du Studio');
      }
      if (!target.pageIds?.includes(dto.anchor.pageId)) {
        throw new BadRequestException('Cette page n’existe pas dans la création');
      }
    }

    const comment = await this.prisma.comment.create({
      data: {
        projectId: ctx.projectId,
        authorId: ctx.actorId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        body,
        parentId: threadId,
        anchor: dto.anchor
          ? ({ pageId: dto.anchor.pageId, x: dto.anchor.x, y: dto.anchor.y } as Prisma.InputJsonValue)
          : undefined,
      },
      include: { author: { select: { fullName: true } } },
    });
    // Une réponse rouvre un fil résolu.
    if (threadId) {
      await this.prisma.comment.updateMany({
        where: { id: threadId, resolvedAt: { not: null } },
        data: { resolvedAt: null, resolvedById: null },
      });
    }

    const members = await this.members(ctx.workspaceId);
    const mentioned = resolveMentions(body, members)
      .map((m) => m.userId)
      .filter((id) => id !== ctx.actorId);
    // Participants prévenus : ceux du fil pour une réponse, ceux de l'élément sinon.
    const participants = await this.prisma.comment.findMany({
      where: {
        projectId: ctx.projectId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        ...(threadId && { OR: [{ id: threadId }, { parentId: threadId }] }),
        authorId: { notIn: [ctx.actorId, ...mentioned] },
      },
      distinct: ['authorId'],
      select: { authorId: true },
    });
    const memberIds = new Set(members.map((m) => m.userId));
    const author = comment.author.fullName;
    const excerpt = body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH - 1)}…` : body;
    const href =
      dto.targetType === 'DESIGN' ? `${target.href}?commentaire=${threadId ?? comment.id}` : target.href;
    await this.notifications.notify(
      mentioned,
      {
        type: 'COMMENT',
        title: `${author} vous a mentionné`,
        body: `Sur ${target.label} : « ${excerpt} »`,
        href,
      },
      { email: true },
    );
    await this.notifications.notify(
      participants.map((p) => p.authorId).filter((id) => memberIds.has(id)),
      {
        type: 'COMMENT',
        title: threadId ? `${author} a répondu sur ${target.label}` : `${author} a commenté ${target.label}`,
        body: excerpt,
        href,
      },
    );
    return { comment: toCommentDto(comment, members), target: target.label };
  }

  /** Résout ou rouvre un fil : son auteur, un éditeur ou un propriétaire. */
  async resolve(
    commentId: string,
    userId: string,
    role: WorkspaceRole | null,
    workspaceId: string,
    dto: UpdateCommentDto,
  ) {
    const comment = await this.prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
    if (comment.parentId) throw new BadRequestException('Seul le premier message d’un fil se résout');
    if (comment.authorId !== userId && role !== WorkspaceRole.OWNER && role !== WorkspaceRole.EDITOR) {
      throw new ForbiddenException('Vous ne pouvez pas résoudre ce fil');
    }
    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: dto.resolved
        ? { resolvedAt: new Date(), resolvedById: userId }
        : { resolvedAt: null, resolvedById: null },
      include: { author: { select: { fullName: true } } },
    });
    return toCommentDto(updated, await this.members(workspaceId));
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
  private async target(projectId: string, type: CommentTarget, id: string): Promise<Target> {
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
      case 'DESIGN': {
        const design = await this.prisma.studioDesign.findFirst({
          where: { id, projectId },
          select: { name: true, doc: true },
        });
        if (!design) throw missing();
        const pages = (design.doc as { pages?: { id: string }[] }).pages ?? [];
        return {
          label: `la création « ${design.name} »`,
          href: `/studio/${id}`,
          pageIds: pages.map((p) => p.id),
        };
      }
    }
  }
}
