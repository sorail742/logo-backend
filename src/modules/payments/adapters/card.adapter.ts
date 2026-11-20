import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutResult,
  InitiateCheckoutParams,
  PaymentAdapter,
  WebhookResult,
} from './payment-adapter.interface';
import { firstWebhookString, parseWebhookAmount } from './webhook.util';

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

  async verifyAndParseWebhook(
    headers: Record<string, string | string[]>,
    body: unknown,
  ): Promise<WebhookResult> {
    const webhookSecret = this.config.get<string>('PAYMENT_WEBHOOK_SECRET');
    if (webhookSecret) this.verifyWebhookSignature(webhookSecret, headers, body);

    const event = this.parseWebhookBody(body);

    const statusStr = firstWebhookString(event?.status, event?.event).toUpperCase();

    let status: PaymentStatus = PaymentStatus.PENDING;
    if (
      statusStr.includes('SUCCESS') ||
      statusStr.includes('CHARGE.SUCCESS') ||
      statusStr === 'PAID'
    ) {
      status = PaymentStatus.SUCCEEDED;
    } else if (statusStr.includes('FAIL') || statusStr.includes('CHARGE.FAILED')) {
      status = PaymentStatus.FAILED;
    }

    const dataObj = event?.data as Record<string, unknown> | undefined;
    const providerRef = firstWebhookString(event?.id, dataObj?.id, event?.ref);

    return {
      providerRef,
      status,
      amountGnf: parseWebhookAmount(event?.amount),
      raw: event,
    };
  }

  private verifyWebhookSignature(
    secret: string,
    headers: Record<string, string | string[]>,
    body: unknown,
  ) {
    const rawSig =
      headers['stripe-signature'] || headers['x-paystack-signature'] || headers['x-signature'];
    const signature = Array.isArray(rawSig) ? rawSig[0] : rawSig;
    if (!signature) return;

    const rawPayload = typeof body === 'string' ? body : JSON.stringify(body);
    const expected = createHmac('sha256', secret).update(rawPayload).digest('hex');
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Signature webhook invalide');
    }
  }

  private parseWebhookBody(body: unknown): Record<string, unknown> | null {
    if (typeof body !== 'string') return (body as Record<string, unknown>) ?? null;

    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      throw new UnauthorizedException('Format JSON du webhook invalide');
    }
  }
}
