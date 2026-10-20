import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { JobKind, JobStatus } from '@prisma/client';
import { Job, UnrecoverableError } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { GENERATION_QUEUE, GenerationJobData } from '../shared/queues';
import { BrandKitFilesService } from '../modules/brand-kits/brand-kit-files.service';
import { CreditsService } from '../modules/credits/credits.service';
import { JobEventsService } from '../modules/jobs/job-events.service';
import { LogoExportService } from '../modules/logos/logo-export.service';
import { LogoGeneratorService } from '../modules/logos/logo-generator.service';
import { NameGeneratorService } from '../modules/names/name-generator.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { SignatureBatchService } from '../modules/signatures/signature-batch.service';
import { SloganGeneratorService } from '../modules/slogans/slogan-generator.service';
import { StudioExportService } from '../modules/studio/studio-export.service';

const READY_MESSAGES: Partial<Record<JobKind, { title: string; page: string; email: boolean }>> = {
  BRAND_GUIDE: { title: 'Charte graphique prête', page: 'kit', email: true },
  EXPORT_ZIP: { title: 'Archive du kit prête', page: 'kit', email: true },
  LOGO_EXPORT: { title: 'Export du logo prêt', page: 'logos', email: false },
  SIGNATURE: { title: 'Signatures en lot prêtes', page: 'signatures', email: false },
  DESIGN_EXPORT: { title: 'Export de création prêt', page: 'studio', email: false },
};

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
    private readonly logoExports: LogoExportService,
    private readonly slogans: SloganGeneratorService,
    private readonly signatureBatches: SignatureBatchService,
    private readonly kitFiles: BrandKitFilesService,
    private readonly notifications: NotificationsService,
    private readonly studioExports: StudioExportService,
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
    await this.notifyReady(record);
    return result;
  }

  private async run(kind: JobKind, jobId: string) {
    switch (kind) {
      case JobKind.NAMES:
        return { created: await this.names.runJob(jobId) };
      case JobKind.LOGOS:
        return { created: await this.logos.runJob(jobId) };
      case JobKind.LOGO_EXPORT: {
        const { fileName, files } = await this.logoExports.runJob(jobId);
        return { fileName, files };
      }
      case JobKind.SLOGANS:
        return { created: await this.slogans.runJob(jobId) };
      case JobKind.SIGNATURE: {
        const { fileName, count } = await this.signatureBatches.runJob(jobId);
        return { fileName, count };
      }
      case JobKind.BRAND_GUIDE: {
        const { fileName, sizeBytes } = await this.kitFiles.runGuide(jobId);
        return { fileName, sizeBytes };
      }
      case JobKind.EXPORT_ZIP: {
        const { fileName, files } = await this.kitFiles.runZip(jobId);
        return { fileName, files };
      }
      case JobKind.DESIGN_EXPORT: {
        const { fileName, pages } = await this.studioExports.runJob(jobId);
        return { fileName, pages };
      }
      default:
        // Module textile : propositions, maquettes et pack atelier à venir.
        throw new UnrecoverableError(`Type de génération ${kind} pas encore disponible`);
    }
  }

  /**
   * Export prêt (COL-03) : notification à l'auteur de la demande ; e-mail en plus pour les
   * exports lourds du kit, qu'il n'attend pas forcément à l'écran (§7.4).
   */
  private async notifyReady(job: {
    id: string;
    kind: JobKind;
    projectId: string;
    requestedById: string | null;
  }) {
    const ready = READY_MESSAGES[job.kind];
    if (!ready || !job.requestedById) return;
    try {
      const project = await this.prisma.project.findUnique({
        where: { id: job.projectId },
        select: { title: true, chosenName: { select: { value: true } } },
      });
      const name = project?.chosenName?.value ?? project?.title ?? '';
      await this.notifications.notify(
        [job.requestedById],
        {
          type: 'EXPORT_READY',
          title: ready.title,
          body: `${name} : le fichier est disponible pendant 7 jours.`,
          href: `/app/projets/${job.projectId}/${ready.page}`,
        },
        { email: ready.email },
      );
    } catch (err) {
      this.logger.warn(`Notification d'export non envoyée (${job.id}) : ${(err as Error).message}`);
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
