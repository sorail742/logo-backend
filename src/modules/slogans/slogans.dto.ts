import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { SLOGAN_KINDS, SLOGAN_TONES } from '../../shared/ai-schemas';

export class GenerateSlogansDto {
  @ApiPropertyOptional({ enum: SLOGAN_TONES, default: 'INSPIRING' })
  @IsOptional()
  @IsIn(SLOGAN_TONES)
  tone?: (typeof SLOGAN_TONES)[number];

  @ApiPropertyOptional({
    enum: SLOGAN_KINDS,
    default: 'SLOGAN',
    description: 'DEVISE et MISSION : SIG-03',
  })
  @IsOptional()
  @IsIn(SLOGAN_KINDS)
  kind?: (typeof SLOGAN_KINDS)[number];

  @ApiPropertyOptional({ default: 8, description: 'Nombre de mots au plus (SIG-02)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(3)
  @Max(20)
  maxWords?: number;

  @ApiPropertyOptional({ enum: ['fr', 'en'], default: 'fr' })
  @IsOptional()
  @IsIn(['fr', 'en'])
  language?: 'fr' | 'en';
}

export class UpdateSloganDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;

  @ApiPropertyOptional({
    description: 'Retient ce slogan ; les autres du même type ne le sont plus',
  })
  @IsOptional()
  @IsBoolean()
  isChosen?: boolean;

  @ApiPropertyOptional({ description: 'Retouche du texte' })
  @IsOptional()
  @IsString()
  @Length(2, 300)
  text?: string;
}
