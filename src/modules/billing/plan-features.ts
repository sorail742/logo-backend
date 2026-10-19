import { SubscriptionStatus, type Subscription } from '@prisma/client';
import type { PrismaService } from '../../common/prisma/prisma.service';

/** Droits portés par Plan.features (seed) ; seules les clés utiles au serveur sont typées. */
export interface PlanFeatures {
  watermark?: boolean;
  maxPngSize?: number;
  brandGuidePdf?: boolean;
  stamp?: boolean;
}

const FREE_DEFAULTS: PlanFeatures = { watermark: true, maxPngSize: 512 };

/** Un abonnement donne accès à son offre jusqu'à son échéance, sauf s'il a expiré. */
export function isSubscriptionActive(
  subscription: Pick<Subscription, 'status' | 'currentPeriodEnd'> | null | undefined,
): subscription is Pick<Subscription, 'status' | 'currentPeriodEnd'> {
  return (
    !!subscription &&
    subscription.status !== SubscriptionStatus.EXPIRED &&
    subscription.currentPeriodEnd > new Date()
  );
}

/** Code de l'offre en vigueur (FREE sans abonnement actif). */
export function activePlanCode(
  subscription: (Pick<Subscription, 'status' | 'currentPeriodEnd'> & { plan: { code: string } }) | null | undefined,
) {
  return isSubscriptionActive(subscription) ? subscription.plan.code : 'FREE';
}

/**
 * Offre en vigueur pour un espace (§8.2) : l'abonnement actif ou payé jusqu'à son échéance,
 * sinon l'offre gratuite.
 */
export async function workspacePlan(
  prisma: PrismaService,
  workspaceId: string,
): Promise<{ code: string; features: PlanFeatures }> {
  const subscription = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { plan: { select: { code: true, features: true } } },
  });
  if (subscription && isSubscriptionActive(subscription)) {
    return { code: subscription.plan.code, features: subscription.plan.features as PlanFeatures };
  }

  const free = await prisma.plan.findUnique({
    where: { code: 'FREE' },
    select: { features: true },
  });
  return { code: 'FREE', features: (free?.features as PlanFeatures | undefined) ?? FREE_DEFAULTS };
}
