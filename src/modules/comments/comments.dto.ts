import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Éléments commentables (COL-02) ; PROJECT et KIT pour les échanges généraux, DESIGN pour une
 * création du Studio (commentaire épinglé sur la page).
 */
export const COMMENT_TARGETS = [
  'PROJECT',
  'NAME',
  'LOGO',
  'SIGNATURE',
  'SLOGAN',
  'KIT',
  'DESIGN',
] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

/** Épingle d'un commentaire sur une page du Studio, en proportion de la page. */
export class CommentAnchorDto {
  @IsString()
  @MaxLength(40)
  pageId!: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;
}

export class CreateCommentDto {
  @IsIn(COMMENT_TARGETS)
  targetType!: CommentTarget;

  @IsUUID()
  targetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ description: 'Épingle sur une page (création du Studio)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CommentAnchorDto)
  anchor?: CommentAnchorDto;

  @ApiPropertyOptional({ description: 'Réponse dans le fil de ce commentaire' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCommentDto {
  @IsBoolean()
  resolved!: boolean;
}

export class ListCommentsDto {
  @ApiPropertyOptional({ enum: COMMENT_TARGETS })
  @IsOptional()
  @IsIn(COMMENT_TARGETS)
  targetType?: CommentTarget;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  targetId?: string;
}
