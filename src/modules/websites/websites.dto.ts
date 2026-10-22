import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** Modification du site : contenu (validé par le schéma partagé avec le rendu), adresse, logo. */
export class UpdateWebsiteDto {
  @ApiPropertyOptional({ description: 'Contenu complet du site (sections, couleurs, polices…)' })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Adresse publique : /site/<slug>' })
  @IsOptional()
  @IsString()
  @MaxLength(48)
  slug?: string;

  @ApiPropertyOptional({ description: 'Logo affiché ; null : favori ou plus récent du projet' })
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  logoId?: string | null;
}

/** Image téléversée (JPEG, PNG ou WebP, 4 Mo au plus). */
export class AddWebsiteMediaDto {
  @IsString()
  @MaxLength(5_600_000)
  @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/)
  dataUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;
}

export class MarkMessageDto {
  @IsBoolean()
  read!: boolean;
}

/**
 * Message du formulaire de contact d'un site publié (corps JSON ou formulaire encodé).
 * `website` est un champ piège invisible : rempli, le message est ignoré.
 */
export class SiteMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @ValidateIf((_o, value) => value !== '')
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
