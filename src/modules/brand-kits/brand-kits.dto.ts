import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Activation, modification ou révocation du lien de partage (KIT-05). */
export class ShareKitDto {
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({ description: 'Mot de passe facultatif (4 à 100 caractères)' })
  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(100)
  password?: string;

  @ApiPropertyOptional({ description: 'Date d’expiration ISO 8601, null pour un lien permanent' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}
