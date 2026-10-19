import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { EXPORT_FORMATS, PNG_SIZES, type ExportFormat } from '../../render/logo-assets';
import { LOGO_STYLES, LOGO_TYPES, type LogoType } from '../../render/logo-spec';
import type { LogoStyle } from '../../render/color';

const HEX = /^#[0-9a-fA-F]{6}$/;

export class GenerateLogosDto {
  @ApiProperty({ enum: LOGO_TYPES, description: 'LOGO-01' })
  @IsIn(LOGO_TYPES)
  type: LogoType;

  @ApiProperty({ enum: LOGO_STYLES, description: 'LOGO-02' })
  @IsIn(LOGO_STYLES)
  style: LogoStyle;

  @ApiPropertyOptional({ enum: ['SVG_COMPOSER', 'IMAGE_VECTORIZE'], default: 'SVG_COMPOSER' })
  @IsOptional()
  @IsIn(['SVG_COMPOSER', 'IMAGE_VECTORIZE'])
  engine?: 'SVG_COMPOSER' | 'IMAGE_VECTORIZE';

  @ApiPropertyOptional({
    example: ['#0f766e', '#f59e0b'],
    description: '2 à 4 couleurs ; sinon palette proposée selon le style (LOGO-03)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @Matches(HEX, { each: true })
  palette?: string[];

  @ApiPropertyOptional({ example: 'plus simple', description: 'Retour pour relancer (LOGO-06)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  feedback?: string;

  @ApiPropertyOptional({ description: 'Logo du projet servant de référence à la relance' })
  @IsOptional()
  @IsUUID()
  referenceLogoId?: string;
}

export class ImportLogoDto {
  @ApiPropertyOptional({ description: 'Source SVG (1 Mo au plus), nettoyée côté serveur' })
  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  svg?: string;

  @ApiPropertyOptional({ description: 'Image PNG en data URL (2 Mo au plus)' })
  @IsOptional()
  @IsString()
  @MaxLength(2_800_000)
  @Matches(/^data:image\/png;base64,/)
  pngDataUrl?: string;

  @ApiPropertyOptional({
    description: 'Palette extraite par le front ; sinon extraite ici (LOGO-07)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @Matches(HEX, { each: true })
  palette?: string[];
}

export class ListLogosDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  favorites?: boolean;
}

export class UpdateLogoDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;
}

export class SaveVersionDto {
  @ApiProperty({ description: 'Spécification du logo (LogoSpec), validée côté serveur' })
  @IsObject()
  spec: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Version validée par le bureau', description: 'LOGO-13' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class VariantsDto {
  @ApiPropertyOptional({ description: 'Version à décliner (par défaut : la dernière)' })
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class ExportLogoDto extends VariantsDto {
  @ApiPropertyOptional({ enum: EXPORT_FORMATS, isArray: true, default: EXPORT_FORMATS })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(EXPORT_FORMATS, { each: true })
  formats?: ExportFormat[];

  @ApiPropertyOptional({ enum: PNG_SIZES, isArray: true, default: PNG_SIZES })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Number)
  @IsIn(PNG_SIZES, { each: true })
  sizes?: number[];

  @ApiPropertyOptional({ default: true, description: 'Pack icônes d’app (LOGO-22)' })
  @IsOptional()
  @IsBoolean()
  iconPack?: boolean;

  @ApiPropertyOptional({ default: true, description: 'Formats réseaux sociaux (LOGO-23)' })
  @IsOptional()
  @IsBoolean()
  social?: boolean;
}
