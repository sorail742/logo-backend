import { UnauthorizedException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { CardPaymentAdapter } from './card.adapter';

describe('CardPaymentAdapter', () => {
  const secret = 'webhook-secret';

  it('accepte une signature HMAC valide et normalise le webhook', async () => {
    const config = { get: jest.fn((key: string) => (key === 'PAYMENT_WEBHOOK_SECRET' ? secret : undefined)) };
    const adapter = new CardPaymentAdapter(config as never);
    const body = JSON.stringify({ status: 'success', id: 'card-ref-1' });
    const signature = createHmac('sha256', secret).update(body).digest('hex');

    const result = await adapter.verifyAndParseWebhook({ 'x-signature': signature }, body);

    expect(result).toEqual({
      providerRef: 'card-ref-1',
      status: PaymentStatus.SUCCEEDED,
      amountGnf: undefined,
      raw: { status: 'success', id: 'card-ref-1' },
    });
  });

  it('rejette une signature invalide', async () => {
    const config = { get: jest.fn(() => secret) };
    const adapter = new CardPaymentAdapter(config as never);

    await expect(
      adapter.verifyAndParseWebhook({ 'x-signature': 'invalid' }, '{"status":"success"}'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejette un corps JSON mal formé', async () => {
    const config = { get: jest.fn(() => undefined) };
    const adapter = new CardPaymentAdapter(config as never);

    await expect(adapter.verifyAndParseWebhook({}, '{')).rejects.toThrow(UnauthorizedException);
  });
});