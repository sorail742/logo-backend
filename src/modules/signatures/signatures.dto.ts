import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SignatureKind } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateSignatureDto {
  @ApiProperty({ enum: SignatureKind })
  @IsEnum(SignatureKind)
  kind: SignatureKind;

  @ApiPropertyOptional({ description: 'Modèle de signature e-mail (classic, sidebar…)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  templateId?: string;

  @ApiProperty({ description: 'Champs de la signature, selon son type' })
  @IsObject()
  data: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Habilitation certifiée, obligatoire pour un paraphe ou un cachet (§6.4)',
  })
  @IsOptional()
  @IsBoolean()
  attested?: boolean;
}

export class UpdateSignatureDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  templateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  attested?: boolean;
}

export class BatchSignaturesDto {
  @ApiProperty({ description: 'CSV : nom, fonction, e-mail, téléphone (séparateur , ou ;)' })
  @IsString()
  @MaxLength(500_000)
  csv: string;

  @ApiPropertyOptional({ description: 'Modèle ; à défaut celui de la signature e-mail du projet' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  templateId?: string;
}

export class PublicEmailSignatureDto {
  @ApiPropertyOptional({ default: 'classic' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  templateId?: string;

  @ApiProperty()
  @IsObject()
  data: Record<string, unknown>;

  @ApiProperty({ description: 'Nom, slogan, couleurs et logo (URL HTTPS) de la structure' })
  @IsObject()
  brand: Record<string, unknown>;
}
