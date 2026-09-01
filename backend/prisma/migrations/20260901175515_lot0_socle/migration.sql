-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('admin', 'member', 'read_only');

-- CreateEnum
CREATE TYPE "ChildStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('income', 'expense', 'both');

-- CreateEnum
CREATE TYPE "VariableBudgetProjectionMode" AS ENUM ('contractuel', 'rythme_reel', 'prudent_max');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MAD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_membership" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "child" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" DATE,
    "school_name" TEXT,
    "school_class" TEXT,
    "school_year" TEXT,
    "status" "ChildStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "child_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" TEXT NOT NULL,
    "household_id" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" "CategoryKind" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_settings" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "security_margin_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "seuil_a_venir_days" INTEGER NOT NULL DEFAULT 30,
    "seuil_a_payer_days" INTEGER NOT NULL DEFAULT 7,
    "variable_budget_projection_mode" "VariableBudgetProjectionMode" NOT NULL DEFAULT 'prudent_max',
    "week_start_day" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "household_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_invite" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'admin',
    "created_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "household_membership_household_id_user_id_key" ON "household_membership"("household_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_settings_household_id_key" ON "household_settings"("household_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_invite_code_key" ON "household_invite"("code");

-- CreateIndex
CREATE UNIQUE INDEX "household_invite_used_by_id_key" ON "household_invite"("used_by_id");

-- AddForeignKey
ALTER TABLE "household_membership" ADD CONSTRAINT "household_membership_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_membership" ADD CONSTRAINT "household_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "child" ADD CONSTRAINT "child_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_settings" ADD CONSTRAINT "household_settings_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_invite" ADD CONSTRAINT "household_invite_used_by_id_fkey" FOREIGN KEY ("used_by_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Isolation stricte par foyer — Row Level Security (defense en profondeur)
-- Reference: docs/04-architecture-technique-et-donnees.md §S.2
-- L'application (role depenses_app) est proprietaire des tables : FORCE est
-- necessaire pour que RLS s'applique aussi au proprietaire.
-- Deux GUC positionnes via SET LOCAL a chaque requete (cf. HouseholdContextService) :
--   app.current_user_id      : l'utilisateur authentifie
--   app.current_household_id : le foyer actif de la requete (peut etre absent)
-- ============================================================

-- household
ALTER TABLE "household" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household" FORCE ROW LEVEL SECURITY;

CREATE POLICY household_context ON "household"
  FOR ALL
  USING ("id" = current_setting('app.current_household_id', true))
  WITH CHECK ("id" = current_setting('app.current_household_id', true));

CREATE POLICY household_membership_visibility ON "household"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "household_membership" hm
    WHERE hm."household_id" = "household"."id"
      AND hm."user_id" = current_setting('app.current_user_id', true)
  ));

CREATE POLICY household_insert ON "household"
  FOR INSERT
  WITH CHECK (true);

-- household_membership
ALTER TABLE "household_membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household_membership" FORCE ROW LEVEL SECURITY;

CREATE POLICY hm_context ON "household_membership"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

CREATE POLICY hm_self_visibility ON "household_membership"
  FOR SELECT
  USING ("user_id" = current_setting('app.current_user_id', true));

CREATE POLICY hm_insert ON "household_membership"
  FOR INSERT
  WITH CHECK (true);

-- child
ALTER TABLE "child" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "child" FORCE ROW LEVEL SECURITY;

CREATE POLICY child_context ON "child"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- category (household_id NULL = categorie systeme, visible de tous)
ALTER TABLE "category" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "category" FORCE ROW LEVEL SECURITY;

CREATE POLICY category_context ON "category"
  FOR ALL
  USING ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" IS NULL OR "household_id" = current_setting('app.current_household_id', true));

-- household_settings
ALTER TABLE "household_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY household_settings_context ON "household_settings"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- household_invite : contexte normal + lookup/redemption par code (avant d'avoir un contexte)
ALTER TABLE "household_invite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "household_invite" FORCE ROW LEVEL SECURITY;

CREATE POLICY household_invite_context ON "household_invite"
  FOR ALL
  USING ("household_id" = current_setting('app.current_household_id', true))
  WITH CHECK ("household_id" = current_setting('app.current_household_id', true));

-- NB RLS Postgres : pour un UPDATE, la ligne *résultante* doit elle aussi rester visible via
-- au moins une policy SELECT applicable (en plus du WITH CHECK des policies d'écriture), sans
-- quoi l'UPDATE échoue avec "new row violates row-level security policy" même si WITH CHECK
-- vaut TRUE. On ajoute donc explicitement la visibilité post-redemption (used_by_id = l'utilisateur
-- qui vient de l'utiliser) pour que la ligne reste lisible juste après avoir été marquée "used_at".
CREATE POLICY household_invite_lookup_by_code ON "household_invite"
  FOR SELECT
  USING (
    ("used_at" IS NULL AND "expires_at" > now())
    OR "used_by_id" = current_setting('app.current_user_id', true)
  );

CREATE POLICY household_invite_redeem ON "household_invite"
  FOR UPDATE
  USING ("used_at" IS NULL AND "expires_at" > now())
  WITH CHECK (true);
