-- AlterTable
ALTER TABLE "account" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "subaccount" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;
