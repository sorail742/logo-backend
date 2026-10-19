import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { GENERATION_QUEUE } from '../../shared/queues';
import { JobEventsService } from './job-events.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: GENERATION_QUEUE })],
  controllers: [JobsController],
  providers: [JobsService, JobEventsService],
  exports: [JobsService, JobEventsService],
})
export class JobsModule {}
