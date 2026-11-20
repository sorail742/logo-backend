import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let health: { check: jest.Mock };
  let indicator: { check: jest.Mock };
  let memory: { checkHeap: jest.Mock };
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };

  beforeEach(() => {
    health = {
      check: jest
        .fn()
        .mockImplementation((fns) => Promise.all(fns.map((fn: () => unknown) => fn()))),
    };
    indicator = {
      check: jest.fn().mockReturnValue({
        up: jest.fn().mockReturnValue({ status: 'up' }),
        down: jest.fn().mockImplementation((data) => ({ status: 'down', ...data })),
      }),
    };
    memory = { checkHeap: jest.fn().mockResolvedValue({ memory_heap: { status: 'up' } }) };
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]) };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };

    controller = new HealthController(
      health as never,
      indicator as never,
      memory as never,
      prisma as never,
      redis as never,
    );
  });

  describe('live', () => {
    it('retourne le statut ok', () => {
      expect(controller.live()).toEqual({ status: 'ok' });
    });
  });

  describe('ready', () => {
    it('exécute les sondes de base de données, redis et mémoire', async () => {
      await controller.ready();
      expect(health.check).toHaveBeenCalled();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(redis.ping).toHaveBeenCalled();
      expect(memory.checkHeap).toHaveBeenCalledWith('memory_heap', 1536 * 1024 * 1024);
    });
  });
});
