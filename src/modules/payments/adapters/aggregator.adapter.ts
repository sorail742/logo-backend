import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type { CheckoutResult, InitiateCheckoutParams, PaymentAdapter, WebhookResult } from './payment-adapter.interface';

/**
 * Adaptateur Agrégateur Mobile Money multi-opérateurs (PAY-01).
 * Utilisable pour PayCard, Dexchange, CinetPay ou TouchPay.
 */
@Injectable()
export class AggregatorPaymentAdapter implements PaymentAdapter {
  readonly provider = PaymentProvider.MOBILE_MONEY_AGGREGATOR;
  private readonly logger = new Logger(AggregatorPaymentAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async initiateCheckout(params: InitiateCheckoutParams): Promise<CheckoutResult> {
    const mockRef = `AGG-SIM-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const appUrl = this.config.get('APP_URL') ?? 'http://localhost:3000';
    const mockCheckoutUrl = `${appUrl}/app/billing/mock-checkout?paymentId=${params.paymentId}&ref=${mockRef}`;

    return {
      checkoutUrl: mockCheckoutUrl,
      providerRef: mockRef,
      instructions: 'Paiement via agrégateur Mobile Money (Orange Money, MTN, Moov).',
      raw: { mode: 'sandbox', simulated: true },
    };
  }

  async verifyAndParseWebhook(_headers: Record<string, string | string[]>, body: any): Promise<WebhookResult> {
    const event = typeof body === 'string' ? JSON.parse(body) : body;
    const statusStr = String(event?.status || event?.state || '').toUpperCase();

    let status: PaymentStatus = PaymentStatus.PENDING;
    if (statusStr === 'ACCEPTED' || statusStr === 'SUCCEEDED' || statusStr === 'SUCCESS' || statusStr === 'COMPLETED') {
      status = PaymentStatus.SUCCEEDED;
    } else if (statusStr === 'REFUSED' || statusStr === 'FAILED' || statusStr === 'CANCELED') {
      status = PaymentStatus.FAILED;
    }

    const providerRef = String(event?.transaction_id || event?.cpm_trans_id || event?.ref || '');

    return {
      providerRef,
      status,
      amountGnf: event?.amount ? BigInt(event.amount) : undefined,
      raw: event,
    };
  }
}

