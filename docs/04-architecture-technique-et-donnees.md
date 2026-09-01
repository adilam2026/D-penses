# 04 — Architecture technique, modèle de données, notifications, offline, sécurité (V2)

> Couvre les points O, P, Q, R, S. S'appuie sur le modèle métier V2 (document 02) — comptes financiers, rapprochement, transferts, `reste_a_payer` généralisé, statuts scindés financier/temporel.

---

## O. Choix techniques recommandés

Inchangé dans ses grandes lignes (mobile React Native/Flutter, backend API typée, PostgreSQL, auth OAuth2/OIDC + JWT court + refresh, stockage objet S3-compatible, pas d'IA générative en V1). Deux précisions V2 :

### O.1 Le calcul du solde de compte est une fonction pure, pas un champ
`solde_courant(compte, T)` (G.1) doit être implémenté comme une fonction déterministe côté serveur qui lit `AccountBalanceSnapshot` + les mouvements réels depuis cette date — jamais un champ `balance` mis à jour de manière impérative à chaque écriture (source classique de désynchronisation). Un cache matérialisé (vue matérialisée PostgreSQL ou colonne dénormalisée) peut exister pour la performance, mais toujours **recalculable** et jamais considéré comme la vérité — même principe que pour `SavingsPocket.current_amount` (RG-071/IF-07/IF-08).

### O.2 Statut temporel jamais stocké
`computed_temporal_status(deadline, today)` (document 02, F.2) est calculé à la requête (SQL `CASE` ou couche applicative), jamais persisté en base — évite un job nocturne qui muterait des milliers de lignes uniquement parce que le temps passe, et élimine toute possibilité qu'une formule financière lise accidentellement ce champ (RG-050/IF-11).

### O.3 Source de vérité unique — étendue aux comptes
Les formules G.1 à G.13 restent implémentées une seule fois côté serveur (inchangé). S'y ajoute désormais : le solde d'un compte, le montant d'une poche/provision, et `reste_a_payer` d'une échéance sont **tous les trois** des valeurs calculées à la demande à partir des mouvements réels/typés — jamais des colonnes qu'un client pourrait modifier directement.

---

## P. Modèle de données proposé (V2)

```sql
-- SOCLE (inchangé)
household(id, name, currency)
user(id, email, password_hash, first_name, last_name, avatar_url)
household_membership(id, household_id, user_id, role, joined_at)
child(id, household_id, first_name, last_name, birth_date, school_name,
      school_class, school_year, status)
category(id, household_id?, name, icon, kind, is_system)
household_settings(id, household_id, security_margin_amount, seuil_a_venir_days,
                    seuil_a_payer_days, variable_budget_projection_mode)
-- security_margin_amount vit uniquement ici (household_settings), jamais dupliqué sur household

-- COMPTES FINANCIERS (nouveau)
financial_account(id, household_id, name, type, owner_user_id?,
                   status ENUM(actif,archivé),
                   include_in_operational_treasury BOOL DEFAULT true,
                   is_protected BOOL DEFAULT false, currency DEFAULT 'MAD')
account_balance_snapshot(id, account_id, declared_balance, declared_at,
                          source ENUM(manuel,import), created_by_user_id)
reconciliation(id, account_id, computed_balance, declared_balance,
                discrepancy, reconciled_at, status ENUM(pending,résolue),
                created_by_user_id)
adjustment(id, account_id, amount /* signé */, reason, type ENUM(ecart_rapprochement,correction,autre),
            linked_reconciliation_id?, created_by_user_id, occurred_at)
account_transfer(id, household_id, from_account_id?, to_account_id?, amount,
                  planned_date, actual_date?, status ENUM(prévu,confirmé,annulé),
                  type ENUM(interne,retrait_especes,depot_especes),
                  linked_pocket_type?, linked_pocket_id?, confirmed_by_user_id?)

-- REVENUS
income_source(id, household_id, label, beneficiary_user_id?, category_id,
              recurrence_rule?, usual_amount, is_recurring, default_account_id, status)
income_occurrence(id, income_source_id, usual_date, actual_date?,
                   planned_amount, actual_amount?, account_id,
                   status, confirmed_by_user_id?, confirmed_at?)

-- CHARGES / ÉCHÉANCES / PAIEMENTS
charge_plan(id, household_id, label, category_id, generation_mode,
            recurrence_rule?, default_account_id,
            obligation_status ENUM(obligatoire,optionnelle_envisagée,optionnelle_souscrite,optionnelle_refusée)
              DEFAULT 'obligatoire',                                        -- V2.2, remplace is_mandatory (RG-105)
            financial_plan_id?,                                             -- V2.2 (RG-110)
            start_date, end_date?, priority_level)
charge_plan_child(charge_plan_id, child_id)
deadline(id, charge_plan_id,
         expected_billing_date?, billing_date?, due_date,                   -- V2.2 (RG-100)
         amount_due /* alias amount_current */,
         amount_status ENUM(inconnu,estimé,confirmé) DEFAULT 'estimé',      -- V2.2, remplace is_estimated (RG-102)
         amount_initial_estimated?, confirmed_at?,                          -- V2.2 (RG-104)
         financial_status ENUM(ouverte,partiellement_payée,soldée,annulée),
         -- pas de colonne de statut temporel : calculé à la lecture (O.2)
         provision_id?)
-- amount_due est NULL si et seulement si amount_status = 'inconnu' (RG-103, IF-24) — jamais 0 dans ce cas
deadline_child_allocation(deadline_id, child_id, allocation_amount)         -- V2.2, purement analytique (RG-116)

-- FinancialPlan (nouveau V2.2, résout le point 7)
financial_plan(id, household_id, label, period_start, period_end, linked_provision_id?)
-- financial_plan_beneficiary : cf. P.1bis (typée, avec vraies FK — RG-114, corrigé lors de la revue de cohérence finale)
-- Aucune colonne d'agrégat sur financial_plan : tout est calculé à la lecture (RG-111/IF-23, cf. G.15)
payment(id, deadline_id, amount /* toujours > 0 */, paid_date, account_id,
        type ENUM(paiement,remboursement,ajustement),
        direction ENUM(augmente_paye,diminue_paye)? /* requis seulement si type=ajustement */,
        funding_source ENUM(compte,provision) DEFAULT 'compte',           -- V2.1
        provision_id? /* requis si funding_source=provision, cf. RG-095 */, -- V2.1
        recorded_by_user_id, notes?)
-- reste_a_payer(deadline) : vue/fonction SQL, pas une colonne (RG-016)
-- couverture_affectée / engagement_non_couvert (deadline) : vue/fonction SQL, cf. P.3 (V2.1)

-- BUDGETS VARIABLES / DÉPENSES
variable_budget(id, household_id, category_id, reference_amount,
                 reference_period, week_start_day ENUM(lundi..dimanche) DEFAULT 'lundi', -- V2.1, cf. RG-098
                 start_date, end_date?)
budget_expense(id, variable_budget_id, amount, spent_date, category_id,
               account_id, recorded_by_user_id)
adhoc_expense(id, household_id, category_id, amount, spent_date,
              account_id, recorded_by_user_id)

-- ÉPARGNE / PROVISIONS / OBJECTIFS
savings_pocket(id, household_id, name, owner_user_id?, is_protected,
                allocation_mode ENUM(virtual_allocation,backed_by_account),
                linked_account_id? /* UNIQUE si backed_by_account, cf. IF-14 */,
                target_amount?, target_date?)
                -- current_amount : PAS de colonne, calculé (RG-071/IF-07/IF-08)
provision(id, household_id, name, allocation_mode, linked_account_id?,
          is_flexible)
pocket_movement(id, pocket_type, pocket_id, planned_date, planned_amount,
                 actual_date?, actual_amount?, status,
                 movement_type ENUM(contribution,retrait),
                 intention_label? /* libre, purement informatif, V2.2 (RG-109/IF-22) */)
                 -- seule table utilisée pour allocation_mode = virtual_allocation ;
                 -- absente/informative pour backed_by_account (RG-073)
goal(id, household_id, name, target_price, target_date?, priority_level,
     linked_pocket_id?, status)
goal_contribution(id, goal_id, planned_date, planned_amount,
                    actual_date?, actual_amount?, status)

-- INTELLIGENCE / TRANSVERSE
simulation_scenario(id, household_id, created_by_user_id, name, payload, status)
alert(id, household_id, type, severity, entity_type?, entity_id?, message, resolved_at?)
attachment(id, entity_type, entity_id, file_url, file_type, uploaded_by_user_id)
audit_event(id, household_id, entity_type, entity_id, action, field_name?,
            old_value?, new_value?, actor_user_id, occurred_at)
notification_preference(id, user_id, alert_type, channel, threshold_days?, enabled)
device(id, user_id, push_token?, platform, last_seen_at, revoked_at?)
```

### P.1 Contraintes d'intégrité clés (V2)

```sql
-- Anti-double-comptage (IF-14) : un compte ne backe qu'une seule poche/provision
CREATE UNIQUE INDEX ON savings_pocket(linked_account_id) WHERE allocation_mode = 'backed_by_account';
CREATE UNIQUE INDEX ON provision(linked_account_id) WHERE allocation_mode = 'backed_by_account';

-- Payment.amount toujours positif (RG-015)
ALTER TABLE payment ADD CONSTRAINT positive_amount CHECK (amount > 0);
ALTER TABLE payment ADD CONSTRAINT direction_requires_adjustment
  CHECK (direction IS NULL OR type = 'ajustement');

-- reste_a_payer comme fonction, exposée en vue pour les lectures fréquentes
CREATE VIEW deadline_with_balance AS
SELECT d.*,
       d.amount_due - COALESCE(SUM(
         CASE p.type
           WHEN 'paiement' THEN p.amount
           WHEN 'remboursement' THEN -p.amount
           WHEN 'ajustement' THEN CASE p.direction WHEN 'augmente_paye' THEN p.amount ELSE -p.amount END
         END), 0) AS reste_a_payer
FROM deadline d LEFT JOIN payment p ON p.deadline_id = d.id
GROUP BY d.id;
-- Si d.amount_due EST NULL (amount_status='inconnu'), reste_a_payer est NULL par propagation SQL naturelle —
-- jamais 0 (RG-103/IF-24). Les agrégations (SUM) qui l'utilisent ignorent nativement les NULL : une Deadline
-- inconnue sort donc des sommes numériques sans jamais y être comptée comme 0. La couche applicative doit
-- séparément signaler cette exclusion (G.14) plutôt que la laisser silencieuse.

-- Solde de poche virtuelle, calculé (RG-071/IF-07)
CREATE VIEW savings_pocket_balance AS
SELECT sp.id,
  CASE sp.allocation_mode
    WHEN 'backed_by_account' THEN (SELECT solde_courant FROM account_current_balance WHERE account_id = sp.linked_account_id)
    ELSE COALESCE((SELECT SUM(CASE movement_type WHEN 'contribution' THEN actual_amount ELSE -actual_amount END)
                    FROM pocket_movement WHERE pocket_type='savings_pocket' AND pocket_id=sp.id AND status='confirmé'), 0)
  END AS current_amount
FROM savings_pocket sp;
```

### P.1bis — Intégrité référentielle des relations bénéficiaires *(V2.2, résout le point 4 de la revue de cohérence finale)*

> La V2.2 initiale ne modélisait `financial_plan_beneficiary` que par un `beneficiary_ref` polymorphe non typé — insuffisant pour de vraies clés étrangères PostgreSQL. Corrigé ici avec un type explicite, une contrainte d'exclusivité et de vraies FK (RG-114/IF-30). Ce schéma est le patron à réutiliser pour toute future relation bénéficiaire mêlant `User` et `Child`.

```sql
CREATE TYPE beneficiary_type AS ENUM ('user', 'child');

CREATE TABLE financial_plan_beneficiary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_plan_id UUID NOT NULL REFERENCES financial_plan(id) ON DELETE CASCADE,
  beneficiary_type beneficiary_type NOT NULL,
  user_id UUID REFERENCES "user"(id),
  child_id UUID REFERENCES child(id),
  CONSTRAINT beneficiary_type_consistency CHECK (
    (beneficiary_type = 'user'  AND user_id  IS NOT NULL AND child_id IS NULL) OR
    (beneficiary_type = 'child' AND child_id IS NOT NULL AND user_id  IS NULL)
  ),
  CONSTRAINT unique_beneficiary UNIQUE (financial_plan_id, beneficiary_type, user_id, child_id)
);
```
Deux vraies clés étrangères (`user_id`, `child_id`), jamais un identifiant texte/UUID non typé faisant office de référence implicite. Un enregistrement pointe toujours vers exactement un `User` ou un `Child`, jamais les deux, jamais aucun.

**Contrainte de ventilation analytique** (RG-116bis/IF-29) — un `CHECK` PostgreSQL classique ne peut pas sommer plusieurs lignes ; la contrainte s'implémente en trigger `AFTER INSERT OR UPDATE` :
```sql
CREATE FUNCTION check_deadline_allocation_ceiling() RETURNS TRIGGER AS $$
DECLARE
  v_amount_current NUMERIC;
  v_total_allocated NUMERIC;
BEGIN
  SELECT amount_due INTO v_amount_current FROM deadline WHERE id = NEW.deadline_id;
  IF v_amount_current IS NOT NULL THEN               -- amount_status = 'inconnu' : rien à borner (RG-103)
    SELECT COALESCE(SUM(allocation_amount), 0) INTO v_total_allocated
    FROM deadline_child_allocation WHERE deadline_id = NEW.deadline_id;
    IF v_total_allocated > v_amount_current THEN
      RAISE EXCEPTION 'Ventilation (% DH) supérieure au montant de l''échéance (% DH)', v_total_allocated, v_amount_current;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deadline_allocation_ceiling
  AFTER INSERT OR UPDATE ON deadline_child_allocation
  FOR EACH ROW EXECUTE FUNCTION check_deadline_allocation_ceiling();
```

### P.2 `LedgerEntry` — vue comptable consolidée (résout le point 16)

> **Correction V2.1** — la V2 comptait à tort tout `Payment` de type `paiement` comme une **entrée** (`+amount`) sur le compte payeur. C'est l'inverse : un paiement réel fait **sortir** l'argent du compte. Le signe utilisé ici (impact sur le **solde du compte**) est indépendant du signe utilisé par `reste_a_payer` (RG-015, impact sur la **dette de l'échéance**) — les deux ne doivent jamais être confondus (IF-20).

