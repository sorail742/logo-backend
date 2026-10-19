-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Template_key_key" ON "Template"("key");

