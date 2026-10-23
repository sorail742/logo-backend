import type { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CreditsService } from '../credits/credits.service';
import { StudioCutoutService } from './studio-cutout.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const IMAGE = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`;
const ctx = { projectId: 'p', workspaceId: 'w', actorId: 'u' };

function setup(apiKey: string | undefined) {
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
  } as unknown as Redis;
  const credits = { debit: jest.fn(), credit: jest.fn() } as unknown as CreditsService;
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as PrismaService;
  const config = { get: () => apiKey } as unknown as ConfigService<never, true>;
  const service = new StudioCutoutService(prisma, credits, redis, config);
  return { service, credits };
}

describe('détourage IA du Studio', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sans clé : non disponible (501)', async () => {
    const { service } = setup(undefined);
    expect(service.enabled).toBe(false);
    await expect(service.cutout(ctx, IMAGE, 'k')).rejects.toMatchObject({ status: 501 });
  });

  it('débite 1 crédit, renvoie le masque PNG et le garde pour la même clé', async () => {
    const { service, credits } = setup('cle');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
      );
    const first = await service.cutout(ctx, IMAGE, 'k1');
    expect(first.costCredits).toBe(1);
    expect(first.mask).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    const again = await service.cutout(ctx, IMAGE, 'k1');
    expect(again).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credits.debit).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0][1]!.body as FormData;
    expect(body.get('channels')).toBe('alpha');
  });

  it('fournisseur en échec : crédit rendu, 502', async () => {
    const { service, credits } = setup('cle');
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('quota', { status: 402 }));
    await expect(service.cutout(ctx, IMAGE, 'k2')).rejects.toMatchObject({ status: 502 });
    expect(credits.debit).toHaveBeenCalledTimes(1);
    expect(credits.credit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ delta: 1, reason: 'REFUND' }),
    );
  });

  it('image invalide ou clé d’idempotence absente : 400 sans débit', async () => {
    const { service, credits } = setup('cle');
    await expect(service.cutout(ctx, 'data:image/gif;base64,AAAA', 'k')).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.cutout(ctx, IMAGE, undefined)).rejects.toMatchObject({ status: 400 });
    expect(credits.debit).not.toHaveBeenCalled();
  });
});
