-- Correction UX (Transactions) — extension additive de "ledger_entry" : ajoute
-- linked_reconciliation_id en fin de liste de colonnes (21e colonne), pour
-- distinguer côté transactions.service.ts un Adjustment de CORRECTION d'une
-- dépense (expenses.service.ts correctAdhoc/reverseAdhoc, linked_reconciliation_id
-- toujours NULL, doit rester visible dans les transactions) d'un Adjustment
-- d'ÉCART DE RAPPROCHEMENT de solde (accounts.service.ts adjustReconciliation,
-- linked_reconciliation_id renseigné) — les deux partagent aujourd'hui le même
-- kind='adjustment', jamais distingués. NULL dans les 6 branches hors
-- 'adjustment' (jamais de rapprochement ailleurs). Le calcul du solde réel
-- (vue account_current_balance, construite sur ledger_entry) continue d'inclure
-- TOUS les ajustements sans exception : seul l'AFFICHAGE des transactions filtre,
-- jamais le moteur de trésorerie.
CREATE OR REPLACE VIEW "ledger_entry" AS
  SELECT 'transfer_in'::text AS kind, at.id, at.household_id, at.actual_date AS occurred_at, at.amount, at.to_account_id AS account_id,
         'Transfert entrant'::text AS label, NULL::text AS category_id,
         NULL::text AS category_type_id, NULL::text AS category_type_name,
         NULL::text AS category_subtype_id, NULL::text AS category_subtype_name,
         false AS excluded_from_balance,
         at.confirmed_by_id AS created_by_user_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), '') AS created_by_name,
         NULL::text AS budget_id,
         NULL::text AS financial_plan_id,
         NULL::text AS vehicle_id,
         NULL::text AS housing_id,
         NULL::text AS child_id,
         NULL::text AS linked_reconciliation_id
    FROM "account_transfer" at
    LEFT JOIN "user" u ON u.id = at.confirmed_by_id
    WHERE at.status = 'confirme' AND at.to_account_id IS NOT NULL
  UNION ALL
  SELECT 'transfer_out'::text, at.id, at.household_id, at.actual_date, -at.amount, at.from_account_id,
         'Transfert sortant'::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         at.confirmed_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text
    FROM "account_transfer" at
    LEFT JOIN "user" u ON u.id = at.confirmed_by_id
    WHERE at.status = 'confirme' AND at.from_account_id IS NOT NULL
  UNION ALL
  SELECT 'adjustment'::text, a.id, fa.household_id, a.occurred_at, a.amount, a.account_id,
         COALESCE(a.reason, 'Ajustement')::text, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         a.created_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         a.linked_reconciliation_id
    FROM "adjustment" a
    JOIN "financial_account" fa ON fa.id = a.account_id
    LEFT JOIN "user" u ON u.id = a.created_by_id
  UNION ALL
  SELECT 'income'::text, io.id, isrc.household_id, io.actual_date, io.actual_amount, io.account_id,
         isrc.label, isrc.category_id,
         NULL::text, NULL::text, NULL::text, NULL::text,
         false,
         io.confirmed_by_user_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text
    FROM "income_occurrence" io
    JOIN "income_source" isrc ON isrc.id = io.income_source_id
    LEFT JOIN "user" u ON u.id = io.confirmed_by_user_id
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
    p.is_historical_import,
    p.recorded_by_id,
    NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
    NULL::text,
    cp.financial_plan_id,
    cp.vehicle_id,
    cp.housing_id,
    child_link.child_id,
    NULL::text
  FROM "payment" p
    JOIN "deadline" d ON d.id = p.deadline_id
    JOIN "charge_plan" cp ON cp.id = d.charge_plan_id
    LEFT JOIN "user" u ON u.id = p.recorded_by_id
    LEFT JOIN LATERAL (
      SELECT MIN(cpc.child_id) AS child_id
      FROM "charge_plan_child" cpc
      WHERE cpc.charge_plan_id = cp.id
      HAVING COUNT(*) = 1
    ) child_link ON true
  UNION ALL
  SELECT 'budget_expense'::text, be.id, vb.household_id, be.spent_date,
    CASE be.type
      WHEN 'depense' THEN -be.amount
      WHEN 'remboursement' THEN be.amount
      WHEN 'ajustement' THEN CASE be.direction WHEN 'augmente_depense' THEN -be.amount ELSE be.amount END
    END,
    be.account_id,
         COALESCE(c.name, 'Dépense budget')::text, be.category_id,
         be.category_type_id, ct.name, be.category_subtype_id, cs.name,
         false,
         be.recorded_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         be.variable_budget_id,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text
  FROM "budget_expense" be
    JOIN "variable_budget" vb ON vb.id = be.variable_budget_id
    LEFT JOIN "category" c ON c.id = be.category_id
    LEFT JOIN "category_type" ct ON ct.id = be.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = be.category_subtype_id
    LEFT JOIN "user" u ON u.id = be.recorded_by_id
  UNION ALL
  SELECT 'adhoc_expense'::text, ae.id, ae.household_id, ae.spent_date, -ae.amount, ae.account_id,
         COALESCE(c.name, 'Dépense ponctuelle')::text, ae.category_id,
         ae.category_type_id, ct.name, ae.category_subtype_id, cs.name,
         false,
         ae.recorded_by_id,
         NULLIF(concat_ws(' ', u.first_name, u.last_name), ''),
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text,
         NULL::text
  FROM "adhoc_expense" ae
    LEFT JOIN "category" c ON c.id = ae.category_id
    LEFT JOIN "category_type" ct ON ct.id = ae.category_type_id
    LEFT JOIN "category_subtype" cs ON cs.id = ae.category_subtype_id
    LEFT JOIN "user" u ON u.id = ae.recorded_by_id;
