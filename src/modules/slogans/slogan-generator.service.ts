import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { generatedSlogansSchema, sloganGenerationInputSchema } from '../../shared/ai-schemas';
import { wordCount } from '../../shared/text';
import { AiProvider } from '../ai/ai-provider';
import { ModerationService } from '../moderation/moderation.service';
import { closestKnownSlogan } from './known-slogans';

/**
 * Étape 4 du cycle (§11.4) pour les slogans : appel IA, validation zod, longueur (SIG-02),
 * liste noire, comparaison aux slogans connus (SIG-04), enregistrement.
 */
@Injectable()
export class SloganGeneratorService {
  private readonly logger = new Logger(SloganGeneratorService.name);

  constructor(
    private readonly ai: AiProvider,
    private readonly moderation: ModerationService,
    private readonly prisma: PrismaService,
  ) {}

  async runJob(jobId: string): Promise<number> {
    const job = await this.prisma.generationJob.findUniqueOrThrow({ where: { id: jobId } });
    const input = sloganGenerationInputSchema.parse(job.input);
    const result = await this.ai.generateSlogans(input);
    const { slogans } = generatedSlogansSchema.parse(result.raw);

    const seen = new Set(input.exclude.map((e) => e.toLowerCase()));
    const kept: { text: string; kind: string; similarTo: string | null }[] = [];
    for (const s of slogans) {
      const key = s.text.toLowerCase();
      if (seen.has(key)) continue;
      // La longueur s'applique aux slogans ; devise et phrase de mission ont leur propre format.
      if (s.kind === 'SLOGAN' && wordCount(s.text) > input.maxWords) continue;
      if (!(await this.moderation.isAllowed(s.text, 'SLOGAN'))) {
        this.logger.debug(`Slogan filtré : ${s.text}`);
        continue;
      }
      seen.add(key);
      kept.push({ text: s.text, kind: s.kind, similarTo: closestKnownSlogan(s.text) });
    }
    if (!kept.some((k) => k.kind === 'SLOGAN'))
      throw new Error('Aucun slogan valide après filtrage');

    await this.prisma.$transaction([
      this.prisma.slogan.createMany({
        data: kept.map((k) => ({ ...k, projectId: job.projectId, tone: input.tone })),
      }),
      this.prisma.generationJob.update({
        where: { id: jobId },
        data: {
          provider: result.provider,
          promptVersion: result.promptVersion,
          costUsdMicros: result.costUsdMicros,
        },
      }),
    ]);
    return kept.length;
  }
}
