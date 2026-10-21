import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import {
  ClientIp,
  CurrentUser,
  CurrentWorkspace,
  Public,
  Roles,
  WorkspaceAccess,
} from '../../common/decorators';
import {
  BatchSignaturesDto,
  CreateSignatureDto,
  HandwritingProposalsDto,
  PublicEmailSignatureDto,
  ReviewSignatureDto,
  SignatureFileQueryDto,
  UpdateSignatureDto,
} from './signatures.dto';
import { SignaturesService } from './signatures.service';

/** Signatures e-mail, paraphes et cachets (§6.2 à §6.4, §13.6). */
@ApiTags('signatures')
@ApiBearerAuth()
@Controller()
export class SignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Post('projects/:pid/signatures')
  @WorkspaceAccess('EDITOR')
  create(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: CreateSignatureDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.signatures.create(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
  }

  @Get('projects/:pid/signatures')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string) {
    return this.signatures.list(pid);
  }

  @Post('projects/:pid/signatures/handwritten/proposals')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  proposals(@Param('pid', ParseUUIDPipe) _pid: string, @Body() dto: HandwritingProposalsDto) {
    return this.signatures.handwritingProposals(dto.fullName, dto.ink);
  }

  @Post('projects/:pid/signatures/batch')
  @WorkspaceAccess('EDITOR')
  batch(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: BatchSignaturesDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.signatures.batch(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
  }

  @Get('signatures/:sid')
  @WorkspaceAccess('VIEWER')
  get(@Param('sid', ParseUUIDPipe) sid: string) {
    return this.signatures.get(sid);
  }

  @Patch('signatures/:sid')
  @WorkspaceAccess('EDITOR')
  update(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: UpdateSignatureDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.signatures.update(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      sid,
      dto,
    );
  }

  @Get('signatures/:sid/html')
  @WorkspaceAccess('VIEWER')
  html(@Param('sid', ParseUUIDPipe) sid: string) {
    return this.signatures.html(sid);
  }

  @Get('signatures/:sid/file')
  @WorkspaceAccess('EDITOR')
  file(@Param('sid', ParseUUIDPipe) sid: string, @Query() q: SignatureFileQueryDto) {
    return this.signatures.file(sid, q.format);
  }
}

/** Accès public : essai sans compte et images des signatures e-mail. */
@ApiTags('signatures')
@Public()
@Controller('public')
export class PublicSignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Post('email-signature')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  tryEmail(@ClientIp() ip: string, @Body() dto: PublicEmailSignatureDto) {
    return this.signatures.publicEmail(ip, dto);
  }

  /** Images référencées par les signatures e-mail ; nom immuable, cache long. */
  @Get('signature-assets/:sid/:file')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  async asset(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Param('file') file: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const png = await this.signatures.publicAsset(sid, file);
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(png);
  }
}

/** Cachets en validation manuelle (§6.4, ADM-12, §13.9). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('SUPPORT')
@Controller('admin')
export class AdminSignaturesController {
  constructor(private readonly signatures: SignaturesService) {}

  @Get('moderation')
  moderation() {
    return this.signatures.pendingReview();
  }

  @Patch('signatures/:sid/review')
  review(
    @Param('sid', ParseUUIDPipe) sid: string,
    @Body() dto: ReviewSignatureDto,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string,
  ) {
    return this.signatures.review(user.id, sid, dto.decision, dto.note, ip);
  }
}