```sql
CREATE VIEW ledger_entry AS
  SELECT 'income' AS kind, id, household_id, actual_date AS occurred_at, actual_amount AS amount, account_id FROM income_occurrence WHERE status='reçu'
  UNION ALL
  SELECT 'payment', id, (SELECT household_id FROM charge_plan cp JOIN deadline d ON d.charge_plan_id=cp.id WHERE d.id=deadline_id),
         paid_date,
         CASE
           WHEN type = 'paiement' THEN -amount                                                  -- sortie du compte payeur
           WHEN type = 'remboursement' THEN amount                                               -- entrée sur le compte receveur
           WHEN type = 'ajustement' AND direction = 'augmente_paye' THEN -amount                 -- se comporte comme un paiement
           WHEN type = 'ajustement' AND direction = 'diminue_paye' THEN amount                   -- se comporte comme un remboursement
         END,
         account_id FROM payment
  UNION ALL
  SELECT 'adhoc_expense', id, household_id, spent_date, -amount, account_id FROM adhoc_expense
  UNION ALL
  SELECT 'budget_expense', id, (SELECT household_id FROM variable_budget vb WHERE vb.id=variable_budget_id),
         spent_date, -amount, account_id FROM budget_expense
  UNION ALL
  SELECT 'transfer', id, household_id, actual_date, amount, to_account_id FROM account_transfer WHERE status='confirmé'
  UNION ALL
  SELECT 'transfer_out', id, household_id, actual_date, -amount, from_account_id FROM account_transfer WHERE status='confirmé'
  UNION ALL
  SELECT 'adjustment', id, (SELECT household_id FROM financial_account fa WHERE fa.id=account_id), occurred_at, amount, account_id FROM adjustment;
```
Reste purement dérivée (lecture seule) — utilisée pour l'écran Transactions **et** pour recalculer `solde_courant` (G.1). Aucune écriture ne cible jamais cette vue directement.

