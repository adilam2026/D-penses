-- Code personnel à 6 chiffres + limitation des tentatives + réinitialisation
-- du code par email. Migration STRICTEMENT ADDITIVE : aucune donnée existante
-- n'est modifiée (password_hash intact ; pin_set_at reste NULL pour tous les
-- comptes existants, ce qui déclenche la transition vers le code à 6 chiffres
-- à leur prochaine authentification).

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PIN_RESET');

-- AlterTable
ALTER TABLE "user"
  ADD COLUMN "pin_set_at" TIMESTAMP(3),
  ADD COLUMN "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lock_level" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "locked_until" TIMESTAMP(3);

-- AlterTable (les codes déjà émis sont des confirmations d'inscription)
ALTER TABLE "email_otp"
  ADD COLUMN "purpose" "OtpPurpose" NOT NULL DEFAULT 'EMAIL_VERIFICATION',
  ADD COLUMN "verified_at" TIMESTAMP(3),
  ADD COLUMN "reset_token_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "email_otp_reset_token_hash_key" ON "email_otp"("reset_token_hash");
