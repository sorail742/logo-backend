-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "viewerDownloads" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CreditAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditAdjustmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditAdjustmentRequest_status_createdAt_idx" ON "CreditAdjustmentRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditAdjustmentRequest" ADD CONSTRAINT "CreditAdjustmentRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
