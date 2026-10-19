import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { ClientIp, CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { BriefDto, CreateProjectDto, ListProjectsDto, UpdateProjectDto } from './projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller()
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Get('workspaces/:wid/projects')
  @WorkspaceAccess('VIEWER')
  list(@Param('wid', ParseUUIDPipe) wid: string, @Query() q: ListProjectsDto) {
    return this.projects.list(wid, q);
  }

  @Post('workspaces/:wid/projects')
  @WorkspaceAccess('EDITOR')
  create(@Param('wid', ParseUUIDPipe) wid: string, @Body() dto: CreateProjectDto) {
    return this.projects.create(wid, dto);
  }

  @Get('projects/:pid')
  @WorkspaceAccess('VIEWER')
  get(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.get(pid);
  }

  @Patch('projects/:pid')
  @WorkspaceAccess('EDITOR')
  update(@Param('pid', ParseUUIDPipe) pid: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(pid, dto);
  }

  @Delete('projects/:pid')
  @WorkspaceAccess('OWNER', { staff: 'ADMIN' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('pid', ParseUUIDPipe) pid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string,
  ) {
    await this.projects.softDelete(pid);
    if (ws.role === null) {
      await this.audit.log({ actorId: user.id, action: 'project.delete', entityType: 'Project', entityId: pid, ip });
    }
  }

  @Post('projects/:pid/restore')
  @WorkspaceAccess('OWNER', { staff: 'ADMIN', includeDeleted: true })
  async restore(
    @Param('pid', ParseUUIDPipe) pid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string,
  ) {
    const project = await this.projects.restore(pid);
    if (ws.role === null) {
      await this.audit.log({ actorId: user.id, action: 'project.restore', entityType: 'Project', entityId: pid, ip });
    }
    return project;
  }

  @Post('projects/:pid/duplicate')
  @WorkspaceAccess('EDITOR')
  duplicate(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.duplicate(pid);
  }

  @Put('projects/:pid/brief')
  @WorkspaceAccess('EDITOR')
  brief(@Param('pid', ParseUUIDPipe) pid: string, @Body() dto: BriefDto) {
    return this.projects.upsertBrief(pid, dto);
  }
}
