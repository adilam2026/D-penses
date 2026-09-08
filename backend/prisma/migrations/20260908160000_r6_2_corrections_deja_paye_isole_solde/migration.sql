-- R6.2 corrections finales §1 (CRITIQUE) — un paiement "déjà payé" (reprise
-- historique, cf. common/ledger/already-paid.util.ts) ne doit JAMAIS débiter
-- la trésorerie actuelle, même quand le compte historique est connu et
-- conservé sur payment.account_id à titre d'information. accountId n'est
-- plus le proxy de "reprise historique" : is_historical_import est le seul
-- marqueur explicite, orthogonal au compte.
--
-- 3 changements minimaux, non destructifs :
--  1. payment.is_historical_import (nouvelle colonne, défaut false — tous les
--     paiements existants restent des paiements normaux, aucune régression).
--  2. ledger_entry : ajoute une colonne finale excluded_from_balance
--     (Vague 2 §20 : CREATE OR REPLACE conserve les colonnes existantes dans
--     le même ordre). false pour toutes les branches sauf 'payment', où elle
--     vaut p.is_historical_import. La ligne reste visible dans l'historique
--     (Transactions, vue mensuelle d'août, etc.) à sa vraie paid_date — seul
--     son impact sur le solde du compte change.
--  3. account_current_balance : movements_since exclut désormais les lignes
--     ledger_entry marquées excluded_from_balance. deadline_with_balance
--     (reste_a_payer) n'est PAS touchée : elle lit directement la table
--     payment, indépendamment de ledger_entry/account_current_balance — un
--     paiement historique continue donc de solder correctement son échéance.

-- AlterTable
ALTER TABLE "payment" ADD COLUMN "is_historical_import" BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- LedgerEntry — extension R6.2 corrections finales §1 : ajoute
-- excluded_from_balance en fin de liste de colonnes (13e colonne).
-- ============================================================
CREATE OR REPLACE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, id, household_id, actual_date AS occurred_at, amount, to_account_id AS account_id,
         'Transfert entrant'::text AS label, NULL::text AS category_id,
         NULL::text AS category_type_id, NULL::text AS category_type_name,
         NULL::text AS category_subtype_id, NULL::text AS category_subtype_name,
         false AS excluded_from_balance
    FROM "account_transfer" WHERE status = 'confirme' AND to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, id, household_id, actual_date, -amount, from_account_id,
         'Transfert sortant'::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false
    FROM "account_transfer" WHERE status = 'confirme' AND from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id,
         COALESCE(a.reason, 'Ajustement')::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false
    FROM "adjustment" a JOIN "financial_account" fa ON fa.id = a.account_id
  UNION ALL
  SELECT 'income'::text, io.id, isrc.household_id, io.actual_date, io.actual_amount, io.account_id,
         isrc.label, isrc.category_id,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false
    FROM "income_occurrence" io JOIN "income_source" isrc ON isrc.id = io.income_source_id
    WHERE io.status = 'recu'
  UNION ALL
  SELECT 'payment'::text, p.id, cp.household_id, p.paid_date,
    CASE p.type
      WHEN 'paiement' THEN -p.amount          -- sortie du compte payeur (correction V2.1)
      WHEN 'remboursement' THEN p.amount      -- entrée sur le compte receveur
      WHEN 'ajustement' THEN CASE p.direction WHEN 'augmente_paye' THEN -p.amount ELSE p.amount END
    END,
    p.account_id,
    cp.label,
    cp.category_id,
    NULL::text, NULL::text, NULL::text, NULL::text,
    p.is_historical_import
  FROM "payment" p
    JOIN "deadline" d ON d.id = p.deadline_id
    JOIN "charge_plan" cp ON cp.id = d.charge_plan_id
  UNION ALL
  SELECT 'budget_expense'::text, be.id, vb.household_id, be.spent_date, -be.amount, be.account_id,
         COALESCE(c.name, 'Dépense budget')::text, be.category_id,
         be.category_type_id, ct.name, be.category_subtype_id, cs.name,
         false
  FROM "budget_expense" be
    JOIN "variable_budget" vb ON vb.id = be.variable_budget_id
    LEFT JOIN "category" c ON c.id = be.category_id
    LEFT JOIN "category_type" ct ON ct.id = be.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = be.category_subtype_id
  UNION ALL
  SELECT 'adhoc_expense'::text, ae.id, ae.household_id, ae.spent_date, -ae.amount, ae.account_id,
         COALESCE(c.name, 'Dépense ponctuelle')::text, ae.category_id,
         ae.category_type_id, ct.name, ae.category_subtype_id, cs.name,
         false
  FROM "adhoc_expense" ae
    LEFT JOIN "category" c ON c.id = ae.category_id
    LEFT JOIN "category_type" ct ON ct.id = ae.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = ae.category_subtype_id;

-- ============================================================
-- account_current_balance — movements_since exclut les lignes marquées
-- excluded_from_balance (paiements de reprise historique). declared_balance
-- (snapshot) est inchangé : seul le delta post-snapshot est concerné.
-- ============================================================
CREATE OR REPLACE VIEW "account_current_balance" AS
  SELECT fa.id AS account_id,
    COALESCE(snap.declared_balance, 0) + COALESCE(mv.movements_since, 0) AS solde_courant
  FROM "financial_account" fa
  LEFT JOIN LATERAL (
    SELECT declared_balance, declared_at
    FROM "account_balance_snapshot"
    WHERE account_id = fa.id
    ORDER BY declared_at DESC
    LIMIT 1
  ) snap ON true
  LEFT JOIN LATERAL (
    SELECT SUM(amount) AS movements_since
    FROM "ledger_entry" le
    WHERE le.account_id = fa.id
      AND le.occurred_at > COALESCE(snap.declared_at, '-infinity'::timestamp)
      AND NOT le.excluded_from_balance
  ) mv ON true;
