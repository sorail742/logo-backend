import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LogoType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { VARIANTS } from '../../render/variants';
import { EXPORT_FORMATS, PNG_SIZES } from './logo-export.service';

export const LOGO_STYLES = [
  'MINIMALIST',
  'MODERN',
  'CLASSIC',
  'INSTITUTIONAL',
  'PLAYFUL',
  'AFRICAN',
] as const;

export class GenerateLogosDto {
  @ApiProperty({ enum: LogoType, isArray: true, description: 'LOGO-01' })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(LogoType, { each: true })
  types: LogoType[];

  @ApiProperty({ enum: LOGO_STYLES, description: 'LOGO-02' })
  @IsIn(LOGO_STYLES)
  style: (typeof LOGO_STYLES)[number];

  @ApiPropertyOptional({
    example: ['#0E7C66', '#F2A541'],
    description: '2 à 4 couleurs ; absent = proposée par l’IA (LOGO-03)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(4)
  @Matches(/^#[0-9A-Fa-f]{6}$/, { each: true })
  palette?: string[];

  @ApiPropertyOptional({ enum: ['SVG_COMPOSER', 'IMAGE_VECTORIZE'], default: 'SVG_COMPOSER' })
  @IsOptional()
  @IsIn(['SVG_COMPOSER', 'IMAGE_VECTORIZE'])
  engine?: 'SVG_COMPOSER' | 'IMAGE_VECTORIZE';

  @ApiPropertyOptional({
    example: 'mêmes couleurs',
    description: 'LOGO-06 : « plus simple », « autre icône », « mêmes couleurs »',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  feedback?: string;

  @ApiPropertyOptional({ description: 'Logo de référence pour la relance' })
  @IsOptional()
  @IsUUID()
  fromLogoId?: string;

  @ApiPropertyOptional({ description: 'Signature affichée sous le nom' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  tagline?: string;
}

export class ImportLogoDto {
  @ApiProperty({ description: 'Fichier SVG ou PNG encodé en base64 (5 Mo maximum)' })
  @IsString()
  @MaxLength(7_000_000)
  fileBase64: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  fileName?: string;
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
  @ApiProperty({ description: 'LogoSpec complète (texte, police, couleurs, icône, disposition)' })
  @IsObject()
  spec: Record<string, unknown>;

  @ApiPropertyOptional({ example: 'Version validée par le bureau' })
  @IsOptional()
  @IsString()
  @Length(1, 80)
  label?: string;
}

export class VariantsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  versionId?: string;
}

export class ExportLogoDto {
  @ApiPropertyOptional({ description: 'Version à exporter ; par défaut la plus récente' })
  @IsOptional()
  @IsUUID()
  versionId?: string;

  @ApiProperty({ enum: EXPORT_FORMATS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(EXPORT_FORMATS, { each: true })
  formats: (typeof EXPORT_FORMATS)[number][];

  @ApiPropertyOptional({ enum: PNG_SIZES, isArray: true, default: [512, 1024, 2048] })
  @IsOptional()
  @IsArray()
  @IsIn(PNG_SIZES, { each: true })
  pngSizes?: (typeof PNG_SIZES)[number][];

  @ApiPropertyOptional({ enum: VARIANTS, isArray: true, default: ['color'] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(VARIANTS, { each: true })
  variants?: (typeof VARIANTS)[number][];

  @ApiPropertyOptional({
    description: 'Pack icônes d’app : favicon, Apple, Android, iOS (LOGO-22)',
  })
  @IsOptional()
  @IsBoolean()
  appIcons?: boolean;
}
