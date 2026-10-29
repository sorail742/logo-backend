import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkspaceRole } from '@prisma/client';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';

/** Types affichés par le front (AppNotification). */
export type NotificationType =
  'INVITATION' | 'COMMENT' | 'EXPORT_READY' | 'LOW_CREDITS' | 'PAYMENT';

export interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
  /** Lien relatif dans l'application (ex. /app/projets/…/kit). */
  href: string | null;
}

/** Solde sous lequel les propriétaires sont prévenus (COL-03, même seuil que le front). */
export const LOW_CREDITS_THRESHOLD = 5;

/**
 * Notifications dans l'application et par e-mail (COL-03) : invitation, commentaire,
 * export prêt, crédits bas. L'e-mail part par la file, après l'écriture en base.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async notify(userIds: string[], content: NotificationContent, options: { email?: boolean } = {}) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    await this.write(this.prisma, ids, content);
    if (options.email) await this.email(ids, content);
  }

  /** Écrit les notifications dans une transaction en cours (l'e-mail est à envoyer après). */
  write(tx: Tx, userIds: string[], content: NotificationContent) {
    return tx.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: content.type,
        payload: {
          title: content.title,
          body: content.body,
          href: content.href,
        } satisfies Prisma.InputJsonObject,
      })),
    });
  }

  /** Prévient les propriétaires d'un espace (crédits, paiements). */
  async notifyOwners(
    workspaceId: string,
    content: NotificationContent,
    options: { email?: boolean } = {},
  ) {
    const owners = await this.prisma.membership.findMany({
      where: { workspaceId, role: WorkspaceRole.OWNER },
      select: { userId: true },
    });
    await this.notify(
      owners.map((o) => o.userId),
      content,
      options,
    );
  }

  /**
   * Crédits bas : prévient une seule fois, quand un débit fait passer le solde sous le seuil.
   * Ne lève jamais : l'action qui a débité est déjà enregistrée.
   */
  async creditsDebited(workspaceId: string, before: number, after: number) {
    if (!(before > LOW_CREDITS_THRESHOLD && after <= LOW_CREDITS_THRESHOLD)) return;
    try {
      const ws = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { name: true },
      });
      await this.notifyOwners(
        workspaceId,
        {
          type: 'LOW_CREDITS',
          title: 'Crédits bas',
          body: `Il reste ${after} crédit${after > 1 ? 's' : ''} dans l’espace « ${ws?.name ?? ''} ».`,
          href: '/app/facturation',
        },
        { email: true },
      );
    } catch (err) {
      this.logger.warn(`Alerte de crédits bas non envoyée : ${(err as Error).message}`);
    }
  }

  private async email(userIds: string[], content: NotificationContent) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, email: { not: null }, deletedAt: null, suspendedAt: null },
      select: { email: true },
    });
    await Promise.all(
      users.map(({ email }) =>
        this.mail.sendNotification(email!, content).catch((err: Error) => {
          this.logger.warn(`E-mail de notification non programmé : ${err.message}`);
        }),
      ),
    );
  }
}
