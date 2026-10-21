import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityType, JobKind, LogoEngine, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { SloganGenerationInput } from '../../shared/ai-schemas';
import { CREDIT_COSTS } from '../../shared/credit-costs';
import { logoSpecSchema } from '../../shared/logo-spec';
import { JobsService } from '../jobs/jobs.service';
import { LogosService } from '../logos/logos.service';
import { GenerateSlogansDto, ListSlogansDto, UpdateSloganDto } from './slogans.dto';

/** Une signature sous le logo reste courte : au-delà, elle devient illisible. */
const MAX_TAGLINE_CHARS = 80;

@Injectable()
export class SlogansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly logos: LogosService,
  ) {}

  /** Lot de 10 slogans (SIG-01) ; devise et mission en plus pour une association (SIG-03). */
  async generate(
    ctx: { projectId: string; workspaceId: string; actorId: string },
    dto: GenerateSlogansDto,
    idempotencyKey?: string,
  ) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      include: { chosenName: true, brief: true },
    });
    if (!project.chosenName) throw new BadRequestException('Retenez d’abord un nom');

    const previous = await this.prisma.slogan.findMany({
      where: { projectId: ctx.projectId },
      select: { text: true },
      take: 300,
      orderBy: { createdAt: 'desc' },
    });

    const input: SloganGenerationInput = {
      name: project.chosenName.value,
      entityType: project.entityType,
      brief: {
        sector: project.brief?.sector ?? '',
        mission: project.brief?.mission ?? '',
        values: project.brief?.values ?? [],
        audience: project.brief?.audience,
      },
      tone: dto.tone,
      language: dto.language ?? (project.brief?.languages[0] === 'en' ? 'en' : 'fr'),
      maxWords: dto.maxWords ?? 8,
      count: 10,
      withMotto: project.entityType === EntityType.ASSOCIATION,
      feedback: dto.feedback ?? null,
      exclude: previous.map((p) => p.text),
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

  list(projectId: string, q: ListSlogansDto) {
    return this.prisma.slogan.findMany({
      where: {
        projectId,
        ...(q.kind && { kind: q.kind }),
        ...(q.favorites && { isFavorite: true }),
      },
      orderBy: [{ isChosen: 'desc' }, { isFavorite: 'desc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  async update(sloganId: string, dto: UpdateSloganDto) {
    const slogan = await this.prisma.slogan.findUniqueOrThrow({ where: { id: sloganId } });
    if (dto.isChosen) {
      // Un seul choix par type dans le projet.
      await this.prisma.slogan.updateMany({
        where: {
          projectId: slogan.projectId,
          kind: slogan.kind,
          isChosen: true,
          id: { not: sloganId },
        },
        data: { isChosen: false },
      });
    }
    return this.prisma.slogan.update({ where: { id: sloganId }, data: dto });
  }

  /** SIG-05 : nouvelle version du logo avec le slogan comme signature, exportable comme les autres. */
  async applyToLogo(sloganId: string, logoId: string) {
    const slogan = await this.prisma.slogan.findUniqueOrThrow({ where: { id: sloganId } });
    if (slogan.text.length > MAX_TAGLINE_CHARS) {
      throw new BadRequestException(
        `Signature trop longue pour un logo (${MAX_TAGLINE_CHARS} caractères maximum)`,
      );
    }
    const logo = await this.prisma.logo.findFirst({
      where: { id: logoId, projectId: slogan.projectId },
      include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
    });
    if (!logo) throw new BadRequestException('Logo introuvable dans ce projet');
    if (logo.engine === LogoEngine.UPLOAD)
      throw new BadRequestException('Indisponible pour un logo importé');

    const spec = logoSpecSchema.parse(logo.versions[0].spec);
    return this.logos.saveVersion(logoId, {
      label: 'Logo avec signature',
      spec: { ...spec, tagline: slogan.text },
    });
  }
}
