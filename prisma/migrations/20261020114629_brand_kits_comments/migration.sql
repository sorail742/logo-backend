-- AlterTable
ALTER TABLE "BrandKit" ADD COLUMN     "content" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "restoredFrom" INTEGER;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "requestedById" TEXT;

-- CreateIndex
CREATE INDEX "Comment_projectId_createdAt_idx" ON "Comment"("projectId", "createdAt");
