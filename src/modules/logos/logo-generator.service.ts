import { Injectable, Logger } from '@nestjs/common';
import { LogoEngine, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { fontInfo, iconExists } from '../../render/assets';
import { composeLogo } from '../../render/compose';
import { EXCLUSIVITY_MAX_DISTANCE, hammingDistance, perceptualHash } from '../../render/export';
import {
  generatedLogosSchema,
  LogoGenerationInput,
  logoGenerationInputSchema,
  LogoSpec,
  logoSpecSchema,
} from '../../shared/logo-spec';
import { AiProvider } from '../ai/ai-provider';

/** Spécification utilisable : police et icône présentes dans la bibliothèque interne (§5.5). */
export function assertLibraryAssets(spec: LogoSpec) {
  if (!fontInfo(spec.font.id)) throw new Error(`Police hors bibliothèque : ${spec.font.id}`);
  if (spec.taglineFont && !fontInfo(spec.taglineFont.id))
    throw new Error(`Police hors bibliothèque : ${spec.taglineFont.id}`);
  if (spec.icon && !iconExists(spec.icon.id))
    throw new Error(`Icône hors bibliothèque : ${spec.icon.id}`);
}

/**
 * Étape 4 du cycle (§11.4) pour les logos, moteur A : l'IA propose des spécifications,
 * le serveur les valide, les rend, écarte celles trop proches d'un logo exclusif, enregistre.
 */
@Injectable()
export class LogoGeneratorService {
  private readonly logger = new Logger(LogoGeneratorService.name);

  constructor(
    private readonly ai: AiProvider,
    private readonly prisma: PrismaService,
  ) {}

  async runJob(jobId: string): Promise<number> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const input: LogoGenerationInput = logoGenerationInputSchema.parse(job.input);

    // Quelques candidats de plus pour compenser ceux écartés par les contrôles.
    const result = await this.ai.composeLogos(input, input.count + 4);
    const { logos } = generatedLogosSchema.parse(result.raw);

    const exclusive = await this.prisma.logo.findMany({
      where: { isExclusive: true, phash: { not: null }, projectId: { not: job.projectId } },
      select: { phash: true },
    });

    const accepted: { spec: LogoSpec; svg: string; phash: string }[] = [];
    for (const raw of logos) {
      if (accepted.length >= input.count) break;
      try {
        // Le texte affiché (nom, sigle, signature) vient du projet, jamais de l'IA.
        const spec = logoSpecSchema.parse({
          ...raw,
          text: input.text,
          acronym: input.acronym && input.acronym.length <= 6 ? input.acronym : null,
          tagline: input.tagline ?? null,
        });
        assertLibraryAssets(spec);
        const { svg } = composeLogo(spec);
        const phash = perceptualHash(svg);
        if (exclusive.some((e) => hammingDistance(e.phash!, phash) <= EXCLUSIVITY_MAX_DISTANCE)) {
          this.logger.debug('Proposition écartée : trop proche d’un logo exclusif');
          continue;
        }
        if (accepted.some((a) => hammingDistance(a.phash, phash) <= 2)) continue; // quasi-doublon du lot
        accepted.push({ spec, svg, phash });
      } catch (err) {
        this.logger.warn(`Proposition invalide ignorée : ${String(err)}`);
      }
    }
    if (accepted.length === 0) throw new Error('Aucune proposition de logo valide');

    await this.prisma.$transaction(async (tx) => {
      for (const a of accepted) {
        await tx.logo.create({
          data: {
            projectId: job.projectId,
            jobId,
            type: a.spec.type,
            engine: LogoEngine.SVG_COMPOSER,
            style: input.style,
            phash: a.phash,
            versions: {
              create: {
                number: 1,
                label: 'Proposition',
                spec: a.spec as Prisma.InputJsonValue,
                svg: a.svg,
              },
            },
          },
        });
      }
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          provider: result.provider,
          promptVersion: result.promptVersion,
          costUsdMicros: result.costUsdMicros,
        },
      });
    });
    return accepted.length;
  }
}
