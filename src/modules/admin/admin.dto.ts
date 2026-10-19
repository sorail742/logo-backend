import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, NotEquals } from 'class-validator';
import { CursorPaginationDto } from '../../common/dto/pagination.dto';

export class AdminListUsersDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: 'Recherche par e-mail, téléphone ou nom' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ enum: PlatformRole })
  @IsOptional()
  @IsEnum(PlatformRole)
  role?: PlatformRole;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  suspended?: boolean;
}

export class AdminUpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  suspended?: boolean;

  @ApiPropertyOptional({ description: 'Réinitialise la double authentification' })
  @IsOptional()
  @IsBoolean()
  resetTwoFactor?: boolean;

  @ApiPropertyOptional({ enum: PlatformRole, description: 'Réservé au super admin' })
  @IsOptional()
  @IsEnum(PlatformRole)
  role?: PlatformRole;
}

export class AdjustCreditsDto {
  @ApiProperty()
  @IsUUID()
  workspaceId: string;

  @ApiProperty({ description: 'Positif pour créditer, négatif pour débiter' })
  @Type(() => Number)
  @IsInt()
  @NotEquals(0)
  delta: number;

  @ApiProperty({ description: 'Motif obligatoire (ADM-06)' })
  @IsString()
  @Length(5, 500)
  reason: string;
}

export class BlockedTermDto {
  @ApiProperty()
  @IsString()
  @Length(2, 80)
  term: string;

  @ApiProperty({ example: 'fr' })
  @IsString()
  @Length(2, 10)
  language: string;

  @ApiProperty({ enum: ['NAME', 'SLOGAN', 'STAMP'] })
  @IsIn(['NAME', 'SLOGAN', 'STAMP'])
  scope: string;
}

export class AuditQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  entityId?: string;
}

export class ReviewSignatureDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional({ description: 'Motif transmis à l’espace (obligatoire en pratique pour un refus)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
