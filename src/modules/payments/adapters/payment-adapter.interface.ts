import { PaymentProvider, PaymentStatus } from '@prisma/client';

export interface InitiateCheckoutParams {
  paymentId: string;
  amountGnf: bigint;
  description: string;
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  returnUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  checkoutUrl?: string;
  providerRef: string;
  qrCodeUrl?: string;
  instructions?: string;
  raw?: unknown;
}

export interface WebhookResult {
  providerRef: string;
  status: PaymentStatus;
  amountGnf?: bigint;
  raw?: unknown;
}

export interface PaymentAdapter {
  readonly provider: PaymentProvider;
  initiateCheckout(params: InitiateCheckoutParams): Promise<CheckoutResult>;
  verifyAndParseWebhook(headers: Record<string, string | string[]>, body: any): Promise<WebhookResult>;
}

