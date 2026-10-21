import {
  ForbiddenException,
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
import { WorkspaceRole } from '@prisma/client';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { ClientIp, CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from './project-activity';
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
  list(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Query() q: ListProjectsDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    // La corbeille relève de qui peut supprimer et restaurer : propriétaire, ou admin.
    if (q.trash && ws.role !== WorkspaceRole.OWNER && !(ws.role === null && user.role !== 'SUPPORT')) {
      throw new ForbiddenException('La corbeille est réservée au propriétaire de l’espace');
    }
    return this.projects.list(wid, user.id, q);
  }

  @Post('workspaces/:wid/projects')
  @WorkspaceAccess('EDITOR')
  async create(
    @Param('wid', ParseUUIDPipe) wid: string,
    @Body() dto: CreateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    const project = await this.projects.create(wid, user.id, dto);
    await this.audit.log(projectEvent(project.id, user.id, 'project.create'));
    return project;
  }

  @Get('projects/:pid')
  @WorkspaceAccess('VIEWER')
  get(@Param('pid', ParseUUIDPipe) pid: string, @CurrentUser() user: AuthUser) {
    return this.projects.get(pid, user.id);
  }

  @Patch('projects/:pid')
  @WorkspaceAccess('EDITOR')
  update(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.update(pid, user.id, dto);
  }

  @Get('projects/:pid/activity')
  @WorkspaceAccess('VIEWER')
  activity(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.projects.activity(pid);
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
    // Historique du projet ; l'adresse IP n'est conservée que pour une action du personnel.
    await this.audit.log(projectEvent(pid, user.id, 'project.delete', undefined, ws.role === null ? ip : undefined));
  }

  @Post('projects/:pid/restore')
  @WorkspaceAccess('OWNER', { staff: 'ADMIN', includeDeleted: true })
  async restore(
    @Param('pid', ParseUUIDPipe) pid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @ClientIp() ip: string,
  ) {
    const project = await this.projects.restore(pid, user.id);
    await this.audit.log(projectEvent(pid, user.id, 'project.restore', undefined, ws.role === null ? ip : undefined));
    return project;
  }

  @Post('projects/:pid/duplicate')
  @WorkspaceAccess('EDITOR')
  duplicate(@Param('pid', ParseUUIDPipe) pid: string, @CurrentUser() user: AuthUser) {
    return this.projects.duplicate(pid, user.id);
  }

  @Put('projects/:pid/brief')
  @WorkspaceAccess('EDITOR')
  async brief(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: BriefDto,
    @CurrentUser() user: AuthUser,
  ) {
    const project = await this.projects.upsertBrief(pid, user.id, dto);
    await this.audit.log(projectEvent(pid, user.id, 'project.brief'));
    return project;
  }
}
