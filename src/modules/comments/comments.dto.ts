import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Éléments commentables (COL-02) ; PROJECT et KIT pour les échanges généraux. */
export const COMMENT_TARGETS = ['PROJECT', 'NAME', 'LOGO', 'SIGNATURE', 'SLOGAN', 'KIT'] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export class CreateCommentDto {
  @IsIn(COMMENT_TARGETS)
  targetType!: CommentTarget;

  @IsUUID()
  targetId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;
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
