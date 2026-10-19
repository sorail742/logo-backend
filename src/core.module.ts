import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { redisConnection } from './common/utils/redis-connection.util';
import { validateEnv } from './config/env';
import { AiModule } from './modules/ai/ai.module';
import { AuditModule } from './modules/audit/audit.module';
import { CreditsModule } from './modules/credits/credits.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { MailModule } from './modules/mail/mail.module';
import { ModerationModule } from './modules/moderation/moderation.module';

/** Socle partagé par l'API et les workers : configuration, logs, base, Redis, files, services transverses. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get('NODE_ENV') === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          autoLogging: { ignore: (req) => req.url?.includes('/health') ?? false },
        },
      }),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: redisConnection(config.getOrThrow<string>('REDIS_URL')),
      }),
    }),
    PrismaModule,
    RedisModule,
    AuditModule,
    CreditsModule,
    MailModule,
    AiModule,
    ModerationModule,
    JobsModule,
  ],
})
export class CoreModule {}
