import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { JobKind, JobStatus, LedgerReason, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';
import { StorageService } from '../../common/storage/storage.service';
import { FREE_DAILY_QUOTAS } from '../../shared/credit-costs';
import { GENERATION_ATTEMPTS, GENERATION_QUEUE, GenerationJobData } from '../../shared/queues';
import { CreditsService } from '../credits/credits.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface EnqueueParams {
  workspaceId: string;
  projectId: string;
  kind: JobKind;
  input: Prisma.InputJsonValue;
  cost: number;
  idempotencyKey: string | undefined;
  actorId: string;
}

const IDEMPOTENCY_TTL_S = 24 * 3600;
const TERMINAL = new Set<JobStatus>([JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELED]);

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    @InjectQueue(GENERATION_QUEUE) private readonly queue: Queue<GenerationJobData>,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Cycle d'une génération (§11.4) : idempotence, débit + création de la tâche QUEUED dans
   * une même transaction, puis mise en file BullMQ. Renvoie l'identifiant de la tâche.
   */
  async enqueue(p: EnqueueParams): Promise<{ jobId: string; costCredits: number }> {
    const key = validateIdempotencyKey(p.idempotencyKey);
    const redisKey = `idem:gen:${p.workspaceId}:${key}`;

    const reserved = await this.redis.set(redisKey, 'pending', 'EX', IDEMPOTENCY_TTL_S, 'NX');
    if (!reserved) {
      const existing = await this.redis.get(redisKey);
      if (!existing || existing === 'pending') {
        throw new ConflictException('Requête identique déjà en cours de traitement');
      }
      const job = await this.prisma.generationJob.findUnique({ where: { id: existing } });
      if (job) return { jobId: job.id, costCredits: job.costCredits };
    }

    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const costCredits = await this.resolveCost(tx, p);
        const created = await tx.generationJob.create({
          data: {
            projectId: p.projectId,
            kind: p.kind,
            input: p.input,
            costCredits,
            status: JobStatus.QUEUED,
            requestedById: p.actorId,
          },
        });
        // Décrément conditionnel : en cas de course, la transaction entière est annulée.
        await this.credits.debit(tx, {
          workspaceId: p.workspaceId,
          amount: costCredits,
          reason: LedgerReason.GENERATION,
          jobId: created.id,
          actorId: p.actorId,
          note: p.kind,
        });
        return created;
      });

      await this.queue.add(
        p.kind,
        { jobId: job.id },
        {
          jobId: job.id,
          attempts: GENERATION_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 1000,
          removeOnFail: 5000,
        },
      );
      await this.redis.set(redisKey, job.id, 'EX', IDEMPOTENCY_TTL_S);
      if (job.costCredits > 0) {
        const { creditBalance } = await this.credits.balance(p.workspaceId);
        await this.notifications.creditsDebited(
          p.workspaceId,
          creditBalance + job.costCredits,
          creditBalance,
        );
      }
      return { jobId: job.id, costCredits: job.costCredits };
    } catch (err) {
      await this.redis.del(redisKey);
      throw err;
    }
  }

  /** Coût à débiter : le prix plein si le solde suffit, 0 si le quota quotidien gratuit le couvre. */
  private async resolveCost(tx: Prisma.TransactionClient, p: EnqueueParams): Promise<number> {
    if (p.cost <= 0) return 0;
    const ws = await tx.workspace.findUniqueOrThrow({
      where: { id: p.workspaceId },
      select: { creditBalance: true },
    });
    if (ws.creditBalance >= p.cost) return p.cost;

    const quota = FREE_DAILY_QUOTAS[p.kind] ?? 0;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await tx.generationJob.count({
      where: {
        kind: p.kind,
        costCredits: 0,
        createdAt: { gte: startOfDay },
        status: { not: JobStatus.FAILED },
        project: { workspaceId: p.workspaceId },
      },
    });
    if (usedToday < quota) return 0;

    throw new HttpException(
      {
        message: 'Crédits insuffisants et quota gratuit du jour atteint',
        code: 'INSUFFICIENT_CREDITS',
        quota,
        usedToday,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  /** Tâche ; ses fichiers ne sont signés que pour qui peut télécharger (§3). */
  async get(jobId: string, opts: { canDownload: boolean } = { canDownload: true }) {
    const job = await this.prisma.generationJob.findUniqueOrThrow({
      where: { id: jobId },
      select: {
        id: true,
        projectId: true,
        kind: true,
        status: true,
        costCredits: true,
        error: true,
        result: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });
    return {
      ...job,
      result: opts.canDownload ? await this.publicResult(job.result) : withoutFiles(job.result),
    };
  }

  /**
   * Résultat exposé : un fichier produit est servi par une URL signée tant qu'il existe ; une
   * liste d'images (Studio) l'est image par image.
   */
  private async publicResult(result: Prisma.JsonValue) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    const record = result as Record<string, Prisma.JsonValue>;
    if (Array.isArray(record.images)) {
      const images = await Promise.all(
        (record.images as { assetId: string; storageKey: string; width: number; height: number }[]).map(
          async ({ assetId, storageKey, width, height }) => {
            const exists = await this.prisma.asset.count({ where: { id: assetId } });
            return exists
              ? { url: await this.storage.signedUrl(storageKey, { inline: true }), width, height }
              : null;
          },
        ),
      );
      return { ...record, images: images.filter((i) => i !== null), expired: images.some((i) => !i) };
    }
    const { storageKey, assetId, ...rest } = record;
    if (typeof storageKey !== 'string' || typeof assetId !== 'string') return result;
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { name: true },
    });
    if (!asset) return { ...rest, expired: true };
    const downloadUrl = await this.storage.signedUrl(storageKey, { fileName: asset.name });
    return { ...rest, downloadUrl };
  }

  isTerminal(status: JobStatus) {
    return TERMINAL.has(status);
  }
}

function validateIdempotencyKey(key: string | undefined): string {
  if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new BadRequestException(
      'En-tête Idempotency-Key obligatoire (8 à 128 caractères alphanumériques, - ou _)',
    );
  }
  return key;
}

/** Résultat sans fichier ni lien : ce que voit un lecteur non autorisé à télécharger. */
function withoutFiles(result: Prisma.JsonValue): Prisma.JsonValue {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const { storageKey: _key, assetId: _asset, images, ...rest } = result as Record<string, Prisma.JsonValue>;
  return { ...rest, ...(Array.isArray(images) && { images: [] }), restricted: true };
}
