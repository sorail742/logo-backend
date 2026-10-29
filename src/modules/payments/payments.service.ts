import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LedgerReason,
  PaymentProvider,
  PaymentStatus,
  Prisma,
  SubscriptionStatus,
} from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { cursorArgs, CursorPaginationDto, toPage } from '../../common/dto/pagination.dto';
import { PrismaService, Tx } from '../../common/prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreditsService } from '../../modules/credits/credits.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { AggregatorPaymentAdapter } from './adapters/aggregator.adapter';
import { CardPaymentAdapter } from './adapters/card.adapter';
import { OrangeMoneyAdapter } from './adapters/orange-money.adapter';
import type { PaymentAdapter } from './adapters/payment-adapter.interface';
import { InvoicePdfService } from './invoice-pdf.service';
import { CreateCheckoutDto, SimulatePaymentDto } from './payment.dto';

/** Tarifs de référence en GNF (§8.2, §15.4) si non renseignés en base. */
const DEFAULT_PLAN_PRICES: Record<string, bigint> = {
  PACK: 250_000n,
  ASSOCIATION: 150_000n,
  PRO: 450_000n,
  AGENCY: 1_500_000n,
};

/** Prix par crédit pour les recharges unitaires (1 500 GNF / crédit). */
const PRICE_PER_CREDIT_GNF = 1_500n;

