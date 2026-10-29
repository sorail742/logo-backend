import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, PaymentStatus, SubscriptionStatus } from '@prisma/client';
import { AggregatorPaymentAdapter } from './adapters/aggregator.adapter';
import { CardPaymentAdapter } from './adapters/card.adapter';
import { OrangeMoneyAdapter } from './adapters/orange-money.adapter';
import { InvoicePdfService } from './invoice-pdf.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: any;
  let credits: any;
  let notifications: any;
  let invoicePdf: any;
  let storage: any;
  let config: any;
  let orangeMoney: any;
  let card: any;
  let aggregator: any;

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      workspace: {
        findUniqueOrThrow: jest.fn(),
      },
      user: {
        findUniqueOrThrow: jest.fn(),
      },
      plan: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      associationProof: {
        findFirst: jest.fn(),
      },
      subscription: {
        upsert: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    credits = {
      credit: jest.fn().mockResolvedValue(undefined),
    };

    notifications = {
      write: jest.fn().mockResolvedValue(undefined),
    };

    invoicePdf = {
      generateInvoice: jest.fn().mockResolvedValue({
        id: 'inv-1',
        number: 'FAC-2026-000001',
        amountGnf: 250000n,
      }),
    };

    storage = {
      signedUrl: jest.fn().mockResolvedValue('https://storage.local/invoice.pdf'),
    };

    config = {
      get: jest.fn((key) => {
        if (key === 'APP_URL') return 'http://localhost:3000';
        if (key === 'API_URL') return 'http://localhost:3001';
        return undefined;
      }),
    };

    orangeMoney = {
      provider: PaymentProvider.ORANGE_MONEY,
      initiateCheckout: jest.fn().mockResolvedValue({
        checkoutUrl: 'https://om.example.com/pay',
        providerRef: 'OM-REF-1234',
      }),
      verifyAndParseWebhook: jest.fn(),
    };

    card = {
      provider: PaymentProvider.CARD,
      initiateCheckout: jest.fn().mockResolvedValue({
        checkoutUrl: 'https://card.example.com/pay',
        providerRef: 'CARD-REF-1234',
      }),
      verifyAndParseWebhook: jest.fn(),
    };

    aggregator = {
      provider: PaymentProvider.MOBILE_MONEY_AGGREGATOR,
      initiateCheckout: jest.fn(),
      verifyAndParseWebhook: jest.fn(),
    };

    service = new PaymentsService(
      prisma,
      credits,
      notifications,
      invoicePdf,
      storage,
      config,
      orangeMoney,
      card,
      aggregator,
    );
  });

  describe('createCheckout', () => {
    it('renvoie le paiement existant si la même clé d’idempotence est fournie', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-existing',
        status: PaymentStatus.PENDING,
        providerRef: 'OM-EXISTING',
        amountGnf: 250000n,
      });

      const res = await service.createCheckout(
        'ws-1',
        'usr-1',
        { provider: PaymentProvider.ORANGE_MONEY, planCode: 'PACK' },
        'idem-key-1',
      );

      expect(res.paymentId).toBe('pay-existing');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('crée un paiement en attente et appelle l’adaptateur Orange Money', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ id: 'ws-1', name: 'Mon Espace' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'usr-1', fullName: 'Amadou Bah' });
      prisma.plan.findUnique.mockResolvedValue({
        id: 'plan-pack',
        code: 'PACK',
        name: 'Pack Identité',
        priceGnf: 250000n,
        isActive: true,
      });
      prisma.payment.create.mockResolvedValue({
        id: 'pay-new',
        provider: PaymentProvider.ORANGE_MONEY,
        amountGnf: 250000n,
      });

      const res = await service.createCheckout(
        'ws-1',
        'usr-1',
        { provider: PaymentProvider.ORANGE_MONEY, planCode: 'PACK' },
        'idem-key-new',
      );

      expect(res.paymentId).toBe('pay-new');
      expect(res.amountGnf).toBe('250000');
      expect(orangeMoney.initiateCheckout).toHaveBeenCalled();
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-new' },
        data: { providerRef: 'OM-REF-1234', raw: undefined },
      });
    });

    it('refuse l’offre Association si aucun justificatif approuvé n’est trouvé', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ id: 'ws-1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'usr-1' });
      prisma.plan.findUnique.mockResolvedValue({
        code: 'ASSOCIATION',
        isActive: true,
      });
      prisma.associationProof.findFirst.mockResolvedValue(null);

      await expect(
        service.createCheckout('ws-1', 'usr-1', {
          provider: PaymentProvider.ORANGE_MONEY,
          planCode: 'ASSOCIATION',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('applique un code promotionnel valide (-20%)', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      prisma.workspace.findUniqueOrThrow.mockResolvedValue({ id: 'ws-1' });
      prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'usr-1', fullName: 'Test' });
      prisma.plan.findUnique.mockResolvedValue({
        code: 'PRO',
        name: 'Pro',
        priceGnf: 450000n,
        isActive: true,
      });
      prisma.payment.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 'pay-promo', ...data }));

      const res = await service.createCheckout('ws-1', 'usr-1', {
        provider: PaymentProvider.CARD,
        planCode: 'PRO',
        promoCode: 'STARTUP20',
      });

      // 450 000 * 0.8 = 360 000
      expect(res.amountGnf).toBe('360000');
    });
  });

  describe('confirmPayment', () => {
    it('met à jour le paiement, souscrit l’offre, crédite les crédits et génère la facture', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'pay-1',
        workspaceId: 'ws-1',
        status: PaymentStatus.PENDING,
        amountGnf: 250000n,
        planCode: 'PACK',
        creditsGranted: null,
        workspace: {
          members: [{ user: { id: 'usr-owner', fullName: 'Propriétaire', email: 'owner@test.com' } }],
        },
      });

      prisma.plan.findUniqueOrThrow.mockResolvedValue({
        id: 'plan-pack',
        code: 'PACK',
        name: 'Pack Identité',
        interval: null,
        monthlyCredits: 0,
        features: { oneTimeCredits: 100 },
      });

      const res = await service.confirmPayment('pay-1');

      expect(res.success).toBe(true);
      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: PaymentStatus.SUCCEEDED, raw: undefined },
      });
      expect(prisma.subscription.upsert).toHaveBeenCalled();
      expect(credits.credit).toHaveBeenCalledWith(prisma, expect.objectContaining({
        workspaceId: 'ws-1',
        delta: 100,
      }));
      expect(invoicePdf.generateInvoice).toHaveBeenCalled();
      expect(notifications.write).toHaveBeenCalled();
    });

    it('est strictement idempotent si déjà SUCCEEDED', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.SUCCEEDED,
        workspace: { members: [] },
      });

      const res = await service.confirmPayment('pay-1');
      expect(res.success).toBe(true);
      expect(credits.credit).not.toHaveBeenCalled();
      expect(invoicePdf.generateInvoice).not.toHaveBeenCalled();
    });
  });
});

