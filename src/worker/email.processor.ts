import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { createTransport, Transporter } from 'nodemailer';
import { EMAIL_QUEUE, EmailJobData } from '../shared/queues';

@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    super();
    const user = config.get<string>('SMTP_USER');
    this.transport = createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure: config.getOrThrow<number>('SMTP_PORT') === 465,
      auth: user ? { user, pass: config.get<string>('SMTP_PASSWORD') } : undefined,
    });
    this.from = config.getOrThrow<string>('MAIL_FROM');
  }

  async process(job: Job<EmailJobData>) {
    const { to, subject, html, text } = job.data;
    const info = await this.transport.sendMail({ from: this.from, to, subject, html, text });
    return { messageId: info.messageId };
  }
}
