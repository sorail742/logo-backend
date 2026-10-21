import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { JobKind, JobStatus } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { GENERATION_QUEUE, GenerationJobData } from '../shared/queues';
import { CreditsService } from '../modules/credits/credits.service';
import { JobEventsService } from '../modules/jobs/job-events.service';
import { LogoExportService } from '../modules/logos/logo-export.service';
import { LogoGeneratorService } from '../modules/logos/logo-generator.service';
import { NameGeneratorService } from '../modules/names/name-generator.service';
import { SloganGeneratorService } from '../modules/slogans/slogan-generator.service';

/**
 * Consommateur de la file de génération (§11.4, étapes 4 à 6) :
 * exécute la tâche, publie sa progression et rembourse les crédits après le dernier échec.
 */
@Processor(GENERATION_QUEUE, { concurrency: 4 })
export class GenerationProcessor extends WorkerHost {
  private readonly logger = new Logger(GenerationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly events: JobEventsService,
    private readonly names: NameGeneratorService,
    private readonly logos: LogoGeneratorService,
    private readonly exports: LogoExportService,
    private readonly slogans: SloganGeneratorService,
  ) {
    super();
  }

  async process(job: Job<GenerationJobData>): Promise<unknown> {
    const { jobId } = job.data;
    const record = await this.prisma.generationJob.findUnique({ where: { id: jobId } });
    if (!record) throw new UnrecoverableError(`Tâche ${jobId} introuvable`);
    if (record.status === JobStatus.SUCCEEDED || record.status === JobStatus.CANCELED) {
      return { skipped: true };
    }

    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: JobStatus.RUNNING, startedAt: record.startedAt ?? new Date(), error: null },
    });
    await this.events.publish({ jobId, status: JobStatus.RUNNING });

    const result = await this.run(record.kind, jobId);

    await this.prisma.generationJob.update({
      where: { id: jobId },
      data: { status: JobStatus.SUCCEEDED, finishedAt: new Date() },
    });
    await this.events.publish({ jobId, status: JobStatus.SUCCEEDED });
    return result;
  }

  private async run(kind: JobKind, jobId: string) {
    switch (kind) {
      case JobKind.NAMES:
        return { created: await this.names.runJob(jobId) };
      case JobKind.LOGOS:
        return { created: await this.logos.runJob(jobId) };
      case JobKind.EXPORT_ZIP:
        return this.exports.runJob(jobId);
      case JobKind.SLOGANS:
        return { created: await this.slogans.runJob(jobId) };
      default:
        // Charte PDF, textile : phases suivantes du planning.
        throw new UnrecoverableError(`Type de génération ${kind} pas encore disponible`);
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<GenerationJobData> | undefined, err: Error) {
    if (!job) return;
    const { jobId } = job.data;
    const final = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(`Tâche ${jobId} en échec (tentative ${job.attemptsMade}) : ${err.message}`);
    if (!final) return;

    // Passage en FAILED et remboursement dans une même transaction, une seule fois.
    const failed = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.generationJob.updateMany({
        where: { id: jobId, status: { notIn: [JobStatus.FAILED, JobStatus.SUCCEEDED] } },
        data: {
          status: JobStatus.FAILED,
          finishedAt: new Date(),
          error: err.message.slice(0, 500),
        },
      });
      if (updated.count > 0) await this.credits.refundJob(tx, jobId);
      return updated.count > 0;
    });
    if (failed) {
      await this.events.publish({
        jobId,
        status: JobStatus.FAILED,
        error: 'La génération a échoué, vos crédits ont été remboursés.',
      });
    }
  }
}
