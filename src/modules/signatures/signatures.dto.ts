import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignatureKind } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateSignatureDto {
  @ApiProperty({ enum: SignatureKind })
  @IsEnum(SignatureKind)
  kind: SignatureKind;

  @ApiProperty({
    description:
      'EMAIL : champs de la signature (fullName, jobTitle, phones…). HANDWRITTEN : { ink, spec }. STAMP : { shape, topText, center… }',
  })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Modèle (signature e-mail ou cachet)' })
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Logo du projet à utiliser (signature e-mail) ; par défaut le favori',
  })
  @IsOptional()
  @IsUUID()
  logoId?: string;

  @ApiPropertyOptional({ description: 'Photo PNG ou JPEG en base64 (signature e-mail)' })
  @IsOptional()
  @IsString()
  @MaxLength(7_000_000)
  photoBase64?: string;

  @ApiPropertyOptional({
    description:
      'Paraphe et cachet : « je suis titulaire du nom ou habilité à représenter la structure » (§6.4)',
  })
  @IsOptional()
  @IsBoolean()
  attest?: boolean;
}

export class UpdateSignatureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  logoId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(7_000_000)
  photoBase64?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attest?: boolean;
}

export class HandwritingProposalsDto {
  @ApiProperty({ example: 'Mamadou Diallo' })
  @IsString()
  @Length(2, 60)
  fullName: string;

  @ApiPropertyOptional({ enum: ['blue', 'violet', 'red', 'black'], default: 'blue' })
  @IsOptional()
  @IsIn(['blue', 'violet', 'red', 'black'])
  ink?: 'blue' | 'violet' | 'red' | 'black';
}

export class SignatureFileQueryDto {
  @ApiPropertyOptional({ enum: ['png', 'svg'], default: 'png' })
  @IsOptional()
  @IsIn(['png', 'svg'])
  format?: 'png' | 'svg';
}

export class BatchSignaturesDto {
  @ApiProperty({
    example:
      'nom,fonction,email,telephone\nAïssatou Camara,Présidente,aissatou@exemple.org,+224620000000',
    description: 'Colonnes : nom, fonction, email, telephone, telephone2 (SIG-16)',
  })
  @IsString()
  @MaxLength(200_000)
  csv: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  logoId?: string;

  @ApiPropertyOptional({
    description: 'Champs communs (organisation, site, adresse, réseaux, mention légale)',
  })
  @IsOptional()
  @IsObject()
  common?: Record<string, unknown>;
}

export const EMAIL_LAYOUTS = ['logo-left', 'logo-top', 'text-only', 'inline'] as const;

/** Essai sans compte (§13.6) : pas d'images hébergées, mention de la plateforme. */
export class PublicEmailSignatureDto {
  @ApiProperty({ description: 'Mêmes champs que la signature e-mail' })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({ enum: EMAIL_LAYOUTS, default: 'logo-left' })
  @IsOptional()
  @IsIn(EMAIL_LAYOUTS)
  layout?: (typeof EMAIL_LAYOUTS)[number];

  @ApiPropertyOptional({ example: '#0E7C66' })
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/)
  color?: string;
}

export class ReviewSignatureDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  decision: 'APPROVE' | 'REJECT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
