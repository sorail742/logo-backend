import { Controller, Get, MessageEvent, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { concat, defer, from, map, Observable, of, switchMap, takeWhile } from 'rxjs';
import { WorkspaceAccess } from '../../common/decorators';
import { JobEventsService } from './job-events.service';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly events: JobEventsService,
  ) {}

  @Get(':jid')
  @WorkspaceAccess('VIEWER')
  get(@Param('jid', ParseUUIDPipe) jid: string) {
    return this.jobs.get(jid);
  }

  /** Flux SSE : état courant, puis chaque changement jusqu'à un état final. */
  @Sse(':jid/events')
  @WorkspaceAccess('VIEWER')
  events$(@Param('jid', ParseUUIDPipe) jid: string): Observable<MessageEvent> {
    const live$ = this.events.stream(jid);
    return defer(() => from(this.jobs.get(jid))).pipe(
      switchMap((job) => {
        const initial = { jobId: job.id, status: job.status, error: job.error ?? undefined };
        if (this.jobs.isTerminal(job.status)) return of(initial);
        return concat(
          of(initial),
          live$.pipe(takeWhile((e) => !this.jobs.isTerminal(e.status), true)),
        );
      }),
      map((data) => ({ type: 'job', data })),
    );
  }
}
