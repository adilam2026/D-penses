-- AlterTable
ALTER TABLE "user" ADD COLUMN     "email_verified_at" TIMESTAMP(3);

-- Rétro-compatibilité : les comptes déjà existants avant l'introduction de la
-- vérification par OTP n'ont jamais eu à confirmer leur email — les considérer
-- vérifiés à la date de création plutôt que de les bloquer rétroactivement.
-- Seuls les comptes créés APRÈS cette migration passent par le nouveau parcours.
UPDATE "user" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;

-- CreateTable
CREATE TABLE "email_otp" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_otp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_otp_user_id_idx" ON "email_otp"("user_id");

-- AddForeignKey
ALTER TABLE "email_otp" ADD CONSTRAINT "email_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
