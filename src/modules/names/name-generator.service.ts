import { Injectable, Logger } from '@nestjs/common';
import {
  GeneratedName,
  generatedNamesSchema,
  NameGenerationInput,
  nameGenerationInputSchema,
} from '../../shared/ai-schemas';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiProvider } from '../ai/ai-provider';
import { containsTerm, ModerationService } from '../moderation/moderation.service';
import { scoreName } from './name-score.util';

export interface GenerationOutcome {
  names: (GeneratedName & { score: number })[];
  provider: string;
  promptVersion: string;
  costUsdMicros: number;
}

/**
 * Étape 4 du cycle de génération (§11.4) pour les noms : appel IA, validation zod,
 * filtrage des termes interdits et des noms exclus, score.
 */
@Injectable()
export class NameGeneratorService {
  private readonly logger = new Logger(NameGeneratorService.name);

  constructor(
    private readonly ai: AiProvider,
    private readonly moderation: ModerationService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(rawInput: unknown): Promise<GenerationOutcome> {
    const input: NameGenerationInput = nameGenerationInputSchema.parse(rawInput);
    const result = await this.ai.generateNames(input);
    const parsed = generatedNamesSchema.parse(result.raw);

    const exclude = new Set(input.exclude.map((n) => n.toLowerCase()));
    const kept: GenerationOutcome['names'] = [];
    for (const name of parsed.names) {
      if (exclude.has(name.value.toLowerCase())) continue;
      if (input.brief.mustAvoid.some((w) => containsTerm(name.value, w))) continue;
      const blocked = await this.moderation.findBlocked(
        `${name.value} ${name.expandedForm ?? ''}`,
        'NAME',
      );
      if (blocked.length) {
        this.logger.debug(`Nom écarté par la modération (${blocked.length} terme(s) interdit(s))`);
        continue;
      }
      exclude.add(name.value.toLowerCase());
      kept.push({
        ...name,
        score: scoreName({
          value: name.value,
          briefWords: [...input.brief.values, input.brief.sector],
        }),
      });
    }

    return {
      names: kept.slice(0, input.count),
      provider: result.provider,
      promptVersion: result.promptVersion,
      costUsdMicros: result.costUsdMicros,
    };
  }

  /** Exécution d'une tâche NAMES par le worker : enregistre les noms retenus. */
  async runJob(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const outcome = await this.generate(job.input);
    if (outcome.names.length === 0) throw new Error('Aucun nom valide après filtrage');

    await this.prisma.$transaction([
      this.prisma.nameSuggestion.createMany({
        data: outcome.names.map((n) => ({
          projectId: job.projectId,
          jobId,
          value: n.value,
          acronym: n.acronym ?? null,
          meaning: n.expandedForm ? `${n.meaning} — ${n.expandedForm}` : n.meaning,
          style: n.style,
          pronunciation: n.pronunciation ?? null,
          score: n.score,
        })),
        skipDuplicates: true,
      }),
      this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          provider: outcome.provider,
          promptVersion: outcome.promptVersion,
          costUsdMicros: outcome.costUsdMicros,
        },
      }),
    ]);
    return outcome.names.length;
  }
}
