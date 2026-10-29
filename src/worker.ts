import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';
import { frenchZodErrorMap } from './common/validation/validation-problem';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  z.setErrorMap(frenchZodErrorMap);
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker démarré');
}

void bootstrap();
