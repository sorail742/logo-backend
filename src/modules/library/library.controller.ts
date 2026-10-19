import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FONTS } from '../../render/fonts';
import { searchIcons } from '../../render/icons';

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

/**
 * Bibliothèque graphique interne (§5.5, §13.7) : icônes et polices sous licence libre, modèles.
 * Seuls ces éléments entrent dans la composition des logos.
 */
@ApiTags('library')
@ApiBearerAuth()
@Controller('library')
export class LibraryController {
  constructor(private readonly prisma: PrismaService) {}

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
