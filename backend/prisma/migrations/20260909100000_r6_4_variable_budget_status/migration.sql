-- R6.4 (§1) : archivage d'un budget variable — la suppression physique reste
-- bloquée dès qu'une BudgetExpense existe (historique réel), remplacée par ce
-- statut. Défaut 'actif' : tous les budgets existants restent inchangés.
CREATE TYPE "VariableBudgetStatus" AS ENUM ('actif', 'inactif');

ALTER TABLE "variable_budget" ADD COLUMN     "status" "VariableBudgetStatus" NOT NULL DEFAULT 'actif';
