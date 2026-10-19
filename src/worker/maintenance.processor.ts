import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AssetKind } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MAINTENANCE_QUEUE } from '../shared/queues';
import { CreditsService } from '../modules/credits/credits.service';
import { EXPORT_RETENTION_DAYS } from '../modules/logos/logo-export.service';
import { TRASH_RETENTION_DAYS } from '../modules/projects/projects.service';

const ACCOUNT_RETENTION_DAYS = 30;
const REFRESH_TOKEN_GRACE_DAYS = 7;

/**
 * Tâches nocturnes : purge de la corbeille, des comptes supprimés et des exports expirés,
 * contrôle des soldes (§12.1, §14.3).
 */
@Processor(MAINTENANCE_QUEUE)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler('nightly', { pattern: '0 3 * * *', tz: 'Africa/Conakry' }, { name: 'nightly' });
  }

  async process(_job: Job) {
    const day = 86_400_000;
    const now = Date.now();

    const projects = await this.prisma.project.deleteMany({
      where: { deletedAt: { lt: new Date(now - TRASH_RETENTION_DAYS * day) } },
    });

    // Comptes supprimés depuis plus de 30 jours : anonymisation (les factures restent liées à l'espace).
    const users = await this.prisma.user.findMany({
      where: { deletedAt: { lt: new Date(now - ACCOUNT_RETENTION_DAYS * day) }, email: { not: null } },
      select: { id: true },
    });
    for (const { id } of users) {
      await this.prisma.$transaction([
        this.prisma.oAuthAccount.deleteMany({ where: { userId: id } }),
        this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
        this.prisma.membership.deleteMany({ where: { userId: id } }),
        this.prisma.user.update({
          where: { id },
          data: { email: null, phone: null, passwordHash: null, totpSecret: null, avatarUrl: null, fullName: 'Compte supprimé' },
        }),
      ]);
    }

    const tokens = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: new Date(now - REFRESH_TOKEN_GRACE_DAYS * day) } },
    });

    // Exports mis à disposition 7 jours : fichier puis enregistrement.
    const exports = await this.prisma.asset.findMany({
      where: {
        kind: AssetKind.EXPORT,
        createdAt: { lt: new Date(now - EXPORT_RETENTION_DAYS * day) },
      },
      select: { id: true, storageKey: true },
    });
    for (const asset of exports) {
      await this.storage.delete(asset.storageKey);
      await this.prisma.asset.delete({ where: { id: asset.id } });
    }

    const drift = await this.credits.reconcileBalances();
    if (drift.length) this.logger.error({ drift }, 'Écart entre soldes et grand livre corrigé');

    const summary = {
      purgedProjects: projects.count,
      anonymizedUsers: users.length,
      purgedTokens: tokens.count,
      purgedExports: exports.length,
      balanceDrift: drift.length,
    };
    this.logger.log(summary, 'Maintenance nocturne terminée');
    return summary;
  }
}
