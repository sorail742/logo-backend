import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import Redis from 'ioredis';
import { Observable, Subject } from 'rxjs';
import { REDIS } from '../../common/redis/redis.module';
import { jobEventsChannel } from '../../shared/queues';

export interface JobEvent {
  jobId: string;
  status: JobStatus;
  progress?: number;
  error?: string;
}

/**
 * Diffusion des changements d'état des tâches entre workers et API via Redis pub/sub,
 * relayés au front par SSE (§11.4 étape 5).
 */
@Injectable()
export class JobEventsService implements OnModuleDestroy {
  private subscriber: Redis | null = null;
  private readonly listeners = new Map<string, Set<Subject<JobEvent>>>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  publish(event: JobEvent) {
    return this.redis.publish(jobEventsChannel(event.jobId), JSON.stringify(event));
  }

  stream(jobId: string): Observable<JobEvent> {
    return new Observable<JobEvent>((observer) => {
      const channel = jobEventsChannel(jobId);
      const subject = new Subject<JobEvent>();
      const sub = subject.subscribe(observer);

      const sock = this.getSubscriber();
      let set = this.listeners.get(channel);
      if (!set) {
        set = new Set();
        this.listeners.set(channel, set);
        void sock.subscribe(channel);
      }
      set.add(subject);

      return () => {
        sub.unsubscribe();
        set.delete(subject);
        if (set.size === 0) {
          this.listeners.delete(channel);
          void sock.unsubscribe(channel);
        }
      };
    });
  }

  private getSubscriber(): Redis {
    if (!this.subscriber) {
      this.subscriber = this.redis.duplicate();
      this.subscriber.on('message', (channel: string, message: string) => {
        const event = JSON.parse(message) as JobEvent;
        this.listeners.get(channel)?.forEach((s) => s.next(event));
      });
    }
    return this.subscriber;
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
  }
}
