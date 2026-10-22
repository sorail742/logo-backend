import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityType, NameStyle } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export class GenerateNamesDto {
  @ApiPropertyOptional({ example: 'plus court', description: 'Retour pour relancer (NOM-13)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  feedback?: string;

  @ApiPropertyOptional({
    description: '« Plus proche de celui-ci » : identifiant d’un nom du projet',
  })
  @IsOptional()
  @IsUUID()
  referenceNameId?: string;
}

export class ListNamesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  favorites?: boolean;

  @ApiPropertyOptional({ description: 'Inclure les noms rejetés (exclus par défaut)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  rejected?: boolean;
}

export class UpdateNameDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isRejected?: boolean;
}

export class RunChecksDto {
  @ApiPropertyOptional({ description: 'Ignorer le cache de 24 h' })
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class VoteDto {
  @ApiProperty({ enum: [1, -1] })
  @Type(() => Number)
  @IsIn([1, -1])
  value: 1 | -1;
}

export class ChooseNameDto {
  @ApiProperty()
  @IsUUID()
  nameId: string;
}

/** Essai sans compte : brief minimal (§13.4). */
export class PublicNameTryDto {
  @ApiProperty({ enum: EntityType })
  @IsEnum(EntityType)
  entityType: EntityType;

  @ApiProperty()
  @IsString()
  @Length(1, 120)
  sector: string;

  @ApiPropertyOptional({ description: 'Mission en une phrase ; à défaut, les mots-clés' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mission?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  values?: string[];

  @ApiPropertyOptional({ type: [String], description: 'Mots-clés du formulaire d’essai' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  keywords?: string[];

  @ApiPropertyOptional({ enum: NameStyle, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(NameStyle, { each: true })
  nameStyles?: NameStyle[];

  @ApiPropertyOptional({ enum: ['fr', 'en'] })
  @IsOptional()
  @IsIn(['fr', 'en'])
  language?: string;
}
