import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentProvider } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min } from 'class-validator';

export class CreateCheckoutDto {
  @ApiPropertyOptional({ description: 'Code de l’offre (PACK, PRO, AGENCY, ASSOCIATION)' })
  @IsOptional()
  @IsString()
  planCode?: string;

  @ApiPropertyOptional({
    description: 'Nombre de crédits unitaires à acheter (si hors abonnement)',
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  creditPack?: number;

  @ApiProperty({ enum: PaymentProvider, description: 'Opérateur ou moyen de paiement' })
  @IsEnum(PaymentProvider)
  provider!: PaymentProvider;

  @ApiPropertyOptional({ description: 'Numéro de téléphone pour Orange Money (+224… ou 62…)' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'URL de retour après paiement validé' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'URL d’annulation' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;

  @ApiPropertyOptional({ description: 'Code promotionnel éventuel' })
  @IsOptional()
  @IsString()
  promoCode?: string;
}

export class SimulatePaymentDto {
  @ApiProperty({ description: 'Identifiant du paiement à valider (simulation sandbox)' })
  @IsString()
  paymentId!: string;

  @ApiPropertyOptional({ description: 'Forcer un échec pour tester le traitement des erreurs' })
  @IsOptional()
  fail?: boolean;
}
