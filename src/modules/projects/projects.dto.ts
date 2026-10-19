import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntityType, NameStyle, ProjectStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class CreateProjectDto {
  @ApiProperty({ enum: EntityType })
  @IsEnum(EntityType)
  entityType: EntityType;

  @ApiProperty({ example: 'Projet association jeunesse' })
  @IsString()
  @Length(1, 120)
  title: string;
}

export class UpdateProjectDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional({ enum: EntityType })
  @IsOptional()
  @IsEnum(EntityType)
  entityType?: EntityType;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}

export class ListProjectsDto extends CursorPaginationDto {
  @ApiPropertyOptional({ enum: EntityType })
  @IsOptional()
  @IsEnum(EntityType)
  type?: EntityType;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ description: 'Recherche dans le titre' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Afficher la corbeille' })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  trash?: boolean;
}

/** Brief de nommage (NOM-01 à NOM-04). */
export class BriefDto {
  @ApiProperty({ example: 'Éducation' })
  @IsString()
  @Length(1, 120)
  sector: string;

  @ApiProperty({ maxLength: 500 })
  @IsString()
  @MaxLength(500)
  mission: string;

  @ApiProperty({ type: [String], example: ['solidarité', 'jeunesse'] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  values: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  audience?: string;

  @ApiProperty({ type: [String], example: ['fr'] })
  @IsArray()
  @IsIn(['fr', 'en'], { each: true })
  languages: string[];

  @ApiProperty({ enum: NameStyle, isArray: true })
  @IsArray()
  @IsEnum(NameStyle, { each: true })
  nameStyles: NameStyle[];

  @ApiPropertyOptional({ minimum: 3, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  maxLength?: number;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  mustInclude: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  mustAvoid: string[];

  @ApiPropertyOptional({ example: 'inspirant' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  tone?: string;
}
