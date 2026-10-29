import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AssetKind, SubscriptionStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { MAINTENANCE_QUEUE } from '../shared/queues';
import { CreditsService } from '../modules/credits/credits.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async onApplicationBootstrap() {
    await this.queue.upsertJobScheduler(
      'nightly',
      { pattern: '0 3 * * *', tz: 'Africa/Conakry' },
      { name: 'nightly' },
    );
  }

  async process(_job: Job) {
    const day = 86_400_000;
    const now = Date.now();

    const projects = await this.prisma.project.deleteMany({
      where: { deletedAt: { lt: new Date(now - TRASH_RETENTION_DAYS * day) } },
    });

    // Comptes supprimés depuis plus de 30 jours : anonymisation (les factures restent liées à l'espace).
    const users = await this.prisma.user.findMany({
      where: {
        deletedAt: { lt: new Date(now - ACCOUNT_RETENTION_DAYS * day) },
        email: { not: null },
      },
      select: { id: true },
    });
    await Promise.all(
      users.map(({ id }) =>
        this.prisma.$transaction([
          this.prisma.oAuthAccount.deleteMany({ where: { userId: id } }),
          this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
          this.prisma.membership.deleteMany({ where: { userId: id } }),
          this.prisma.user.update({
            where: { id },
            data: {
              email: null,
              phone: null,
              passwordHash: null,
              totpSecret: null,
              avatarUrl: null,
              fullName: 'Compte supprimé',
            },
          }),
        ]),
      ),
    );

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
    // Fichier supprimé d'abord ; la ligne ne disparaît que si le fichier est bien parti.
    const deletions = await Promise.allSettled(
      exports.map((asset) => this.storage.delete(asset.storageKey)),
    );
    const purged = exports.filter((_, i) => deletions[i].status === 'fulfilled');
    await this.prisma.asset.deleteMany({ where: { id: { in: purged.map((asset) => asset.id) } } });
    // Kits dont la charte ou l'archive vient d'être purgée : régénérables sans coût (§7.4).
    const purgedKeys = purged.map((asset) => asset.storageKey);
    if (purgedKeys.length) {
      await this.prisma.brandKit.updateMany({
        where: { guidePdfKey: { in: purgedKeys } },
        data: { guidePdfKey: null },
      });
      await this.prisma.brandKit.updateMany({
        where: { zipKey: { in: purgedKeys } },
        data: { zipKey: null },
      });
    }

    const drift = await this.credits.reconcileBalances();
    if (drift.length) this.logger.error({ drift }, 'Écart entre soldes et grand livre corrigé');

    // Abonnements (PAY-08) : rappel à J-3, 3 jours de grâce avant expiration
    const threeDays = 3 * day;
    const expiringSoon = await this.prisma.subscription.findMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { gte: new Date(now), lte: new Date(now + threeDays) },
      },
      include: {
        workspace: {
          include: { members: { where: { role: 'OWNER' }, select: { userId: true } } },
        },
        plan: { select: { name: true } },
      },
    });

    for (const sub of expiringSoon) {
      const ownerIds = sub.workspace.members.map((m) => m.userId);
      await this.notifications.notify(
        ownerIds,
        {
          type: 'PAYMENT',
          title: 'Renouvellement d’abonnement proche',
          body: `Votre offre ${sub.plan.name} arrive à échéance sous 3 jours.`,
          href: '/app/billing',
        },
        { email: true },
      );
    }

    // Période de grâce de 3 jours : passage à PAST_DUE
    const pastDue = await this.prisma.subscription.updateMany({
      where: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: { lt: new Date(now), gte: new Date(now - threeDays) },
      },
      data: { status: SubscriptionStatus.PAST_DUE },
    });

    // Au-delà de la période de grâce : passage à EXPIRED
    const expired = await this.prisma.subscription.updateMany({
      where: {
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
        currentPeriodEnd: { lt: new Date(now - threeDays) },
      },
      data: { status: SubscriptionStatus.EXPIRED },
    });

    const summary = {
      purgedProjects: projects.count,
      anonymizedUsers: users.length,
      purgedTokens: tokens.count,
      purgedExports: purged.length,
      balanceDrift: drift.length,
      subscriptionsReminded: expiringSoon.length,
      subscriptionsPastDue: pastDue.count,
      subscriptionsExpired: expired.count,
    };
    this.logger.log(summary, 'Maintenance nocturne terminée');
    return summary;
  }
}
