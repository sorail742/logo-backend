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
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { GenerateSlogansDto, ListSlogansDto, SloganLogoDto, UpdateSloganDto } from './slogans.dto';
import { SlogansService } from './slogans.service';

/** Signature de marque : slogans, devises, phrases de mission (§6.1, §13.6). */
@ApiTags('slogans')
@ApiBearerAuth()
@Controller()
export class SlogansController {
  constructor(private readonly slogans: SlogansService) {}

  @Post('projects/:pid/slogans/generate')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  generate(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: GenerateSlogansDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.slogans.generate(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
      idempotencyKey,
    );
  }

  @Get('projects/:pid/slogans')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string, @Query() q: ListSlogansDto) {
    return this.slogans.list(pid, q);
  }

  @Patch('slogans/:slid')
  @WorkspaceAccess('EDITOR')
  update(@Param('slid', ParseUUIDPipe) slid: string, @Body() dto: UpdateSloganDto) {
    return this.slogans.update(slid, dto);
  }

  @Post('slogans/:slid/logo-version')
  @WorkspaceAccess('EDITOR')
  applyToLogo(@Param('slid', ParseUUIDPipe) slid: string, @Body() dto: SloganLogoDto) {
    return this.slogans.applyToLogo(slid, dto.logoId);
  }
}
