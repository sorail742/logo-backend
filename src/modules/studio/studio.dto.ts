import { ApiPropertyOptional } from '@nestjs/swagger';
import { IMAGE_ASPECTS, IMAGE_STYLES } from '../../shared/ai-schemas';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Aperçu PNG ou JPEG produit par l'éditeur (400 px de côté environ). */
const THUMBNAIL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

export class CreateStudioDesignDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @Matches(/^[a-z0-9-]{1,40}$/)
  format!: string;

  /** Document validé par le service (schéma zod partagé avec le rendu). */
  @IsObject()
  doc!: Record<string, unknown>;

  @IsOptional()
  @MaxLength(600_000)
  @Matches(THUMBNAIL)
  thumbnail?: string;
}

export class UpdateStudioDesignDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsObject()
  doc?: Record<string, unknown>;

  @IsOptional()
  @MaxLength(600_000)
  @Matches(THUMBNAIL)
  thumbnail?: string;
}

export class ExportStudioDesignDto {
  @IsIn(['pdf', 'svg'])
  format!: 'pdf' | 'svg';

  @ApiPropertyOptional({
    description: 'Pages à exporter (indices à partir de 0) ; toutes par défaut',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsInt({ each: true })
  @Min(0, { each: true })
  pages?: number[];

  @ApiPropertyOptional({ description: 'Traits de coupe (formats imprimés)' })
  @IsOptional()
  @IsBoolean()
  cropMarks?: boolean;
}

/** Lot de 4 images pour le Studio (fournisseur IA ; démonstration générative par défaut). */
export class GenerateStudioImagesDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  prompt!: string;

  @IsIn(['auto', ...IMAGE_STYLES])
  style!: 'auto' | (typeof IMAGE_STYLES)[number];

  @IsIn(IMAGE_ASPECTS)
  aspect!: (typeof IMAGE_ASPECTS)[number];

  @ApiPropertyOptional({ description: 'Couleurs (#rrggbb) ; par défaut, celles du logo favori' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @Matches(/^#[0-9a-fA-F]{6}$/, { each: true })
  palette?: string[];
}
