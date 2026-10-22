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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { ClientIp, CurrentUser, CurrentWorkspace, Public, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { AvailabilityService } from '../availability/availability.service';
import { projectEvent } from '../projects/project-activity';
import {
  ChooseNameDto,
  GenerateNamesDto,
  ListNamesDto,
  PublicNameTryDto,
  RunChecksDto,
  UpdateNameDto,
  VoteDto,
} from './names.dto';
import { NamesService } from './names.service';

@ApiTags('names')
@ApiBearerAuth()
@Controller()
export class NamesController {
  constructor(
    private readonly names: NamesService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  @Post('projects/:pid/names/generate')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async generate(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateNamesDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.names.generate(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
    await this.audit.log(projectEvent(pid, user.id, 'names.generate', { jobId: job.jobId }));
    return job;
  }

  @Get('projects/:pid/names')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string, @Query() q: ListNamesDto, @CurrentUser() user: AuthUser) {
    return this.names.list(pid, user.id, q);
  }

  @Patch('names/:nid')
  @WorkspaceAccess('EDITOR')
  update(@Param('nid', ParseUUIDPipe) nid: string, @Body() dto: UpdateNameDto, @CurrentUser() user: AuthUser) {
    return this.names.update(nid, user.id, dto);
  }

  @Post('names/:nid/checks')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  checks(@Param('nid', ParseUUIDPipe) nid: string, @Body() dto: RunChecksDto) {
    return this.availability.check(nid, dto.force ?? false);
  }

  @Post('names/:nid/votes')
  @WorkspaceAccess('VIEWER', { staff: undefined })
  @HttpCode(HttpStatus.OK)
  vote(@Param('nid', ParseUUIDPipe) nid: string, @CurrentUser() user: AuthUser, @Body() dto: VoteDto) {
    return this.names.vote(nid, user.id, dto.value);
  }

  @Post('projects/:pid/chosen-name')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  async choose(@Param('pid', ParseUUIDPipe) pid: string, @Body() dto: ChooseNameDto, @CurrentUser() user: AuthUser) {
    const project = await this.names.choose(pid, dto.nameId, user.id);
    await this.audit.log(projectEvent(pid, user.id, 'names.choose', { value: project.chosenName?.value }));
    return project;
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('public/names/try')
  @HttpCode(HttpStatus.OK)
  publicTry(@ClientIp() ip: string, @Body() dto: PublicNameTryDto) {
    return this.names.publicTry(ip, dto);
  }
}
