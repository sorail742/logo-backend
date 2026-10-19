import { GoneException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { NameStyle, Prisma, ProjectStatus } from '@prisma/client';
import { cursorArgs, toPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ModerationService } from '../moderation/moderation.service';
import { activityLabel } from './project-activity';
import { PROJECT_INCLUDE, toProjectDto } from './project.presenter';
import { BriefDto, CreateProjectDto, ListProjectsDto, UpdateProjectDto } from './projects.dto';

/** Un projet supprimé reste récupérable 30 jours (PRJ-04). */
export const TRASH_RETENTION_DAYS = 30;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  async list(workspaceId: string, userId: string, q: ListProjectsDto) {
    const where: Prisma.ProjectWhereInput = {
      workspaceId,
      deletedAt: q.trash ? { not: null } : null,
      ...(q.type && { entityType: q.type }),
      ...(q.status && { status: q.status }),
      ...(q.q && { title: { contains: q.q, mode: 'insensitive' } }),
    };
    const rows = await this.prisma.project.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: PROJECT_INCLUDE,
      ...cursorArgs(q),
    });
    const page = toPage(rows, q.limit);
    return { ...page, items: page.items.map((p) => toProjectDto(p, userId)) };
  }

  async create(workspaceId: string, userId: string, { existingName, ...dto }: CreateProjectDto) {
    const name = existingName?.trim();
    if (!name) {
      const project = await this.prisma.project.create({ data: { workspaceId, ...dto }, include: PROJECT_INCLUDE });
      return toProjectDto(project, userId);
    }

    // Parcours « J'ai déjà un nom » (§2.2) : le nom saisi devient le nom retenu.
    const blocked = await this.moderation.findBlocked(name, 'NAME');
    if (blocked.length) {
      throw new UnprocessableEntityException({ message: 'Ce nom contient un terme non autorisé', terms: blocked });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { workspaceId, ...dto, status: ProjectStatus.IN_PROGRESS },
      });
      const suggestion = await tx.nameSuggestion.create({
        data: {
          projectId: project.id,
          value: name,
          meaning: 'Nom saisi par l’utilisateur',
          style: NameStyle.PROPER,
          isFavorite: true,
        },
      });
      await tx.project.update({ where: { id: project.id }, data: { chosenNameId: suggestion.id } });
      return project.id;
    });
    return this.get(id, userId);
  }

  async get(projectId: string, userId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: PROJECT_INCLUDE,
    });
    return toProjectDto(project, userId);
  }

  async update(projectId: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: dto,
      include: PROJECT_INCLUDE,
    });
    return toProjectDto(project, userId);
  }

  softDelete(projectId: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  async restore(projectId: string, userId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (project.deletedAt) {
      const limit = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
      if (project.deletedAt.getTime() < limit) throw new GoneException('Projet définitivement supprimé');
      await this.prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } });
    }
    return this.get(projectId, userId);
  }

  /** Duplique le projet et son brief (les contenus générés ne sont pas copiés). */
  async duplicate(projectId: string, userId: string) {
    const source = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { brief: true },
    });
    const { id: _id, projectId: _pid, updatedAt: _u, ...brief } = source.brief ?? ({} as never);
    const copy = await this.prisma.project.create({
      data: {
        workspaceId: source.workspaceId,
        entityType: source.entityType,
        title: `${source.title} (copie)`,
        status: ProjectStatus.DRAFT,
        ...(source.brief && { brief: { create: brief } }),
      },
      include: PROJECT_INCLUDE,
    });
    return toProjectDto(copy, userId);
  }

  /** Enregistre le brief et renvoie le projet à jour. */
  async upsertBrief(projectId: string, userId: string, dto: BriefDto) {
    await this.prisma.brief.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });
    await this.prisma.project.updateMany({
      where: { id: projectId, status: ProjectStatus.DRAFT },
      data: { status: ProjectStatus.IN_PROGRESS },
    });
    return this.get(projectId, userId);
  }

  /** Historique d'activité du projet (COL-04) : qui a fait quoi, quand. */
  async activity(projectId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: 'Project', entityId: projectId },
      include: { actor: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      actor: row.actor?.fullName ?? 'Système',
      action: activityLabel(row.action, row.after),
      code: row.action,
      createdAt: row.createdAt,
    }));
  }

  /** Purge des projets restés plus de 30 jours dans la corbeille (tâche de maintenance). */
  purgeTrash() {
    return this.prisma.project.deleteMany({
      where: { deletedAt: { lt: new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000) } },
    });
  }
}
