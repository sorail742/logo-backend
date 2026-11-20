import { BadRequestException } from '@nestjs/common';
import { firstWebhookString, parseWebhookAmount } from './webhook.util';

describe('firstWebhookString', () => {
  it('retourne le premier champ texte ou numérique valide', () => {
    expect(firstWebhookString(undefined, { id: 'invalid' }, '  REF-123  ', 'other')).toBe('REF-123');
    expect(firstWebhookString(false, 200)).toBe('200');
  });

  it('ignore les valeurs non scalaires', () => {
    expect(firstWebhookString({}, [], false)).toBe('');
  });
});

describe('parseWebhookAmount', () => {
  it.each([
    ['0', 0n],
    [0, 0n],
    ['125000', 125000n],
    [125000, 125000n],
  ])('parses valid integer amounts', (value, expected) => {
    expect(parseWebhookAmount(value)).toBe(expected);
  });

  it.each([undefined, null])('allows an omitted amount: %s', (value) => {
    expect(parseWebhookAmount(value)).toBeUndefined();
  });

  it.each(['', '12.5', 'not-an-amount', -1, Number.MAX_SAFE_INTEGER + 1, {}])(
    'rejects malformed amounts: %p',
    (value) => {
      expect(() => parseWebhookAmount(value)).toThrow(BadRequestException);
    },
  );
});