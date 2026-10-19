import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JobKind, NameStyle, Prisma, ProjectStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import type { NameGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS, PUBLIC_TRIES_PER_DAY } from '../../shared/credit-costs';
import { JobsService } from '../jobs/jobs.service';
import { ModerationService } from '../moderation/moderation.service';
import { NameGeneratorService } from './name-generator.service';
import { GenerateNamesDto, ListNamesDto, PublicNameTryDto, UpdateNameDto } from './names.dto';

@Injectable()
export class NamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly generator: NameGeneratorService,
    private readonly moderation: ModerationService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Lance un lot de 10 noms (NOM-10, NOM-13) : 202 + jobId. */
  async generate(
    ctx: { projectId: string; workspaceId: string; actorId: string },
    dto: GenerateNamesDto,
    idempotencyKey: string | undefined,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      include: { brief: true },
    });
    if (!project.brief)
      throw new BadRequestException('Complétez le brief avant de générer des noms');

    let likeName: string | undefined;
    if (dto.likeNameId) {
      const n = await this.prisma.nameSuggestion.findFirst({
        where: { id: dto.likeNameId, projectId: ctx.projectId },
      });
      if (!n) throw new BadRequestException('Nom de référence introuvable dans ce projet');
      likeName = n.value;
    }

    // NOM-15 : ne jamais reproposer un nom déjà proposé (et donc a fortiori refusé) dans le projet.
    const previous = await this.prisma.nameSuggestion.findMany({
      where: { projectId: ctx.projectId },
      select: { value: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const { id: _id, projectId: _pid, updatedAt: _u, ...brief } = project.brief;
    const input: NameGenerationInput = {
      entityType: project.entityType,
      brief,
      count: 10,
      feedback: dto.feedback,
      likeName,
      exclude: previous.map((p) => p.value),
    };

    return this.jobs.enqueue({
      workspaceId: ctx.workspaceId,
      projectId: ctx.projectId,
      kind: JobKind.NAMES,
      input: input as unknown as Prisma.InputJsonValue,
      cost: CREDIT_COSTS.NAMES_BATCH,
      idempotencyKey,
      actorId: ctx.actorId,
    });
  }

  list(projectId: string, q: ListNamesDto) {
    return this.prisma.nameSuggestion.findMany({
      where: {
        projectId,
        ...(q.favorites && { isFavorite: true }),
        ...(!q.rejected && { isRejected: false }),
      },
      include: {
        checks: { orderBy: { kind: 'asc' } },
        votes: true,
      },
      orderBy: [
        { isFavorite: 'desc' },
        { score: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
        // Un lot partage le même horodatage : départage stable pour un ordre reproductible.
        { value: 'asc' },
      ],
      take: 200,
    });
  }

  update(nameId: string, dto: UpdateNameDto) {
    return this.prisma.nameSuggestion.update({
      where: { id: nameId },
      data: {
        ...dto,
        // Un nom rejeté sort des favoris.
        ...(dto.isRejected && { isFavorite: false }),
      },
    });
  }

  /** NOM-31 : un vote par membre, modifiable. */
  async vote(nameId: string, userId: string, value: 1 | -1) {
    await this.prisma.nameVote.upsert({
      where: { nameId_userId: { nameId, userId } },
      create: { nameId, userId, value },
      update: { value },
    });
    const agg = await this.prisma.nameVote.aggregate({
      where: { nameId },
      _sum: { value: true },
      _count: true,
    });
    return { nameId, total: agg._sum.value ?? 0, voters: agg._count };
  }

  /** NOM-32 : le nom retenu devient le nom du projet. */
  async choose(projectId: string, dto: { nameId?: string; value?: string; acronym?: string }) {
    if (!dto.nameId && !dto.value) throw new BadRequestException('Indiquez nameId ou value');
    const nameId =
      dto.nameId ?? (await this.registerExistingName(projectId, dto.value!, dto.acronym)).id;
    const name = await this.prisma.nameSuggestion.findFirst({ where: { id: nameId, projectId } });
    if (!name) throw new BadRequestException('Ce nom n’appartient pas au projet');
    if (name.isRejected) throw new BadRequestException('Ce nom a été rejeté');
    return this.prisma.project.update({
      where: { id: projectId },
      data: { chosenNameId: nameId, status: ProjectStatus.IN_PROGRESS },
      include: { chosenName: true },
    });
  }

  /** Nom déjà existant saisi par l'utilisateur : enregistré comme suggestion pour garder un seul modèle. */
  private async registerExistingName(projectId: string, value: string, acronym?: string) {
    const clean = value.trim();
    if (!(await this.moderation.isAllowed(clean, 'NAME'))) {
      throw new BadRequestException('Ce nom contient un terme interdit ou une marque connue');
    }
    return this.prisma.nameSuggestion.upsert({
      where: { projectId_value: { projectId, value: clean } },
      create: {
        projectId,
        value: clean,
        acronym: acronym?.trim().toUpperCase() || null,
        meaning: 'Nom existant saisi par l’utilisateur',
        style: NameStyle.PROPER,
      },
      update: { isRejected: false, ...(acronym && { acronym: acronym.trim().toUpperCase() }) },
    });
  }

  /** Essai sans compte : 3 par jour et par IP, génération synchrone non enregistrée. */
  async publicTry(ip: string, dto: PublicNameTryDto) {
    const day = new Date().toISOString().slice(0, 10);
    const key = `public-try:names:${day}:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 86_400);
    if (count > PUBLIC_TRIES_PER_DAY) {
      throw new HttpException(
        'Limite d’essais gratuits atteinte pour aujourd’hui, créez un compte pour continuer',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const outcome = await this.generator.generate({
      entityType: dto.entityType,
      brief: {
        sector: dto.sector,
        mission: dto.mission,
        values: dto.values ?? [],
        languages: [dto.language ?? 'fr'],
        nameStyles: dto.nameStyles ?? [NameStyle.INVENTED, NameStyle.COMPOUND],
        mustInclude: [],
        mustAvoid: [],
      },
      count: 10,
      exclude: [],
    } satisfies NameGenerationInput);

    return { names: outcome.names, triesLeft: Math.max(0, PUBLIC_TRIES_PER_DAY - count) };
  }
}
