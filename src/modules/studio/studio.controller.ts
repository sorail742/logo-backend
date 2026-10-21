import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import {
  CreateStudioDesignDto,
  ExportStudioDesignDto,
  GenerateStudioImagesDto,
  UpdateStudioDesignDto,
} from './studio.dto';
import { StudioImagesService } from './studio-images.service';
import { StudioService } from './studio.service';

/** Studio de création : documents de pages et d'éléments, exports d'impression. */
@ApiTags('studio')
@ApiBearerAuth()
@Controller()
export class StudioController {
  constructor(
    private readonly studio: StudioService,
    private readonly images: StudioImagesService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:pid/studio-designs')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.studio.list(pid);
  }

  @Post('projects/:pid/studio-designs')
  @WorkspaceAccess('EDITOR')
  async create(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: CreateStudioDesignDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const design = await this.studio.create(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
    await this.audit.log(projectEvent(pid, user.id, 'studio.create', { name: design.name }));
    return design;
  }

  /** Lot de 4 images (1 crédit, quota gratuit quotidien), produit par le worker. */
  @Post('projects/:pid/studio-images')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async generateImages(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateStudioImagesDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.images.request(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
    await this.audit.log(
      projectEvent(pid, user.id, 'studio.images', { style: dto.style, jobId: job.jobId }),
    );
    return job;
  }

  @Get('studio-designs/:sdid')
  @WorkspaceAccess('VIEWER')
  get(@Param('sdid', ParseUUIDPipe) sdid: string) {
    return this.studio.get(sdid);
  }

  /** Sauvegarde automatique de l'éditeur : débit plus large que la limite générale. */
  @Put('studio-designs/:sdid')
  @WorkspaceAccess('EDITOR')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  update(@Param('sdid', ParseUUIDPipe) sdid: string, @Body() dto: UpdateStudioDesignDto) {
    return this.studio.update(sdid, dto);
  }

  @Post('studio-designs/:sdid/duplicate')
  @WorkspaceAccess('EDITOR')
  duplicate(@Param('sdid', ParseUUIDPipe) sdid: string, @CurrentUser() user: AuthUser) {
    return this.studio.duplicate(sdid, user.id);
  }

  @Delete('studio-designs/:sdid')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('sdid', ParseUUIDPipe) sdid: string) {
    return this.studio.remove(sdid);
  }

  @Post('studio-designs/:sdid/export')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  async export(
    @Param('sdid', ParseUUIDPipe) sdid: string,
    @Body() dto: ExportStudioDesignDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.studio.requestExport(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      sdid,
      dto,
      idempotencyKey ?? randomUUID(),
    );
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'studio.export', {
        format: dto.format,
        jobId: job.jobId,
      }),
    );
    return job;
  }
}
