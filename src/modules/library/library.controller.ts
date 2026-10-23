import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FONTS } from '../../render/fonts';
import { searchIcons } from '../../render/icons';
import { AiProvider } from '../ai/ai-provider';
import { StudioCutoutService } from '../studio/studio-cutout.service';
import { PhotosService, type PhotoOrientation } from './photos.service';

export class SearchIconsDto {
  @ApiPropertyOptional({ example: 'école' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}

export class ListTemplatesDto {
  @ApiPropertyOptional({ enum: ['EMAIL_SIGNATURE', 'STAMP', 'BRAND_GUIDE'] })
  @IsOptional()
  @IsIn(['EMAIL_SIGNATURE', 'STAMP', 'BRAND_GUIDE'])
  kind?: string;
}

export class SearchPhotosDto {
  @ApiPropertyOptional({ example: 'marché coloré', description: 'Vide : sélection du moment' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  page?: number;

  @ApiPropertyOptional({ enum: ['landscape', 'portrait', 'square'] })
  @IsOptional()
  @IsIn(['landscape', 'portrait', 'square'])
  orientation?: PhotoOrientation;

  @ApiPropertyOptional({ enum: ['fr', 'en'], description: 'Langue de la recherche' })
  @IsOptional()
  @IsIn(['fr', 'en'])
  locale?: 'fr' | 'en';
}

/**
 * Bibliothèque graphique interne (§5.5, §13.7) : icônes et polices sous licence libre, modèles.
 * Seuls ces éléments entrent dans la composition des logos.
 */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
    private readonly ai: AiProvider,
    private readonly cutouts: StudioCutoutService,
  ) {}

  /** Ressources activées sur cette plateforme (le front adapte le Studio en conséquence). */
  @Get('capabilities')
  capabilities() {
    return {
      aiImages: { provider: this.ai.name, demo: this.ai.demo },
      photos: this.photos.enabled,
      cutout: this.cutouts.enabled,
    };
  }

  /** Banque de photos (Pexels) : 501 NOT_AVAILABLE tant qu'aucune clé n'est configurée. */
  @Get('photos')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  searchPhotos(@Query() dto: SearchPhotosDto) {
    return this.photos.search(dto);
  }

  @Get('photos/:id/file')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async photoFile(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const file = await this.photos.file(id);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type(file.contentType).send(file.data);
  }

  @Get('icons')
  icons(@Query() dto: SearchIconsDto) {
    return searchIcons(dto.q ?? '');
  }

  @Get('fonts')
  fonts() {
    return FONTS.map(({ id, name, category, license, weights }) => ({
      id,
      name,
      category,
      license,
      weights,
      isActive: true,
    }));
  }

  @Get('templates')
  templates(@Query() dto: ListTemplatesDto) {
    return this.prisma.template.findMany({
      where: { isActive: true, ...(dto.kind && { kind: dto.kind }) },
      orderBy: { name: 'asc' },
    });
  }
}