**Test de régression obligatoire (à automatiser, cf. document 05 Lot 2)** :
```
Étant donné : Compte = 10 000 DH
Quand : Payment(deadline=Facture X, amount=1 000, type='paiement', account_id=Compte)
Alors : solde_courant(Compte) = 9 000 DH   (et non 11 000 DH)
```

### P.3 Couverture provision/échéance — `engagement_non_couvert` (V2.1, RG-090)

Calcul procédural (allocation chronologique séquentielle), exprimé ici en fonction/requête à fenêtrage plutôt qu'en simple vue déclarative :

```sql
CREATE FUNCTION engagement_non_couvert(p_deadline_id UUID) RETURNS NUMERIC AS $$
  WITH linked AS (
    SELECT d.id, d.due_date, deadline_with_balance.reste_a_payer,
           SUM(deadline_with_balance.reste_a_payer) OVER (ORDER BY d.due_date, d.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS deja_couvert_par_precedentes
    FROM deadline d
    JOIN deadline_with_balance ON deadline_with_balance.id = d.id
    WHERE d.provision_id = (SELECT provision_id FROM deadline WHERE id = p_deadline_id)
      AND d.financial_status IN ('ouverte','partiellement_payée')
  ),
  provision_amount AS (
    SELECT current_amount FROM provision_balance
    WHERE provision_id = (SELECT provision_id FROM deadline WHERE id = p_deadline_id)
  )
  SELECT GREATEST(0, reste_a_payer -
           GREATEST(0, LEAST(reste_a_payer, (SELECT current_amount FROM provision_amount) - COALESCE(deja_couvert_par_precedentes, 0))))
  FROM linked WHERE id = p_deadline_id;
$$ LANGUAGE SQL STABLE;
```
Traduit directement RG-090 : la fenêtre cumule le `reste_a_payer` des échéances liées **antérieures** (triées par `due_date`) pour déterminer combien de la provision est déjà « consommée » avant d'atteindre l'échéance considérée, puis calcule ce qu'il reste de disponible pour elle.

