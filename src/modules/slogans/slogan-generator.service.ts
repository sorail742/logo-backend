import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  generatedSlogansSchema,
  SloganGenerationInput,
  sloganGenerationInputSchema,
} from '../../shared/ai-schemas';
import { AiProvider } from '../ai/ai-provider';
import { ModerationService } from '../moderation/moderation.service';
import { closeKnownSlogan } from './known-slogans';

/**
 * Étape 4 du cycle de génération (§11.4) pour les slogans, devises et phrases de mission :
 * appel IA, validation zod, longueur (SIG-02), termes interdits, slogans connus (SIG-04).
 */
@Injectable()
export class SloganGeneratorService {
  private readonly logger = new Logger(SloganGeneratorService.name);

  constructor(
    private readonly ai: AiProvider,
    private readonly moderation: ModerationService,
    private readonly prisma: PrismaService,
  ) {}

  async generate(rawInput: unknown) {
    const input: SloganGenerationInput = sloganGenerationInputSchema.parse(rawInput);
    const result = await this.ai.generateSlogans(input);
    const parsed = generatedSlogansSchema.parse(result.raw);

    const seen = new Set(input.exclude.map((t) => t.toLowerCase()));
    const kept: string[] = [];
    for (const { text } of parsed.slogans) {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (seen.has(clean.toLowerCase())) continue;
      // La phrase de mission n'est pas limitée en mots ; le slogan et la devise le sont.
      if (input.kind !== 'MISSION' && clean.split(' ').length > input.maxWords) continue;
      const blocked = await this.moderation.findBlocked(clean, 'SLOGAN');
      if (blocked.length) {
        this.logger.debug(`Slogan filtré « ${clean} » : ${blocked.join(', ')}`);
        continue;
      }
      const known = closeKnownSlogan(clean);
      if (known) {
        this.logger.debug(`Slogan trop proche de « ${known} » : « ${clean} »`);
        continue;
      }
      seen.add(clean.toLowerCase());
      kept.push(clean);
    }

    return {
      input,
      slogans: kept.slice(0, input.count),
      provider: result.provider,
      promptVersion: result.promptVersion,
      costUsdMicros: result.costUsdMicros,
    };
  }

  /** Exécution d'une tâche SLOGANS par le worker : enregistre les propositions retenues. */
  async runJob(jobId: string) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const outcome = await this.generate(job.input);
    if (outcome.slogans.length === 0) throw new Error('Aucun slogan valide après filtrage');

    await this.prisma.$transaction([
      this.prisma.slogan.createMany({
        data: outcome.slogans.map((text) => ({
          projectId: job.projectId,
          text,
          kind: outcome.input.kind,
          tone: outcome.input.tone,
        })),
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
    return outcome.slogans.length;
  }
}
