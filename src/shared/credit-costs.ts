import { JobKind } from '@prisma/client';

/** Coût des actions en crédits (cahier des charges §8.3, à calibrer). */
export const CREDIT_COSTS = {
  NAMES_BATCH: 1,
  AVAILABILITY_CHECK: 0,
  LOGOS_BATCH_SVG: 2,
  LOGOS_BATCH_IMAGE: 5,
  SLOGANS_BATCH: 1,
  EMAIL_SIGNATURE: 0,
  HANDWRITTEN_OR_STAMP: 1,
  BRAND_GUIDE_PDF: 3,
} as const;

/** Quotas quotidiens de l'offre gratuite (§8.2), consommés quand le solde ne suffit pas. */
export const FREE_DAILY_QUOTAS: Partial<Record<JobKind, number>> = {
  NAMES: 3,
  LOGOS: 1,
};

/** Essais sans compte par IP et par jour (§3, §13.4). */
export const PUBLIC_TRIES_PER_DAY = 3;
