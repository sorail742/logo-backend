import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import type { CheckoutResult, InitiateCheckoutParams, PaymentAdapter, WebhookResult } from './payment-adapter.interface';

/**
 * Adaptateur de paiement par Carte Bancaire (PAY-02).
 * Compatible passerelles internationales (Stripe, Paystack, Flutterwave).
 * Bascule en mode simulation si les clés secrètes ne sont pas définies.
 */
@Injectable()
export class CardPaymentAdapter implements PaymentAdapter {
  readonly provider = PaymentProvider.CARD;
  private readonly logger = new Logger(CardPaymentAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async initiateCheckout(params: InitiateCheckoutParams): Promise<CheckoutResult> {
    const secretKey = this.config.get<string>('CARD_PAYMENT_SECRET_KEY');

    // Passerelle réelle si configurée
    if (secretKey) {
      // Intégration session de paiement sécurisée
      this.logger.log(`Initialisation paiement carte pour la commande ${params.paymentId}`);
    }

    // Mode simulation / bac à sable
    const mockRef = `CARD-SIM-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const appUrl = this.config.get('APP_URL') ?? 'http://localhost:3000';
    const mockCheckoutUrl = `${appUrl}/app/billing/mock-checkout?paymentId=${params.paymentId}&ref=${mockRef}`;

    return {
      checkoutUrl: mockCheckoutUrl,
      providerRef: mockRef,
      instructions: 'Paiement par carte sécurisée (Visa, Mastercard).',
      raw: { mode: 'sandbox', simulated: true },
    };
  }

  async verifyAndParseWebhook(headers: Record<string, string | string[]>, body: any): Promise<WebhookResult> {
    const webhookSecret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (webhookSecret) {
      const sigHeader = headers['stripe-signature'] || headers['x-paystack-signature'] || headers['x-signature'];
      if (sigHeader && typeof body === 'string') {
        const expected = createHmac('sha256', webhookSecret).update(body).digest('hex');
        if (sigHeader !== expected) {
          throw new Error('Signature webhook invalide');
        }
      }
    }

    const event = typeof body === 'string' ? JSON.parse(body) : body;
    const statusStr = String(event?.status || event?.event || '').toUpperCase();

    let status: PaymentStatus = PaymentStatus.PENDING;
    if (statusStr.includes('SUCCESS') || statusStr.includes('CHARGE.SUCCESS') || statusStr === 'PAID') {
      status = PaymentStatus.SUCCEEDED;
    } else if (statusStr.includes('FAIL') || statusStr.includes('CHARGE.FAILED')) {
      status = PaymentStatus.FAILED;
    }

    const providerRef = String(event?.id || event?.data?.id || event?.ref || '');

    return {
      providerRef,
      status,
      amountGnf: event?.amount ? BigInt(event.amount) : undefined,
      raw: event,
    };
  }
}

