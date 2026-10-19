-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('TSHIRT', 'POLO', 'FOOTBALL_JERSEY', 'BASKETBALL_JERSEY', 'SHORTS', 'HOODIE', 'CAP', 'BAG', 'OTHER');

-- CreateEnum
CREATE TYPE "GarmentView" AS ENUM ('FRONT', 'BACK', 'LEFT_SLEEVE', 'RIGHT_SLEEVE', 'SHORTS_FRONT', 'OTHER');

-- CreateEnum
CREATE TYPE "PrintTechnique" AS ENUM ('SCREEN_PRINT', 'HEAT_TRANSFER_VINYL', 'FLOCK', 'DTF', 'DTG', 'SUBLIMATION', 'EMBROIDERY');

-- CreateEnum
CREATE TYPE "SizeScaling" AS ENUM ('FIXED', 'PROPORTIONAL');

-- CreateEnum
CREATE TYPE "DesignElementKind" AS ENUM ('LOGO', 'SPONSOR', 'TEXT', 'PLAYER_NAME', 'PLAYER_NUMBER', 'IMAGE', 'PATTERN');

-- CreateEnum
CREATE TYPE "ApparelDesignStatus" AS ENUM ('DRAFT', 'PROOF_SENT', 'APPROVED', 'IN_PRODUCTION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobKind" ADD VALUE 'APPAREL_PROPOSALS';
ALTER TYPE "JobKind" ADD VALUE 'APPAREL_MOCKUP';
ALTER TYPE "JobKind" ADD VALUE 'PRODUCTION_PACK';
ALTER TYPE "JobKind" ADD VALUE 'NUMBER_FONT';

-- CreateTable
CREATE TABLE "ProductTemplate" (
    "id" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "views" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSize" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "chestWidthMm" INTEGER NOT NULL,
    "bodyLengthMm" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProductSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintZone" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "view" "GarmentView" NOT NULL,
    "label" TEXT NOT NULL,
    "offsetXMm" INTEGER NOT NULL,
    "offsetYMm" INTEGER NOT NULL,
    "maxWidthMm" INTEGER NOT NULL,
    "maxHeightMm" INTEGER NOT NULL,
    "scaling" "SizeScaling" NOT NULL DEFAULT 'PROPORTIONAL',
    "rules" JSONB,

    CONSTRAINT "PrintZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePreset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,

    CONSTRAINT "RulePreset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintShopProfile" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "techniques" "PrintTechnique"[],
    "maxPrintWMm" INTEGER NOT NULL,
    "maxPrintHMm" INTEGER NOT NULL,
    "minStrokeMm" JSONB,
    "vinylColors" JSONB,
    "garmentSizes" JSONB,
    "mirrorDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrintShopProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApparelDesign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "rulePresetId" TEXT,
    "name" TEXT NOT NULL,
    "technique" "PrintTechnique" NOT NULL,
    "garmentColor" TEXT NOT NULL,
    "status" "ApparelDesignStatus" NOT NULL DEFAULT 'DRAFT',
    "proofToken" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApparelDesign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignElement" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "zoneKey" TEXT NOT NULL,
    "kind" "DesignElementKind" NOT NULL,
    "content" JSONB NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "heightMm" DOUBLE PRECISION NOT NULL,
    "offsetXMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offsetYMm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rotationDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "zIndex" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DesignElement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRoster" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "TeamRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RosterEntry" (
    "id" TEXT NOT NULL,
    "rosterId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "number" TEXT,
    "size" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "role" TEXT,

    CONSTRAINT "RosterEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NumberFontSet" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "name" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "glyphs" JSONB NOT NULL,
    "colorCount" INTEGER NOT NULL DEFAULT 1,
    "minStrokeMm" DOUBLE PRECISION NOT NULL,
    "license" "LicenseKind",
    "fontFileKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NumberFontSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionExport" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "technique" "PrintTechnique" NOT NULL,
    "mirrored" BOOLEAN NOT NULL DEFAULT false,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "zipKey" TEXT,
    "techPackKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductSize_templateId_label_key" ON "ProductSize"("templateId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "PrintZone_templateId_key_key" ON "PrintZone"("templateId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RulePreset_code_key" ON "RulePreset"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ApparelDesign_proofToken_key" ON "ApparelDesign"("proofToken");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRoster_designId_key" ON "TeamRoster"("designId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterEntry_rosterId_number_key" ON "RosterEntry"("rosterId", "number");

-- AddForeignKey
ALTER TABLE "ProductSize" ADD CONSTRAINT "ProductSize_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintZone" ADD CONSTRAINT "PrintZone_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrintShopProfile" ADD CONSTRAINT "PrintShopProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApparelDesign" ADD CONSTRAINT "ApparelDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApparelDesign" ADD CONSTRAINT "ApparelDesign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProductTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApparelDesign" ADD CONSTRAINT "ApparelDesign_rulePresetId_fkey" FOREIGN KEY ("rulePresetId") REFERENCES "RulePreset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignElement" ADD CONSTRAINT "DesignElement_designId_fkey" FOREIGN KEY ("designId") REFERENCES "ApparelDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRoster" ADD CONSTRAINT "TeamRoster_designId_fkey" FOREIGN KEY ("designId") REFERENCES "ApparelDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RosterEntry" ADD CONSTRAINT "RosterEntry_rosterId_fkey" FOREIGN KEY ("rosterId") REFERENCES "TeamRoster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NumberFontSet" ADD CONSTRAINT "NumberFontSet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionExport" ADD CONSTRAINT "ProductionExport_designId_fkey" FOREIGN KEY ("designId") REFERENCES "ApparelDesign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
