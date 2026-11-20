import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let prisma: {
    payment: Record<string, jest.Mock>;
    workspace: Record<string, jest.Mock>;
    user: Record<string, jest.Mock>;
    plan: Record<string, jest.Mock>;
    associationProof: Record<string, jest.Mock>;
    subscription: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let credits: { credit: jest.Mock };
  let notifications: { write: jest.Mock };
  let invoicePdf: { generateInvoice: jest.Mock };
  let storage: { signedUrl: jest.Mock };
  let config: { get: jest.Mock };
  let orangeMoney: {
    provider: PaymentProvider;
    initiateCheckout: jest.Mock;
    verifyAndParseWebhook: jest.Mock;
  };
  let card: {
    provider: PaymentProvider;
    initiateCheckout: jest.Mock;
    verifyAndParseWebhook: jest.Mock;
  };
  let aggregator: {
    provider: PaymentProvider;
    initiateCheckout: jest.Mock;
    verifyAndParseWebhook: jest.Mock;
  };

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
      prisma as never,
      credits as never,
      notifications as never,
      invoicePdf as never,
      storage as never,
      config as never,
      orangeMoney as never,
      card as never,
      aggregator as never,
    );
  });

  describe('handleWebhook', () => {
    it('limite la recherche au fournisseur du webhook', async () => {
      orangeMoney.verifyAndParseWebhook.mockResolvedValue({
        providerRef: 'CARD-REF-1234',
        status: PaymentStatus.SUCCEEDED,
      });
      prisma.payment.findFirst.mockResolvedValue(null);

      const result = await service.handleWebhook(PaymentProvider.ORANGE_MONEY, {}, {});

      expect(result).toEqual({ received: true, notFound: true });
      expect(prisma.payment.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider: PaymentProvider.ORANGE_MONEY,
            OR: [{ providerRef: 'CARD-REF-1234' }],
          },
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignore un webhook réussi dont le montant diffère du paiement', async () => {
      orangeMoney.verifyAndParseWebhook.mockResolvedValue({
        providerRef: 'OM-REF-1234',
        status: PaymentStatus.SUCCEEDED,
        amountGnf: 90000n,
      });
      prisma.payment.findFirst.mockResolvedValue({
        id: 'pay-1',
        amountGnf: 100000n,
        status: PaymentStatus.PENDING,
      });

      const result = await service.handleWebhook(PaymentProvider.ORANGE_MONEY, {}, {});

      expect(result).toEqual({ received: true, ignored: true, amountMismatch: true });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignore un identifiant de paiement qui n’est pas une chaîne', async () => {
      orangeMoney.verifyAndParseWebhook.mockResolvedValue({
        providerRef: '',
        status: PaymentStatus.PENDING,
      });

      const result = await service.handleWebhook(PaymentProvider.ORANGE_MONEY, {}, { order_id: 123 });

      expect(result).toEqual({ received: true, ignored: true });
      expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    });
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
      prisma.payment.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'pay-promo', ...data }),
      );

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
          members: [
            { user: { id: 'usr-owner', fullName: 'Propriétaire', email: 'owner@test.com' } },
          ],
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
      expect(credits.credit).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          workspaceId: 'ws-1',
          delta: 100,
        }),
      );
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

  describe('simulatePayment', () => {
    it('bloque la simulation si NODE_ENV est production', async () => {
      config.get.mockImplementation((k: string) => (k === 'NODE_ENV' ? 'production' : undefined));
      await expect(service.simulatePayment({ paymentId: 'pay-1' })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('permet la simulation en dehors de production', async () => {
      config.get.mockImplementation((k: string) => (k === 'NODE_ENV' ? 'test' : undefined));
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: 'pay-1',
        status: PaymentStatus.PENDING,
        workspaceId: 'ws-1',
        amountGnf: 100000n,
        planCode: null,
        workspace: { members: [] },
      });

      const res = await service.simulatePayment({ paymentId: 'pay-1' });
      expect(res.success).toBe(true);
    });
  });
});
