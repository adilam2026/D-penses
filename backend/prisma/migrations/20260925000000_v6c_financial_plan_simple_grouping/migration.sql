-- Convergence V6C §1 — nouveau modèle FinancialPlan (simple regroupement de
-- charges) : colonnes additives, aucune donnée existante touchée/perdue.
-- description/active restent NULL/true par défaut pour tous les plans déjà
-- créés par les wizards (École/Voyage/Voiture/Maison/Abonnements) — ces
-- plans continuent d'exister tels quels, seule l'UI change de façon de les
-- afficher (regroupement de charges au lieu du moteur de couverture).
ALTER TABLE "financial_plan" ADD COLUMN "description" TEXT;
ALTER TABLE "financial_plan" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
