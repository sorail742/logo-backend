-- AlterTable
ALTER TABLE "User" ADD COLUMN     "totpBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
