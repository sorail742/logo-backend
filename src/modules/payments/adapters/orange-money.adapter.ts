import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentProvider, PaymentStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import type {
  CheckoutResult,
  InitiateCheckoutParams,
  PaymentAdapter,
  WebhookResult,
} from './payment-adapter.interface';
import { firstWebhookString, parseWebhookAmount } from './webhook.util';

/**
 * Adaptateur Orange Money Web Payment (PAY-01).
 * Supporte les paiements mobiles Orange Money en Guinée (GNF).
 * Bascule en mode simulation / bac à sable si les identifiants d'API ne sont pas configurés.
 */
@Injectable()
export class OrangeMoneyAdapter implements PaymentAdapter {
  readonly provider = PaymentProvider.ORANGE_MONEY;
  private readonly logger = new Logger(OrangeMoneyAdapter.name);

  constructor(private readonly config: ConfigService) {}

  async initiateCheckout(params: InitiateCheckoutParams): Promise<CheckoutResult> {
    const clientId = this.config.get<string>('ORANGE_MONEY_CLIENT_ID');
    const clientSecret = this.config.get<string>('ORANGE_MONEY_CLIENT_SECRET');
    const merchantKey = this.config.get<string>('ORANGE_MONEY_MERCHANT_KEY');
    const apiUrl = this.config.get<string>('ORANGE_MONEY_API_URL') ?? 'https://api.orange.com';

    // Mode réel avec identifiants Orange Money Developer
    if (clientId && clientSecret && merchantKey) {
      try {
        const credentials = Buffer.from([clientId, clientSecret].join(':')).toString('base64');
        const tokenRes = await fetch(`${apiUrl}/oauth/v3/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        if (!tokenRes.ok) {
          throw new Error(`Échec authentification Orange Money (${tokenRes.status})`);
        }
        const { access_token } = (await tokenRes.json()) as { access_token: string };

        const returnUrl = params.returnUrl ?? `${this.config.get('APP_URL')}/app/billing/success`;
        const cancelUrl = params.cancelUrl ?? `${this.config.get('APP_URL')}/app/billing/cancel`;
        const notifUrl = `${this.config.get('API_URL')}/api/v1/payments/webhooks/ORANGE_MONEY`;

        const initRes = await fetch(`${apiUrl}/orange-money-webpay/gn/v1/webpayment`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            merchant_key: merchantKey,
            currency: 'GNF',
            order_id: params.paymentId,
            amount: Number(params.amountGnf),
            return_url: returnUrl,
            cancel_url: cancelUrl,
            notif_url: notifUrl,
            lang: 'fr',
            reference: `BrandID-${params.paymentId.slice(0, 8)}`,
          }),
        });

        if (!initRes.ok) {
          const errText = await initRes.text();
          throw new Error(`Échec initialisation OM WebPay : ${errText}`);
        }

        const data = (await initRes.json()) as {
          payment_url?: string;
          pay_token: string;
          notif_token?: string;
        };

        return {
          checkoutUrl: data.payment_url,
          providerRef: data.pay_token,
          raw: data,
        };
      } catch (err) {
        this.logger.error(`Erreur Orange Money : ${(err as Error).message}`);
        throw err;
      }
    }

    // Mode simulation / bac à sable
    const mockRef = `OM-SIM-${Date.now()}-${randomBytes(4).toString('hex')}`;
    const appUrl = this.config.get('APP_URL') ?? 'http://localhost:3000';
    const mockCheckoutUrl = `${appUrl}/app/billing/mock-checkout?paymentId=${params.paymentId}&ref=${mockRef}`;

    return {
      checkoutUrl: mockCheckoutUrl,
      providerRef: mockRef,
      instructions:
        'Paiement Orange Money : composez *144# ou validez sur l’application Orange Money.',
      raw: { mode: 'sandbox', simulated: true },
    };
  }

  async verifyAndParseWebhook(
    _headers: Record<string, string | string[]>,
    body: unknown,
  ): Promise<WebhookResult> {
    let payload: Record<string, unknown> | null = null;
    if (typeof body === 'string') {
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return { providerRef: '', status: PaymentStatus.FAILED, raw: null };
      }
    } else {
      payload = (body as Record<string, unknown>) ?? null;
    }
    const statusStr = firstWebhookString(payload?.status).toUpperCase();
    let status: PaymentStatus = PaymentStatus.PENDING;

    if (statusStr === 'SUCCESS' || statusStr === 'SUCCEEDED' || statusStr === '200') {
      status = PaymentStatus.SUCCEEDED;
    } else if (statusStr === 'FAILED' || statusStr === 'CANCELLED' || statusStr === 'EXPIRED') {
      status = PaymentStatus.FAILED;
    }

    const providerRef = firstWebhookString(
      payload?.pay_token,
      payload?.notif_token,
      payload?.txnid,
      payload?.ref,
    );
    return {
      providerRef,
      status,
      amountGnf: parseWebhookAmount(payload?.amount),
      raw: payload,
    };
  }
}