/** Codes promotionnels de réduction (§8.4, PAY-06). */
const PROMO_CODES: Record<string, number> = {
  BIENVENUE10: 10, // -10%
  STARTUP20: 20,   // -20%
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly adapters: Map<PaymentProvider, PaymentAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditsService,
    private readonly notifications: NotificationsService,
    private readonly invoicePdf: InvoicePdfService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    orangeMoney: OrangeMoneyAdapter,
    card: CardPaymentAdapter,
    aggregator: AggregatorPaymentAdapter,
  ) {
    this.adapters = new Map<PaymentProvider, PaymentAdapter>([
      [PaymentProvider.ORANGE_MONEY, orangeMoney],
      [PaymentProvider.CARD, card],
      [PaymentProvider.MOBILE_MONEY_AGGREGATOR, aggregator],
    ]);
  }

  // ─── Initialisation d'un paiement (Checkout) ───

  async createCheckout(
    workspaceId: string,
    actorId: string,
    dto: CreateCheckoutDto,
    idempotencyKey?: string,
  ) {
    const key = idempotencyKey || randomUUID();

    // Idempotence : si une transaction identique existe déjà, la renvoyer
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey: key },
      include: { invoice: true },
    });
    if (existing) {
      return {
        paymentId: existing.id,
        status: existing.status,
        providerRef: existing.providerRef,
        amountGnf: existing.amountGnf.toString(),
      };
    }

    const [workspace, user] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actorId } }),
    ]);

    let amountGnf = 0n;
    let description = '';
    let creditsToGrant: number | null = null;
    let planCode: string | null = null;

    if (dto.planCode) {
      const plan = await this.prisma.plan.findUnique({
        where: { code: dto.planCode, isActive: true },
      });
      if (!plan) throw new NotFoundException(`Offre ${dto.planCode} introuvable ou inactive`);

      // Vérification du justificatif obligatoire pour l'offre ASSOCIATION (§8.2, ADM-07)
      if (plan.code === 'ASSOCIATION') {
        const proof = await this.prisma.associationProof.findFirst({
          where: { workspaceId, status: 'APPROVED' },
        });
        if (!proof) {
          throw new BadRequestException(
            'L’offre Association requiert un justificatif d’agrément validé par l’administration.',
          );
        }
      }

      planCode = plan.code;
      amountGnf = plan.priceGnf > 0n ? plan.priceGnf : (DEFAULT_PLAN_PRICES[plan.code] ?? 250_000n);
      description = `Souscription à l’offre ${plan.name}`;
    } else if (dto.creditPack) {
      creditsToGrant = dto.creditPack;
      amountGnf = BigInt(creditsToGrant) * PRICE_PER_CREDIT_GNF;
      description = `Recharge de ${creditsToGrant} crédits`;
    } else {
      throw new BadRequestException('Veuillez spécifier une offre (planCode) ou un nombre de crédits (creditPack).');
    }

    // Application éventuelle d'un code promo (PAY-06)
    if (dto.promoCode) {
      const discountPercent = PROMO_CODES[dto.promoCode.toUpperCase()];
      if (discountPercent) {
        amountGnf = (amountGnf * BigInt(100 - discountPercent)) / 100n;
        description += ` (Code promo -${discountPercent}%)`;
      }
    }

    // Création du paiement en attente
    const payment = await this.prisma.payment.create({
      data: {
        workspaceId,
        provider: dto.provider,
        idempotencyKey: key,
        amountGnf,
        planCode,
        creditsGranted: creditsToGrant,
        status: PaymentStatus.PENDING,
      },
    });

    const adapter = this.adapters.get(dto.provider);
    if (!adapter) throw new BadRequestException(`Fournisseur de paiement ${dto.provider} non pris en charge.`);

    const checkout = await adapter.initiateCheckout({
      paymentId: payment.id,
      amountGnf,
      description,
      customer: {
        id: user.id,
        name: user.fullName,
        email: user.email ?? undefined,
        phone: dto.phone ?? user.phone ?? undefined,
      },
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    });

    // Enregistrement de la référence du prestataire
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { providerRef: checkout.providerRef, raw: checkout.raw as Prisma.InputJsonValue },
    });

    return {
      paymentId: payment.id,
      amountGnf: amountGnf.toString(),
      provider: payment.provider,
      providerRef: checkout.providerRef,
      checkoutUrl: checkout.checkoutUrl,
      qrCodeUrl: checkout.qrCodeUrl,
      instructions: checkout.instructions,
    };
  }

  // ─── Traitement des Webhooks des opérateurs (PAY-03) ───

  async handleWebhook(
    provider: PaymentProvider,
    headers: Record<string, string | string[]>,
    body: any,
  ) {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new BadRequestException(`Adaptateur inconnu pour ${provider}`);

    const event = await adapter.verifyAndParseWebhook(headers, body);
    if (!event.providerRef && !body?.order_id && !body?.paymentId) {
      this.logger.warn(`Webhook ${provider} reçu sans référence de transaction.`);
      return { received: true, ignored: true };
    }

    const ref = event.providerRef;
    const paymentId = body?.order_id || body?.paymentId;

    const payment = await this.prisma.payment.findFirst({
      where: {
        OR: [
          ...(ref ? [{ providerRef: ref }] : []),
          ...(paymentId ? [{ id: paymentId }] : []),
        ],
      },
      include: {
        workspace: {
          include: {
            members: { where: { role: 'OWNER' }, select: { userId: true } },
          },
        },
      },
    });

    if (!payment) {
      this.logger.warn(`Paiement non trouvé pour le webhook ${provider} (ref: ${ref}, order_id: ${paymentId})`);
      return { received: true, notFound: true };
    }

    // Idempotence : si le paiement a déjà été validé ou remboursé, on ne le re-traite pas
    if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.REFUNDED) {
      return { received: true, alreadyProcessed: true };
    }

    if (event.status === PaymentStatus.FAILED) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, raw: event.raw as Prisma.InputJsonValue },
      });
      return { received: true, status: 'FAILED' };
    }

    if (event.status === PaymentStatus.SUCCEEDED) {
      return this.confirmPayment(payment.id, event.raw);
    }

    return { received: true, status: event.status };
  }

  // ─── Confirmation de paiement & Déblocage (Transaction atomique) ───

  async confirmPayment(paymentId: string, rawData?: unknown) {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        include: {
          workspace: {
            include: {
              members: { where: { role: 'OWNER' }, include: { user: true } },
            },
          },
        },
      });

      if (payment.status === PaymentStatus.SUCCEEDED) {
        return { success: true, message: 'Paiement déjà validé' };
      }

      // 1. Passage du paiement au statut SUCCEEDED
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.SUCCEEDED,
          raw: (rawData ?? payment.raw) as Prisma.InputJsonValue,
        },
      });

      const owner = payment.workspace.members[0]?.user;
      const ownerId = owner?.id;

      // 2. Traitement selon la nature de l'achat :
      // Cas A : Achat de crédits unitaires
      if (payment.creditsGranted && payment.creditsGranted > 0) {
        await this.credits.credit(tx, {
          workspaceId: payment.workspaceId,
          delta: payment.creditsGranted,
          reason: LedgerReason.PURCHASE,
          paymentId: payment.id,
          actorId: ownerId,
          note: `Achat confirmé de ${payment.creditsGranted} crédits`,
        });
      }

      // Cas B : Souscription ou renouvellement d'une offre (Plan)
      if (payment.planCode) {
        const plan = await tx.plan.findUniqueOrThrow({ where: { code: payment.planCode } });

        // Calcul de la période : 1 mois pour mensuel, 1 an pour annuel, 100 ans pour un pack unique
        const currentPeriodEnd = new Date();
        if (plan.interval === 'year') {
          currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
        } else if (plan.interval === 'month') {
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
        } else {
          currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 100);
        }

        await tx.subscription.upsert({
          where: { workspaceId: payment.workspaceId },
          create: {
            workspaceId: payment.workspaceId,
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
          },
          update: {
            planId: plan.id,
            status: SubscriptionStatus.ACTIVE,
            currentPeriodEnd,
            cancelAtPeriodEnd: false,
          },
        });

        // Crédits inclus dans l'offre (crédits récurrents ou one-time du Pack)
        const features = plan.features as { oneTimeCredits?: number } | null;
        const creditsToAdd = plan.monthlyCredits > 0 ? plan.monthlyCredits : (features?.oneTimeCredits ?? 0);
        if (creditsToAdd > 0) {
          await this.credits.credit(tx, {
            workspaceId: payment.workspaceId,
            delta: creditsToAdd,
            reason: plan.monthlyCredits > 0 ? LedgerReason.SUBSCRIPTION_GRANT : LedgerReason.PURCHASE,
            paymentId: payment.id,
            actorId: ownerId,
            note: `Crédits inclus : offre ${plan.name}`,
          });
        }
      }

      // 3. Génération automatique de la facture PDF
      const invoice = await this.invoicePdf.generateInvoice(tx, payment.id, {
        name: owner?.fullName ?? 'Client',
        email: owner?.email ?? undefined,
        phone: owner?.phone ?? undefined,
      });

      // 4. Notification in-app au propriétaire
      if (ownerId) {
        await this.notifications.write(tx, [ownerId], {
          type: 'PAYMENT',
          title: 'Paiement confirmé',
          body: `Votre paiement de ${payment.amountGnf.toString()} GNF a été validé. La facture ${invoice.number} est disponible.`,
          href: '/app/billing',
        });
      }

      return {
        success: true,
        paymentId: payment.id,
        invoiceNumber: invoice.number,
      };
    });
  }

  // ─── Simulation sandbox pour tests E2E et recette ───

  async simulatePayment(dto: SimulatePaymentDto) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: dto.paymentId } });
    if (dto.fail) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED },
      });
      return { success: false, status: 'FAILED' };
    }
    return this.confirmPayment(payment.id, { simulated: true });
  }

  // ─── Consultations & Factures ───

  async listWorkspacePayments(workspaceId: string, q: CursorPaginationDto) {
    const rows = await this.prisma.payment.findMany({
      where: { workspaceId },
      include: { invoice: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    const serialized = rows.map((p) => ({
      ...p,
      amountGnf: p.amountGnf.toString(),
      invoice: p.invoice ? { ...p.invoice, amountGnf: p.invoice.amountGnf.toString(), taxGnf: p.invoice.taxGnf.toString() } : null,
    }));
    return toPage(serialized, q.limit);
  }

  async getInvoiceDownloadUrl(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const downloadUrl = await this.storage.signedUrl(invoice.pdfKey, {
      fileName: `${invoice.number}.pdf`,
      inline: true,
    });
    return {
      number: invoice.number,
      downloadUrl,
      issuedAt: invoice.issuedAt,
    };
  }
}

