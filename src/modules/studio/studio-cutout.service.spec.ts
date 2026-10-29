import type Redis from 'ioredis';
import sharp from 'sharp';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CreditsService } from '../credits/credits.service';
import { StudioCutoutService } from './studio-cutout.service';

const ctx = { projectId: 'p', workspaceId: 'w', actorId: 'u' };

function setup() {
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
  const service = new StudioCutoutService(prisma, credits, redis);
  return { service, credits };
}

describe('détourage local du Studio (Sharp)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('est toujours activé (100% local, sans clé externe)', () => {
    const { service } = setup();
    expect(service.enabled).toBe(true);
  });

  it('exige une clé d’idempotence', async () => {
    const { service } = setup();
    await expect(service.cutout(ctx, 'data:image/png;base64,abc', undefined)).rejects.toThrow();
  });

  it('traite une image PNG transparente localement et débite 1 crédit', async () => {
    const { service, credits } = setup();
    // Créer une petite image PNG 10x10 avec transparence via sharp
    const pngBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0.5 },
      },
    })
      .png()
      .toBuffer();

    const dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const result = await service.cutout(ctx, dataUrl, 'idemp-1');

    expect(result.costCredits).toBe(1);
    expect(result.mask).toMatch(/^data:image\/png;base64,/);
    expect(credits.debit).toHaveBeenCalledTimes(1);

    // Vérifier le cache idempotent
    const cached = await service.cutout(ctx, dataUrl, 'idemp-1');
    expect(cached).toEqual(result);
  });
});
