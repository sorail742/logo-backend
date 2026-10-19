import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthUser, WorkspaceContext } from '../../common/auth-user';
import { CurrentUser, CurrentWorkspace, WorkspaceAccess } from '../../common/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FONTS, ICON_LICENSE, iconExists, iconMarkup, searchIcons } from '../../render/assets';
import {
  ExportLogoDto,
  GenerateLogosDto,
  ImportLogoDto,
  ListLogosDto,
  SaveVersionDto,
  UpdateLogoDto,
  VariantsQueryDto,
} from './logos.dto';
import { LogosService } from './logos.service';

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
  import(
    @Param('pid', ParseUUIDPipe) pid: string,
    @Body() dto: ImportLogoDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
  ) {
    return this.logos.importLogo(
      { projectId: pid, workspaceId: ws.workspaceId, actorId: user.id },
      dto,
    );
  }

  @Get('projects/:pid/logos')
  @WorkspaceAccess('VIEWER')
  list(@Param('pid', ParseUUIDPipe) pid: string, @Query() q: ListLogosDto) {
    return this.logos.list(pid, q.favorites);
  }

  @Get('logos/:lid')
  @WorkspaceAccess('VIEWER')
  get(@Param('lid', ParseUUIDPipe) lid: string) {
    return this.logos.get(lid);
  }

  @Patch('logos/:lid')
  @WorkspaceAccess('EDITOR')
  update(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: UpdateLogoDto) {
    return this.logos.update(lid, dto.isFavorite);
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
  variants(@Param('lid', ParseUUIDPipe) lid: string, @Body() dto: VariantsQueryDto) {
    return this.logos.variants(lid, dto.versionId);
  }

  @Post('logos/:lid/export')
  @WorkspaceAccess('EDITOR')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  export(
    @Param('lid', ParseUUIDPipe) lid: string,
    @Body() dto: ExportLogoDto,
    @CurrentUser() user: AuthUser,
    @CurrentWorkspace() ws: WorkspaceContext,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.logos.export(
      { workspaceId: ws.workspaceId, actorId: user.id },
      lid,
      dto,
      idempotencyKey,
    );
  }
}

class IconSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 60;
}

class TemplatesQueryDto {
  @IsOptional()
  @IsIn(['EMAIL_SIGNATURE', 'STAMP', 'BRAND_GUIDE'])
  kind?: string;
}

/** Bibliothèque graphique (§13.7, LOGO-11) : éléments sous licence libre uniquement. */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('icons')
  icons(@Query() q: IconSearchDto) {
    return {
      license: ICON_LICENSE,
      items: searchIcons(q.q ?? '', q.limit).map((i) => ({
        ...i,
        svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(i.id)}</svg>`,
      })),
    };
  }

  @Get('icons/:id')
  icon(@Param('id') id: string) {
    if (!iconExists(id)) throw new NotFoundException('Icône introuvable');
    return {
      id,
      license: ICON_LICENSE,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(id)}</svg>`,
    };
  }

  @Get('fonts')
  fonts() {
    return FONTS.map((f) => ({ ...f, licenseName: 'SIL Open Font License 1.1' }));
  }

  @Get('templates')
  templates(@Query() q: TemplatesQueryDto) {
    return this.prisma.template.findMany({
      where: { isActive: true, ...(q.kind && { kind: q.kind }) },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
  }
}
