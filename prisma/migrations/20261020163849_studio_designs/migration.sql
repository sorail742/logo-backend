-- AlterEnum
ALTER TYPE "JobKind" ADD VALUE 'DESIGN_EXPORT';

-- CreateTable
CREATE TABLE "StudioDesign" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "doc" JSONB NOT NULL,
    "thumbnail" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioDesign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioDesign_projectId_updatedAt_idx" ON "StudioDesign"("projectId", "updatedAt");

-- AddForeignKey
ALTER TABLE "StudioDesign" ADD CONSTRAINT "StudioDesign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
