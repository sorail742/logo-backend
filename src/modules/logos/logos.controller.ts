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
import {
  ExportLogoDto,
  GenerateLogosDto,
  ImportLogoDto,
  ListLogosDto,
  SaveVersionDto,
  UpdateLogoDto,
  VariantsDto,
} from './logos.dto';
import { LogosService } from './logos.service';

/** Module 2 — logos (§5, §13.5). */
@ApiTags('logos')
@ApiBearerAuth()
@Controller()
export class LogosController {
  constructor(private readonly logos: LogosService) {}

  @Post('projects/:pid/logos/generate')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  generate(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateLogosDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.logos.generate(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
  }

  @Post('projects/:pid/logos/import')
  @WorkspaceAccess('EDITOR')
  importLogo(@Param('pid', ParseUUIDPipe) pid: string, @Body() dto: ImportLogoDto) {
    return this.logos.importLogo(pid, dto);
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
  saveVersion(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: SaveVersionDto) {
    return this.logos.saveVersion(lid, dto);
  }

  @Post('logos/:lid/variants')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.OK)
  variants(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: VariantsDto) {
    return this.logos.variants(lid, dto.versionId);
  }

  @Post('logos/:lid/export')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Générée si absente' })
  export(
    @Param('lid', ParseUUIDPipe) lid: string,
    @Body() dto: ExportLogoDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    // Un export ne débite pas de crédits : la clé d'idempotence est facultative.
    return this.logos.requestExport(
      { projectId: ws.projectId!, workspaceId: ws.workspaceId, actorId: user.id },
      lid,
      dto,
      idempotencyKey ?? randomUUID(),
    );
  }
}