---

## Q. Stratégie notifications
Inchangée (agrégation par défaut, plafond quotidien, priorité retard > dépassement > tension > confirmation > conseil), avec deux ajouts :

| Type (nouveau) | Déclencheur | Seuil par défaut |
|---|---|---|
| Rapprochement | Aucun `AccountBalanceSnapshot` depuis N jours (H-16) | 60 jours |
| Tension provision court terme | RG-032ter | mois_restants < 1 |
| Facture attendue non reçue *(V2.2)* | `today > expected_billing_date` et `billing_date` vide (RG-101) | dès dépassement, dans la fenêtre `seuil_à_venir` |
| Donnée manquante pertinente *(V2.2)* | Montant `inconnu` ou option en attente dont la `due_date`/date de décision entre dans l'horizon (RG-117) | fenêtre `seuil_à_venir`, jamais plus tôt |

---

## R. Stratégie offline / synchronisation
Inchangée dans son principe (consultation offline complète en V1, saisie en file d'attente simple, résolution avancée en V2, événements horodatés et attribués rejoués dans l'ordre serveur). Précision V2 : un `AccountTransfer` ou un `Reconciliation` créés hors-ligne suivent la même mécanique de conflit que les autres écritures (H-01) — en cas de double rapprochement concurrent sur le même compte, le premier reçu par le serveur gagne, le second est proposé comme un rapprochement *complémentaire* plutôt que rejeté silencieusement (un rapprochement n'est pas une simple valeur à écraser, deux déclarations successives peuvent toutes deux être légitimes).

---

## S. Sécurité
Inchangée (auth, isolation stricte par foyer, chiffrement, journalisation, suppression de compte/foyer). Précision V2 : `financial_account`, comme toute entité métier, porte `household_id` et est donc couvert par l'isolation stricte (Row-Level Security) — un compte ne peut jamais être référencé (`linked_account_id`, `account_id`) par une entité d'un autre foyer, contrainte vérifiée en base en plus de l'application.
