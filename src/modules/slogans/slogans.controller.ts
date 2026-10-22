import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import { GenerateSlogansDto, UpdateSloganDto } from './slogans.dto';
import { SlogansService } from './slogans.service';

/** Module 3 — signature de marque : slogans, devises, phrases de mission (§6.1, §13.6). */
@ApiTags('slogans')
@ApiBearerAuth()
@Controller()
export class SlogansController {
  constructor(
    private readonly slogans: SlogansService,
    private readonly audit: AuditService,
  ) {}

  @Post('projects/:pid/slogans/generate')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async generate(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateSlogansDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.slogans.generate(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
    await this.audit.log(
      projectEvent(pid, user.id, 'slogans.generate', {
        jobId: job.jobId,
        kind: dto.kind ?? 'SLOGAN',
      }),
    );
    return job;
  }

  @Get('projects/:pid/slogans')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.slogans.list(pid);
  }

  @Patch('slogans/:sid')
  @WorkspaceAccess('EDITOR')
  async update(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: UpdateSloganDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const slogan = await this.slogans.update(sid, dto);
    if (dto.isChosen) {
      await this.audit.log(
        projectEvent(ws.projectId!, user.id, 'slogans.choose', { text: slogan.text }),
      );
    }
    return slogan;
  }
}
