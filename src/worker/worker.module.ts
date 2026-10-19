import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CoreModule } from '../core.module';
import { NamesModule } from '../modules/names/names.module';
import { EMAIL_QUEUE, MAINTENANCE_QUEUE } from '../shared/queues';
import { EmailProcessor } from './email.processor';
import { GenerationProcessor } from './generation.processor';
import { MaintenanceProcessor } from './maintenance.processor';

/** Processus autonome de consommation des files BullMQ, ajoutable à chaud (§10, §11.2). */
@Module({
  imports: [
    CoreModule,
    BullModule.registerQueue({ name: EMAIL_QUEUE }, { name: MAINTENANCE_QUEUE }),
    NamesModule,
  ],
  providers: [GenerationProcessor, EmailProcessor, MaintenanceProcessor],
})
export class WorkerModule {}
