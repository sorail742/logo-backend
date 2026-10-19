import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DesignElementKind,
  GarmentView,
  PrintTechnique,
  ProductCategory,
  SizeScaling,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HEX = /^#[0-9A-Fa-f]{6}$/;

export class CreateApparelDesignDto {
  @ApiProperty()
  @IsUUID()
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rulePresetId?: string;

  @ApiProperty({ example: 'Maillot domicile 2026' })
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiProperty({ enum: PrintTechnique })
  @IsEnum(PrintTechnique)
  technique: PrintTechnique;

  @ApiProperty({ example: '#0B3D91' })
  @Matches(HEX)
  garmentColor: string;
}

export class UpdateApparelDesignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUID()
  rulePresetId?: string | null;

  @ApiPropertyOptional({ enum: PrintTechnique })
  @IsOptional()
  @IsEnum(PrintTechnique)
  technique?: PrintTechnique;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(HEX)
  garmentColor?: string;
}

export class DesignElementDto {
  @ApiProperty({ example: 'back_number' })
  @IsString()
  @MaxLength(40)
  zoneKey: string;

  @ApiProperty({ enum: DesignElementKind })
  @IsEnum(DesignElementKind)
  kind: DesignElementKind;

  @ApiProperty({
    description:
      'text, colors (HEX), strokeMm, style, gradient, pixelWidth, source (library | brand-kit | upload), rightsAttested, assetId…',
  })
  @IsObject()
  content: Record<string, unknown>;

  @ApiProperty() @IsNumber() @Min(1) @Max(1000) widthMm: number;
  @ApiProperty() @IsNumber() @Min(1) @Max(1000) heightMm: number;
  @ApiProperty() @IsNumber() @Min(-1000) @Max(1000) offsetXMm: number;
  @ApiProperty() @IsNumber() @Min(-1000) @Max(1000) offsetYMm: number;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-360) @Max(360) rotationDeg?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() zIndex?: number;
}

export class SaveElementsDto {
  @ApiProperty({ type: [DesignElementDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DesignElementDto)
  elements: DesignElementDto[];
}

export class CheckDesignDto {
  @ApiPropertyOptional({ description: 'Profil atelier dont appliquer les épaisseurs minimales' })
  @IsOptional()
  @IsUUID()
  printShopId?: string;
}

export class RosterImportDto {
  @ApiProperty({
    example: 'nom,nom_imprime,numero,taille,poste,quantite\nMamadou Diallo,DIALLO,10,M,Joueur,1',
  })
  @IsString()
  @MaxLength(200_000)
  csv: string;

  @ApiPropertyOptional({ example: 'Effectif seniors' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
}

export class RosterEntryDto {
  @ApiProperty() @IsString() @Length(1, 120) playerName: string;
  @ApiProperty() @IsString() @Length(1, 40) displayName: string;

  @ApiPropertyOptional({ description: 'Texte, pour accepter 0 et 00' })
  @IsOptional()
  @Matches(/^\d{1,3}$/)
  number?: string | null;

  @ApiProperty() @IsString() @Length(1, 20) size: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) role?: string | null;
}

export class SaveRosterDto {
  @ApiProperty() @IsString() @Length(1, 120) name: string;

  @ApiProperty({ type: [RosterEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => RosterEntryDto)
  entries: RosterEntryDto[];
}

export class ProofDto {
  @ApiPropertyOptional({ description: 'Révoquer le lien existant' })
  @IsOptional()
  @IsBoolean()
  revoke?: boolean;
}

export class ApproveProofDto {
  @ApiProperty({ example: 'Mamadou Diallo, président du club' })
  @IsString()
  @Length(2, 120)
  approverName: string;
}

export class PrintShopDto {
  @ApiProperty() @IsString() @Length(1, 120) name: string;

  @ApiProperty({ enum: PrintTechnique, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(PrintTechnique, { each: true })
  techniques: PrintTechnique[];

  @ApiProperty() @IsInt() @Min(50) @Max(3000) maxPrintWMm: number;
  @ApiProperty() @IsInt() @Min(50) @Max(3000) maxPrintHMm: number;

  @ApiPropertyOptional({ example: { HEAT_TRANSFER_VINYL: 2, DTF: 1 } })
  @IsOptional()
  @IsObject()
  minStrokeMm?: Record<string, number>;

  @ApiPropertyOptional({ example: [{ name: 'Blanc', hex: '#FFFFFF', ref: 'Poli-Flex 4410' }] })
  @IsOptional()
  @IsArray()
  vinylColors?: unknown[];

  @ApiPropertyOptional({ description: 'Mesures réelles des vêtements du fournisseur' })
  @IsOptional()
  @IsObject()
  garmentSizes?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() mirrorDefault?: boolean;
}

// ─── Administration des supports (TEX-04) ───

export class AdminSizeDto {
  @ApiProperty() @IsString() @Length(1, 20) label: string;
  @ApiProperty() @IsInt() @Min(100) @Max(2000) chestWidthMm: number;
  @ApiProperty() @IsInt() @Min(100) @Max(2000) bodyLengthMm: number;
  @ApiProperty() @IsInt() sortOrder: number;
}

export class AdminZoneDto {
  @ApiProperty() @Matches(/^[a-z][a-z0-9_]{1,39}$/) key: string;
  @ApiProperty({ enum: GarmentView }) @IsEnum(GarmentView) view: GarmentView;
  @ApiProperty() @IsString() @Length(1, 80) label: string;
  @ApiProperty() @IsInt() @Min(-1000) @Max(1000) offsetXMm: number;
  @ApiProperty() @IsInt() @Min(0) @Max(2000) offsetYMm: number;
  @ApiProperty() @IsInt() @Min(5) @Max(2000) maxWidthMm: number;
  @ApiProperty() @IsInt() @Min(5) @Max(2000) maxHeightMm: number;
  @ApiProperty({ enum: SizeScaling }) @IsEnum(SizeScaling) scaling: SizeScaling;
  @ApiPropertyOptional() @IsOptional() @IsObject() rules?: Record<string, unknown>;
}

export class AdminTemplateDto {
  @ApiProperty({ enum: ProductCategory }) @IsEnum(ProductCategory) category: ProductCategory;
  @ApiProperty() @IsString() @Length(1, 80) name: string;

  @ApiProperty({
    description: 'Clé de stockage du SVG par vue',
    example: { FRONT: 'templates/cap/front.svg' },
  })
  @IsObject()
  views: Record<string, string>;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;

  @ApiProperty({ type: [AdminSizeDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminSizeDto)
  sizes: AdminSizeDto[];

  @ApiProperty({ type: [AdminZoneDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminZoneDto)
  zones: AdminZoneDto[];
}

export class AdminRulePresetDto {
  @ApiProperty({ example: 'LOCAL_LIGUE_CONAKRY' }) @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) code: string;
  @ApiProperty() @IsString() @Length(1, 120) name: string;
  @ApiProperty({ description: 'Voir PresetRules' }) @IsObject() rules: Record<string, unknown>;
}
