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
import { randomUUID } from 'node:crypto';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import {
  ExportLogoDto,
  GenerateLogosDto,
  ImportLogoDto,
  ListLogosDto,
  LogoVariantsDto,
  SaveVersionDto,
  UpdateLogoDto,
} from './logos.dto';
import { LogosService } from './logos.service';

/** Module 2 — logos (§5, §13.5). */
@ApiTags('logos')
@ApiBearerAuth()
@Controller()
export class LogosController {
  constructor(
    private readonly logos: LogosService,
    private readonly audit: AuditService,
  ) {}

  @Post('projects/:pid/logos/generate')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async generate(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateLogosDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.logos.generate(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
    await this.audit.log(projectEvent(pid, user.id, 'logos.generate', { jobId: job.jobId }));
    return job;
  }

  @Post('projects/:pid/logos/import')
  @WorkspaceAccess('EDITOR')
  async importLogo(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: ImportLogoDto,
    @CurrentUser() user: AuthUser,
  ) {
    const logo = await this.logos.importLogo(pid, dto);
    await this.audit.log(projectEvent(pid, user.id, 'logos.import', { logoId: logo.id }));
    return logo;
  }

  @Get('projects/:pid/logos')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string, @Query() dto: ListLogosDto) {
    return this.logos.list(pid, dto);
  }

  @Get('logos/:lid')
  @WorkspaceAccess('VIEWER')
  get(@Param('lid', ParseUUIDPipe) lid: string) {
    return this.logos.get(lid);
  }

  @Patch('logos/:lid')
  @WorkspaceAccess('EDITOR')
  update(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: UpdateLogoDto) {
    return this.logos.update(lid, dto);
  }

  @Get('logos/:lid/versions')
  @WorkspaceAccess('VIEWER')
  versions(@Param('lid', ParseUUIDPipe) lid: string) {
    return this.logos.versions(lid);
  }

  @Post('logos/:lid/versions')
  @WorkspaceAccess('EDITOR')
  async saveVersion(
    @Param('lid', ParseUUIDPipe) lid: string,
    @Body() dto: SaveVersionDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const version = await this.logos.saveVersion(lid, dto);
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'logos.version', { logoId: lid, number: version.number }),
    );
    return version;
  }

  @Post('logos/:lid/variants')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  variants(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: LogoVariantsDto) {
    return this.logos.variants(lid, dto.versionId, dto.transparent);
  }

  @Post('logos/:lid/export')
  @WorkspaceAccess('EDITOR', { download: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  async export(
    @Param('lid', ParseUUIDPipe) lid: string,
    @Body() dto: ExportLogoDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Un export ne débite pas de crédits : la clé d'idempotence est facultative.
    const job = await this.logos.requestExport(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      lid,
      dto,
      idempotencyKey ?? randomUUID(),
    );
    await this.audit.log(projectEvent(ws.projectId!, user.id, 'logos.export', { logoId: lid, jobId: job.jobId }));
    return job;
  }
}
