import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SLOGAN_TONES } from '../../shared/ai-schemas';

export class GenerateSlogansDto {
  @ApiProperty({
    enum: SLOGAN_TONES,
    description: 'Inspirant, institutionnel, accrocheur, engagé (SIG-01)',
  })
  @IsIn(SLOGAN_TONES)
  tone: (typeof SLOGAN_TONES)[number];

  @ApiPropertyOptional({ enum: ['fr', 'en'], default: 'fr' })
  @IsOptional()
  @IsIn(['fr', 'en'])
  language?: 'fr' | 'en';

  @ApiPropertyOptional({
    default: 8,
    minimum: 2,
    maximum: 20,
    description: 'Nombre de mots maximal (SIG-02)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(20)
  maxWords?: number;

  @ApiPropertyOptional({ example: 'plus court' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  feedback?: string;
}

export class ListSlogansDto {
  @ApiPropertyOptional({ enum: ['SLOGAN', 'DEVISE', 'MISSION'] })
  @IsOptional()
  @IsIn(['SLOGAN', 'DEVISE', 'MISSION'])
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  favorites?: boolean;
}

export class UpdateSloganDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({ description: 'Un seul slogan retenu par type (slogan, devise, mission)' })
  @IsOptional()
  @IsBoolean()
  isChosen?: boolean;
}

export class SloganLogoDto {
  @ApiProperty({ description: 'Logo auquel ajouter le slogan comme signature (SIG-05)' })
  @IsUUID()
  logoId: string;
}
