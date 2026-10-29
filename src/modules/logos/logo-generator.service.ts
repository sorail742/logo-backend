import { Injectable, Logger } from '@nestjs/common';
import { LogoEngine, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { hammingDistance, perceptualHash } from '../../render/raster';
import type { LogoSpec } from '../../render/logo-spec';
import {
  logoCompositionsSchema,
  LogoGenerationInput,
  logoGenerationInputSchema,
} from '../../shared/ai-schemas';
import { AiProvider } from '../ai/ai-provider';
import { parseSpec, specToSvg } from './logo-source';
import { omit } from '../../common/utils/object.util';

/** Distance de Hamming en deçà de laquelle un logo est jugé copié d'un autre (pHash 64 bits). */
const SIMILARITY_THRESHOLD = 6;

interface Proposal {
  spec: LogoSpec;
  svg: string;
  phash: string;
}

/**
 * Étape 4 du cycle de génération (§11.4) pour les logos, moteur A (§5.1) : l'IA choisit icône,
 * police, palette et disposition ; le serveur valide, compose le SVG et écarte les doublons et
 * les logos trop proches d'un logo exclusif d'un autre client (§5.5).
 */
@Injectable()
export class LogoGeneratorService {
  private readonly logger = new Logger(LogoGeneratorService.name);

  constructor(
    private readonly ai: AiProvider,
    private readonly prisma: PrismaService,
  ) {}

  async generate(rawInput: unknown, projectId: string) {
    const input: LogoGenerationInput = logoGenerationInputSchema.parse(rawInput);
    // Quelques compositions de plus que nécessaire : certaines peuvent être écartées.
    const result = await this.ai.composeLogos({ ...input, count: Math.min(input.count + 4, 16) });
    const { compositions } = logoCompositionsSchema.parse(result.raw);

    const exclusive = await this.prisma.logo.findMany({
      where: { isExclusive: true, phash: { not: null }, projectId: { not: projectId } },
      select: { phash: true },
      take: 10_000,
    });
    const taken = exclusive.map((l) => l.phash!);

    const proposals: Proposal[] = [];
    const seen = new Set<string>();
    for (const entry of compositions) {
      const { withTagline } = entry;
      const composition = omit(entry, ['withTagline', 'rationale']);
      const candidate = {
        ...composition,
        type: input.type,
        text: input.text,
        tagline: withTagline ? input.tagline : '',
        iconId: input.type === 'MONOGRAM' ? null : composition.iconId,
        layout: input.type === 'WORDMARK' ? ('text' as const) : composition.layout,
        iconScale: 1,
      };
      let spec: LogoSpec;
      try {
        spec = parseSpec(candidate);
      } catch {
        this.logger.debug(
          `Composition écartée (icône ou police hors bibliothèque) : ${JSON.stringify(composition)}`,
        );
        continue;
      }
      const key = JSON.stringify(spec);
      if (seen.has(key)) continue;
      seen.add(key);
      const svg = specToSvg(spec);
      const phash = perceptualHash(svg);
      if (taken.some((other) => hammingDistance(other, phash) <= SIMILARITY_THRESHOLD)) continue;
      proposals.push({ spec, svg, phash });
      if (proposals.length === input.count) break;
    }

    return {
      input,
      proposals,
      provider: result.provider,
      promptVersion: result.promptVersion,
      costUsdMicros: result.costUsdMicros,
    };
  }

  /** Exécution d'une tâche LOGOS par le worker : enregistre les propositions (LOGO-04). */
  async runJob(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const outcome = await this.generate(job.input, job.projectId);
    if (outcome.proposals.length === 0) throw new Error('Aucune proposition de logo valide');

    await this.prisma.$transaction(async (tx) => {
      // Créations dans l'ordre des propositions : l'affichage suit la date de création.
      await outcome.proposals.reduce<Promise<unknown>>(
        (previous, proposal) =>
          previous.then(() =>
            tx.logo.create({
              data: {
                projectId: job.projectId,
                jobId,
                type: outcome.input.type,
                engine: LogoEngine.SVG_COMPOSER,
                style: outcome.input.style,
                phash: proposal.phash,
                versions: {
                  create: {
                    number: 1,
                    label: 'Proposition',
                    spec: proposal.spec as unknown as Prisma.InputJsonValue,
                    svg: proposal.svg,
                  },
                },
              },
            }),
          ),
        Promise.resolve(),
      );
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          provider: outcome.provider,
          promptVersion: outcome.promptVersion,
          costUsdMicros: outcome.costUsdMicros,
          result: { created: outcome.proposals.length },
        },
      });
    });
    return outcome.proposals.length;
  }
}
