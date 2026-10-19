import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { EMAIL_QUEUE, EmailJobData } from '../../shared/queues';

/** Les e-mails transactionnels passent par la file BullMQ, envoyés par le worker (§11.1). */
@Injectable()
export class MailService {
  constructor(
    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJobData>,
    private readonly config: ConfigService,
  ) {}

  private link(path: string) {
    return `${this.config.getOrThrow<string>('APP_URL')}${path}`;
  }

  send(data: EmailJobData) {
    return this.queue.add('send', data, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 1000,
    });
  }

  sendEmailVerification(to: string, token: string) {
    const url = this.link(`/verifier-email?token=${encodeURIComponent(token)}`);
    return this.send({
      to,
      subject: 'Confirmez votre adresse e-mail',
      html: `<p>Bienvenue !</p><p>Confirmez votre adresse en cliquant sur ce lien :</p><p><a href="${url}">${url}</a></p>`,
      text: `Confirmez votre adresse : ${url}`,
    });
  }

  sendPasswordReset(to: string, token: string) {
    const url = this.link(`/mot-de-passe/reinitialiser?token=${encodeURIComponent(token)}`);
    return this.send({
      to,
      subject: 'Réinitialisation de votre mot de passe',
      html: `<p>Ce lien est valable 30 minutes et ne peut servir qu'une fois :</p><p><a href="${url}">${url}</a></p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
      text: `Réinitialisez votre mot de passe (valable 30 min) : ${url}`,
    });
  }

  sendInvitation(to: string, workspaceName: string, token: string) {
    const url = this.link(`/invitations/${encodeURIComponent(token)}`);
    return this.send({
      to,
      subject: `Invitation à rejoindre « ${workspaceName} »`,
      html: `<p>Vous êtes invité à rejoindre l'espace <strong>${escapeHtml(workspaceName)}</strong>.</p><p><a href="${url}">Accepter l'invitation</a></p>`,
      text: `Rejoindre l'espace ${workspaceName} : ${url}`,
    });
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
