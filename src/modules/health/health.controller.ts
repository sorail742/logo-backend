import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS } from '../../common/redis/redis.module';

/** Sondes pour l'hébergeur (§11.3). */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Vivacité : le processus répond. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Disponibilité : base de données, Redis joignables et mémoire sous contrôle. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.probe('database', () => this.prisma.$queryRaw`SELECT 1`),
      () => this.probe('redis', () => this.redis.ping()),
      () => this.memory.checkHeap('memory_heap', 1536 * 1024 * 1024),
    ]);
  }

  private async probe(key: string, fn: () => Promise<unknown>) {
    const check = this.indicator.check(key);
    try {
      await fn();
      return check.up();
    } catch (err) {
      return check.down({ message: String(err) });
    }
  }
}
