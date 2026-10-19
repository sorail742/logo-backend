import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { JobKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { SloganGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { JobsService } from '../jobs/jobs.service';
import { ModerationService } from '../moderation/moderation.service';
import { GenerateSlogansDto, UpdateSloganDto } from './slogans.dto';

@Injectable()
export class SlogansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly moderation: ModerationService,
  ) {}

  /** Lance un lot de 10 slogans (SIG-01 à 03) : 202 + jobId. */
  async generate(
    ctx: { projectId: string; workspaceId: string; actorId: string },
    dto: GenerateSlogansDto,
    idempotencyKey: string | undefined,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      include: { brief: true, chosenName: { select: { value: true } } },
    });
    const kind = dto.kind ?? 'SLOGAN';
    const previous = await this.prisma.slogan.findMany({
      where: { projectId: ctx.projectId, kind },
      select: { text: true },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const brief = project.brief;
    const input: SloganGenerationInput = {
      entityType: project.entityType,
      name: (project.chosenName?.value ?? project.title).slice(0, 60),
      brief: brief && {
        sector: brief.sector,
        mission: brief.mission,
        values: brief.values,
        audience: brief.audience,
      },
      kind,
      tone: dto.tone ?? 'INSPIRING',
      maxWords: dto.maxWords ?? 8,
      language: dto.language ?? 'fr',
      count: kind === 'SLOGAN' ? 10 : 5,
      exclude: previous.map((s) => s.text),
    };

    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.SLOGANS,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.SLOGANS_BATCH,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }

  list(projectId: string) {
    return this.prisma.slogan.findMany({
      where: { projectId },
      orderBy: [{ isChosen: 'desc' }, { isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  async update(sloganId: string, dto: UpdateSloganDto) {
    if (dto.text !== undefined) {
      const blocked = await this.moderation.findBlocked(dto.text, 'SLOGAN');
      if (blocked.length) {
        throw new UnprocessableEntityException({
          message: 'Ce texte contient un terme non autorisé',
          terms: blocked,
        });
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const slogan = await tx.slogan.findUniqueOrThrow({ where: { id: sloganId } });
      // Un seul slogan retenu par type (slogan, devise, mission) dans le projet.
      if (dto.isChosen) {
        await tx.slogan.updateMany({
          where: { projectId: slogan.projectId, kind: slogan.kind, isChosen: true },
          data: { isChosen: false },
        });
      }
      return tx.slogan.update({
        where: { id: sloganId },
        data: { ...dto, ...(dto.text !== undefined && { text: dto.text.trim() }) },
      });
    });
  }
}
