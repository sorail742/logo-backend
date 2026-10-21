import { Controller, Get, MessageEvent, Param, ParseUUIDPipe, Sse } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  concat,
  defer,
  distinctUntilChanged,
  from,
  interval,
  map,
  merge,
  Observable,
  of,
  switchMap,
  takeWhile,
} from 'rxjs';
import type { WorkspaceContext } from '../../common/auth-user';
import { CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
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
  get(@Param('jid', ParseUUIDPipe) jid: string, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.jobs.get(jid, { canDownload: ws.canDownload });
  }

  /**
   * Flux SSE : état courant, puis chaque changement jusqu'à un état final. Une tâche peut se
   * terminer entre la lecture de son état et l'abonnement Redis : l'état est donc aussi relu
   * toutes les 2 s, pour ne jamais manquer la fin.
   */
  @Sse(':jid/events')
  @WorkspaceAccess('VIEWER')
  events$(@Param('jid', ParseUUIDPipe) jid: string): Observable<MessageEvent> {
    const read = () =>
      from(this.jobs.get(jid)).pipe(
        map((job) => ({ jobId: job.id, status: job.status, error: job.error ?? undefined })),
      );
    const live$ = this.events.stream(jid);
    const poll$ = interval(2000).pipe(switchMap(read));
    return defer(read).pipe(
      switchMap((initial) => {
        if (this.jobs.isTerminal(initial.status)) return of(initial);
        return concat(of(initial), merge(live$, poll$)).pipe(
          distinctUntilChanged((a, b) => a.status === b.status),
          takeWhile((e) => !this.jobs.isTerminal(e.status), true),
        );
      }),
      map((data) => ({ type: 'job', data })),
    );
  }
}
