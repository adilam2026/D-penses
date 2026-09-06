-- AlterTable
ALTER TABLE "household_settings" ADD COLUMN     "onboarding_skipped_steps" TEXT[] DEFAULT ARRAY[]::TEXT[];
