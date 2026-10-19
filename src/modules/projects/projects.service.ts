import { GoneException, Injectable } from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';
import { cursorArgs, toPage } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BriefDto, CreateProjectDto, ListProjectsDto, UpdateProjectDto } from './projects.dto';

/** Un projet supprimé reste récupérable 30 jours (PRJ-04). */
export const TRASH_RETENTION_DAYS = 30;

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, q: ListProjectsDto) {
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
      include: { chosenName: { select: { value: true, acronym: true } } },
      ...cursorArgs(q),
    });
    return toPage(rows, q.limit);
  }

  create(workspaceId: string, dto: CreateProjectDto) {
    return this.prisma.project.create({ data: { workspaceId, ...dto } });
  }

  get(projectId: string) {
    return this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: {
        brief: true,
        chosenName: true,
        _count: { select: { names: true, logos: true, slogans: true, signatures: true } },
      },
    });
  }

  update(projectId: string, dto: UpdateProjectDto) {
    return this.prisma.project.update({ where: { id: projectId }, data: dto });
  }

  softDelete(projectId: string) {
    return this.prisma.project.update({
      where: { id: projectId },
      data: { deletedAt: new Date() },
    });
  }

  async restore(projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (!project.deletedAt) return project;
    const limit = Date.now() - TRASH_RETENTION_DAYS * 86_400_000;
    if (project.deletedAt.getTime() < limit)
      throw new GoneException('Projet définitivement supprimé');
    return this.prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } });
  }

  /** Duplique le projet et son brief (les contenus générés ne sont pas copiés). */
  async duplicate(projectId: string) {
    const source = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { brief: true },
    });
    const { id: _id, projectId: _pid, updatedAt: _u, ...brief } = source.brief ?? ({} as never);
    return this.prisma.project.create({
      data: {
        workspaceId: source.workspaceId,
        entityType: source.entityType,
        title: `${source.title} (copie)`,
        status: ProjectStatus.DRAFT,
        ...(source.brief && { brief: { create: brief } }),
      },
      include: { brief: true },
    });
  }

  async upsertBrief(projectId: string, dto: BriefDto) {
    const brief = await this.prisma.brief.upsert({
      where: { projectId },
      create: { projectId, ...dto },
      update: dto,
    });
    await this.prisma.project.updateMany({
      where: { id: projectId, status: ProjectStatus.DRAFT },
      data: { status: ProjectStatus.IN_PROGRESS },
    });
    return brief;
  }

  /** Purge des projets restés plus de 30 jours dans la corbeille (tâche de maintenance). */
  purgeTrash() {
    return this.prisma.project.deleteMany({
      where: { deletedAt: { lt: new Date(Date.now() - TRASH_RETENTION_DAYS * 86_400_000) } },
    });
  }
}
