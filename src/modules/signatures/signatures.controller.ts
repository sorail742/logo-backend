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
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, Public, WorkspaceAccess } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { projectEvent } from '../projects/project-activity';
import {
  BatchSignaturesDto,
  CreateSignatureDto,
  PublicEmailSignatureDto,
  UpdateSignatureDto,
} from './signatures.dto';
import { SignaturesService } from './signatures.service';

/** Module 3 — signatures e-mail, paraphes et cachets (§6.2 à 6.4, §13.6). */
@ApiTags('signatures')
@ApiBearerAuth()
@Controller()
export class SignaturesController {
  constructor(
    private readonly signatures: SignaturesService,
    private readonly audit: AuditService,
  ) {}

  @Get('projects/:pid/signatures')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.signatures.list(pid);
  }

  @Post('projects/:pid/signatures')
  @WorkspaceAccess('EDITOR')
  async create(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: CreateSignatureDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const signature = await this.signatures.create(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
    await this.audit.log(projectEvent(pid, user.id, 'signatures.create', { kind: dto.kind }));
    return signature;
  }

  @Post('projects/:pid/signatures/batch')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  async batch(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: BatchSignaturesDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Gratuit en crédits : la clé d'idempotence est facultative.
    const result = await this.signatures.batch(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey ?? randomUUID(),
    );
    await this.audit.log(projectEvent(pid, user.id, 'signatures.batch', result));
    return result;
  }

  @Get('signatures/:sid')
  @WorkspaceAccess('VIEWER')
  get(@Param('sid', ParseUUIDPipe) sid: string) {
    return this.signatures.get(sid);
  }

  @Patch('signatures/:sid')
  @WorkspaceAccess('EDITOR')
  async update(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: UpdateSignatureDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    const signature = await this.signatures.update(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      sid,
      dto,
    );
    await this.audit.log(
      projectEvent(ws.projectId!, user.id, 'signatures.update', { kind: signature.kind }),
    );
    return signature;
  }

  @Get('signatures/:sid/html')
  @WorkspaceAccess('VIEWER')
  html(@Param('sid', ParseUUIDPipe) sid: string) {
    return this.signatures.html(sid);
  }

  @Get('signatures/:sid/file')
  @WorkspaceAccess('EDITOR')
  file(@Param('sid', ParseUUIDPipe) sid: string) {
    return this.signatures.fileUrl(sid);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/email-signature')
  @HttpCode(HttpStatus.OK)
  publicEmail(@Body() dto: PublicEmailSignatureDto) {
    return this.signatures.publicEmail(dto);
  }

  /** Logo des signatures e-mail : les messageries chargent l'image sans authentification. */
  @Public()
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @Get('public/signatures/:sid/logo.png')
  async logo(@Param('sid', ParseUUIDPipe) sid: string, @Res() res: Response) {
    const png = await this.signatures.logoPng(sid);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    // Affichée par les webmails et l'aperçu du front, servis depuis d'autres origines.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.type('image/png').send(png);
  }
}
