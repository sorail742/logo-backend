import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, Public, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import { ShareKitDto } from './brand-kits.dto';
import { BrandKitsService } from './brand-kits.service';

/** Téléchargement des livrables : Éditeur et Propriétaire (§3, « Lecteur : si autorisé »). */

/** Module 4 — kit de marque (§7.1, §13.7). */
@ApiTags('brand-kits')
@ApiBearerAuth()
@Controller()
export class BrandKitsController {
  constructor(
    private readonly kits: BrandKitsService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:pid/brand-kits')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.kits.list(pid, ws.canDownload);
  }

  @Post('projects/:pid/brand-kits')
  @WorkspaceAccess('EDITOR')
  async create(
    @Param('pid', ParseUUIDPipe) pid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const kit = await this.kits.create({
      projectId: pid,
      workspaceId: ws.workspaceId,
      actorId: user.id,
    });
    await this.audit.log(projectEvent(pid, user.id, 'kits.create', { version: kit.version }));
    return kit;
  }

  @Get('brand-kits/:kid')
  @WorkspaceAccess('VIEWER')
  get(@Param('kid', ParseUUIDPipe) kid: string, @CurrentWorkspace() ws: WorkspaceContext) {
    return this.kits.get(kid, ws.canDownload);
  }

  @Post('brand-kits/:kid/restore')
  @WorkspaceAccess('EDITOR')
  async restore(
    @Param('kid', ParseUUIDPipe) kid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const kit = await this.kits.restore(kid);
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'kits.restore', {
        version: kit.version,
        from: kit.restoredFrom,
      }),
    );
    return kit;
  }

  @Post('brand-kits/:kid/guide')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async guide(
    @Param('kid', ParseUUIDPipe) kid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const job = await this.kits.requestGuide(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      kid,
      idempotencyKey,
    );
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'kits.guide', { kitId: kid, jobId: job.jobId }),
    );
    return job;
  }

  @Post('brand-kits/:kid/zip')
  @WorkspaceAccess('EDITOR', { download: true })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  async zip(
    @Param('kid', ParseUUIDPipe) kid: string,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // L'archive ne débite pas de crédits : la clé d'idempotence est facultative.
    const job = await this.kits.requestZip(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      kid,
      idempotencyKey ?? randomUUID(),
    );
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'kits.zip', { kitId: kid, jobId: job.jobId }),
    );
    return job;
  }

  @Post('brand-kits/:kid/share')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  async share(
    @Param('kid', ParseUUIDPipe) kid: string,
    @Body() dto: ShareKitDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const kit = await this.kits.share(kid, dto);
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'kits.share', {
        version: kit.version,
        enabled: dto.enabled,
        password: !!dto.password,
        expiresAt: kit.shareExpiresAt,
      }),
    );
    return kit;
  }
}

/** Page publique d'un kit partagé (KIT-05) ; débit limité contre les essais de mot de passe. */
@ApiTags('brand-kits')
@Public()
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('public/kits')
export class PublicKitController {
  constructor(private readonly kits: BrandKitsService) {}

  @Get(':token')
  @ApiHeader({ name: 'X-Kit-Password', required: false })
  get(@Param('token') token: string, @Headers('x-kit-password') password?: string) {
    return this.kits.publicKit(token, password || undefined);
  }
}
