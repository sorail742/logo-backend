import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { EMAIL_QUEUE } from '../../shared/queues';
import { MailService } from './mail.service';

@Global()
@Module({
  imports: [BullModule.registerQueue({ name: EMAIL_QUEUE })],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
