import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JobKind, NameStyle, Prisma, ProjectStatus } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import type { NameGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS, PUBLIC_TRIES_PER_DAY } from '../../shared/credit-costs';
import { BrandKitsService } from '../brand-kits/brand-kits.service';
import { JobsService } from '../jobs/jobs.service';
import { NameGeneratorService } from './name-generator.service';
import { NAME_INCLUDE, toNameDto } from './name.presenter';
import { PROJECT_INCLUDE, toProjectDto } from '../projects/project.presenter';
import { GenerateNamesDto, ListNamesDto, PublicNameTryDto, UpdateNameDto } from './names.dto';
import { omit } from '../../common/utils/object.util';

@Injectable()
export class NamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly generator: NameGeneratorService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly brandKits: BrandKitsService,
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
    if (dto.referenceNameId) {
      const n = await this.prisma.nameSuggestion.findFirst({
        where: { id: dto.referenceNameId, projectId: ctx.projectId },
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

    const brief = omit(project.brief, ['id', 'projectId', 'updatedAt']);
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

  async list(projectId: string, userId: string, q: ListNamesDto) {
    const names = await this.prisma.nameSuggestion.findMany({
      where: {
        projectId,
        ...(q.favorites && { isFavorite: true }),
        ...(!q.rejected && { isRejected: false }),
      },
      include: NAME_INCLUDE,
      orderBy: [
        { isFavorite: 'desc' },
        { score: { sort: 'desc', nulls: 'last' } },
        { createdAt: 'desc' },
      ],
      take: 200,
    });
    return names.map((n) => toNameDto(n, userId));
  }

  async update(nameId: string, userId: string, dto: UpdateNameDto) {
    const name = await this.prisma.nameSuggestion.update({
      where: { id: nameId },
      data: {
        ...dto,
        // Un nom rejeté sort des favoris.
        ...(dto.isRejected && { isFavorite: false }),
      },
      include: NAME_INCLUDE,
    });
    return toNameDto(name, userId);
  }

  /** NOM-31 : un vote par membre, modifiable ; renvoie le nom avec le total à jour. */
  async vote(nameId: string, userId: string, value: 1 | -1) {
    await this.prisma.nameVote.upsert({
      where: { nameId_userId: { nameId, userId } },
      create: { nameId, userId, value },
      update: { value },
    });
    const name = await this.prisma.nameSuggestion.findUniqueOrThrow({
      where: { id: nameId },
      include: NAME_INCLUDE,
    });
    return toNameDto(name, userId);
  }

  /**
   * NOM-32 : le nom retenu devient le nom du projet. NOM-33 : un changement de nom final
   * crée une nouvelle version du kit s'il en existe déjà un.
   */
  async choose(projectId: string, nameId: string, userId: string) {
    const name = await this.prisma.nameSuggestion.findFirst({ where: { id: nameId, projectId } });
    if (!name) throw new BadRequestException('Ce nom n’appartient pas au projet');
    if (name.isRejected) throw new BadRequestException('Ce nom a été rejeté');
    const before = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { chosenNameId: true },
    });
    await this.prisma.project.update({
      where: { id: projectId },
      data: { chosenNameId: nameId, status: ProjectStatus.IN_PROGRESS },
    });
    if (before.chosenNameId && before.chosenNameId !== nameId) {
      await this.brandKits.onNameChanged(projectId);
    }
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      include: PROJECT_INCLUDE,
    });
    return toProjectDto(project, userId);
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

    const keywords = dto.keywords ?? [];
    const outcome = await this.generator.generate({
      entityType: dto.entityType,
      brief: {
        sector: dto.sector,
        mission: dto.mission ?? keywords.join(' '),
        values: [...(dto.values ?? []), ...keywords],
        languages: [dto.language ?? 'fr'],
        nameStyles: dto.nameStyles ?? [NameStyle.INVENTED, NameStyle.COMPOUND],
        mustInclude: [],
        mustAvoid: [],
      },
      count: 10,
      exclude: [],
    } satisfies NameGenerationInput);

    return { names: outcome.names, remaining: Math.max(0, PUBLIC_TRIES_PER_DAY - count) };
  }
}
