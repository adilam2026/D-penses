-- Validation fonctionnelle finale — 2 bugs réels trouvés en testant les
-- parcours utilisateur bout en bout sur l'application réelle (pas seulement
-- les tests unitaires), corrigés ici sans aucun changement de logique métier
-- (uniquement les 2 vues SQL déjà existantes, "CREATE OR REPLACE VIEW").

-- ============================================================
-- BUG 1 — account_current_balance excluait silencieusement un revenu/
-- paiement confirmé "aujourd'hui" le jour même de la création du compte.
--
-- Repro : POST /income-occurrences/:id/confirm avec actualDate au format
-- "YYYY-MM-DD" (exactement ce qu'envoie todayIso() côté mobile/web pour
-- "aujourd'hui") est parsé en minuit UTC. Si le compte a été créé PLUS TARD
-- ce même jour calendaire (account_balance_snapshot.declared_at porte
-- l'heure réelle de création, ex. 06:50), la comparaison stricte
-- `occurred_at > declared_at` (minuit < 06:50) excluait ce mouvement du
-- solde réel — alors qu'il restait visible dans l'historique des
-- transactions (vue différente). Le compte affichait donc un solde
-- INFÉRIEUR à la réalité après un revenu/paiement pourtant bien enregistré.
--
-- account_balance_snapshot n'est créé QU'UNE SEULE FOIS par compte, à la
-- création (accounts.service.ts create(), jamais recréé par un
-- rapprochement) : aucune écriture ne peut légitimement précéder le jour
-- calendaire de création. Comparer au DÉBUT de ce jour (date_trunc('day'))
-- plutôt qu'à l'instant exact inclut donc correctement toute écriture du
-- même jour, sans jamais risquer de compter deux fois quoi que ce soit —
-- le solde déclaré à la création ne pouvait déjà inclure aucun mouvement.
-- (Si un futur type de rapprochement venait un jour RECRÉER un nouveau
-- snapshot en cours de journée après des mouvements déjà survenus ce
-- jour-là, cette hypothèse ne tiendrait plus : à réexaminer à ce moment-là.)
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
      AND le.occurred_at >= COALESCE(date_trunc('day', snap.declared_at), '-infinity'::timestamp)
      AND NOT le.excluded_from_balance
  ) mv ON true;

-- ============================================================
-- BUG 2 — le libellé personnalisé d'une dépense (AdHocExpense.label /
-- BudgetExpense.label, "Refonte maquette V6B §12" : champ de saisie à part
-- entière, ex. "Consultation pédiatre", "jamais dérivé de la catégorie")
-- était totalement ignoré par la vue ledger_entry, qui retombait TOUJOURS
-- sur le nom de la catégorie (COALESCE(c.name, 'Dépense ponctuelle')),
-- même quand un libellé explicite avait été saisi et enregistré en base.
--
-- Repro : POST /expenses { label: "Consultation", categoryId: <Santé> }
-- créait bien la ligne avec label='Consultation' en base, mais la liste
-- Transactions affichait "Santé" (le nom de catégorie) au lieu du libellé
-- réellement saisi — sur TOUTE dépense ponctuelle/budgétaire dotée d'un
-- libellé mais sans type/sous-type de catégorie (le cas "Type · Sous-type"
-- reste géré tel quel côté application, transactions.service.ts, jamais
-- modifié ici : cette correction ne touche que le repli catégorie/libellé,
-- conformément au commentaire déjà présent dans schema.prisma "NULL =
-- ancienne dépense créée avant cette évolution, l'affichage retombe alors
-- sur Type · Sous-type (comportement historique inchangé)".
-- ============================================================
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
         COALESCE(be.label, c.name, 'Dépense budget')::text, be.category_id,
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
         COALESCE(ae.label, c.name, 'Dépense ponctuelle')::text, ae.category_id,
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
