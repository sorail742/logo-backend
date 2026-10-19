-- AlterEnum
ALTER TYPE "JobKind" ADD VALUE 'LOGO_EXPORT';

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "result" JSONB;
