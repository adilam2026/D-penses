-- Corrections consolidées §5/§6 — préférences d'affichage par compte,
-- indépendantes de include_in_operational_treasury (pilotage).
ALTER TABLE "financial_account"
  ADD COLUMN "hide_balance_by_default" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_on_home" BOOLEAN NOT NULL DEFAULT true;
