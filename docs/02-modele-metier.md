# 02 — Modèle métier (V2)

> Couvre les points C, D, E, F, G, H. **Document normatif** — toute règle ou formule citée ailleurs doit pointer ici.
>
> **V2 — changements structurants par rapport à la V1** : introduction d'une vraie notion de compte financier (`FinancialAccount`), séparation stricte trésorerie physique / capacité libre, correction du calcul des engagements (indépendant du statut UX), généralisation de `reste_a_payer`, refonte du modèle de statuts des échéances (financier persistant vs. temporel calculé), correction de la contradiction sur les remboursements, source de vérité unique pour les soldes d'épargne/provision, mécanique de rapprochement bancaire, transferts inter-comptes, simulateur enrichi, calcul temporel des provisions, et une nouvelle section **Invariants financiers**. Le détail des corrections est synthétisé en fin de réponse.

---

## C. Entités métier

### C.1 Socle
Inchangé — `User`, `Household`, `HouseholdMembership`, `Child`, `HouseholdSettings`, `Category`, `Beneficiary/MemberTag`.

### C.2 Comptes financiers *(nouveau)*

| Entité | Rôle |
|---|---|
| **FinancialAccount** | Lieu réel où se trouve l'argent — compte courant, compte épargne, espèces. Porte un solde physique. |
| **AccountBalanceSnapshot** | Solde déclaré par l'utilisateur à une date donnée (rapprochement) — point d'ancrage du calcul du solde courant. |
| **Reconciliation** | Comparaison solde calculé / solde déclaré à un instant donné, avec écart identifié. |
| **Adjustment** | Écriture de correction sur un compte (écart de rapprochement, régularisation) — un mouvement réel typé, jamais une réécriture silencieuse. |
| **AccountTransfer** | Mouvement réel entre deux comptes du foyer (ou entre un compte et l'extérieur pour un retrait/dépôt espèces). Impact net foyer toujours nul pour un transfert interne. |

**Principe fondateur (résout le point 15 des remarques)** : un **compte** est un lieu physique où l'argent existe réellement ; une **poche/provision** est une destination logique de cet argent. Un compte peut financer plusieurs poches ; une poche peut éventuellement être adossée à un compte dédié — mais ce sont deux objets distincts, jamais confondus (cf. RG-070).

### C.3 Revenus
Inchangé dans sa structure — `IncomeSource`, `IncomeOccurrence` — avec un ajout : chaque `IncomeOccurrence` référence désormais un `FinancialAccount` cible (celui qui reçoit réellement l'argent).

### C.4 Charges, échéances, paiements

| Entité | Changement V2 |
|---|---|
| **ChargePlan** | Plan de charge unifié (INC-03/V1). **V2.2** : `obligation_status` remplace `is_mandatory` (RG-105) ; rattachable à 0..1 `FinancialPlan` (RG-110). |
| **Deadline** | Statut **scindé** en état financier persistant + état temporel calculé (cf. F.2). `reste_a_payer` devient une valeur calculée centrale (cf. E.3bis). **V2.2** : `expected_billing_date`/`billing_date` distincts de `due_date` (RG-100) ; `amount_status ∈ {inconnu, estimé, confirmé}` remplace `is_estimated` (RG-102) ; ventilation analytique optionnelle par enfant (RG-116). |
| **Payment** | `amount` toujours positif ; `type` porte le sens comptable (cf. RG-015 révisée). Référence un `FinancialAccount`. |
| **VariableBudget / BudgetExpense** | Inchangés structurellement ; `BudgetExpense` référence désormais un `FinancialAccount`. |
| **AdHocExpense** | Référence désormais un `FinancialAccount`. |
| **FinancialPlan** *(nouveau V2.2)* | Regroupement générique thématique de `ChargePlan` sur une période, pour un ou plusieurs bénéficiaires — aucun agrégat stocké (RG-110/111). Le module scolaire en est une vue filtrée. |

### C.5 Épargne, provisions, objectifs

| Entité | Changement V2 |
|---|---|
| **SavingsPocket** | Porte un `allocation_mode` (`virtual_allocation` \| `backed_by_account`). `current_amount` n'est plus une colonne autoritaire (cf. E.5bis). |
| **Provision** | Même logique que `SavingsPocket` (`allocation_mode`, calcul temporel de suffisance, cf. E.5bis). |
| **PocketMovement** | Reste la seule source de vérité des mouvements virtuels confirmés (cf. RG-080). |
| **Goal / GoalContribution** | Inchangés structurellement. |

### C.6 Intelligence & transverses

| Entité | Changement V2 |
|---|---|
| **LedgerEntry** *(vue, ex-« vue calculée » de la V1)* | Renommée et précisée : agrège en lecture seule `IncomeOccurrence.reçu`, `Payment`, `AdHocExpense`, `AccountTransfer.confirmé`, `Adjustment` — sert à afficher l'écran Transactions **et** à recalculer le solde courant d'un compte. Reste dérivée, jamais source de vérité. |
| **ActionItem** | Inchangé (vue calculée). |
| **AuditEvent** | Inchangé. |
| Autres (`Attachment`, `NotificationPreference/Instance`, `Device/Session`, `SimulationScenario`, `Alert`) | Inchangés. |

---

## D. Modèle relationnel

```
Household 1───n FinancialAccount ────── owner_user_id → User (nullable = commun)
FinancialAccount 1───n AccountBalanceSnapshot
FinancialAccount 1───n Reconciliation
FinancialAccount 1───n Adjustment
Household 1───n AccountTransfer ──────── from_account_id → FinancialAccount (nullable = externe)
                                          to_account_id   → FinancialAccount (nullable = externe)
                                          linked_pocket_id → SavingsPocket|Provision (nullable)

Household 1───n HouseholdMembership n───1 User
Household 1───n Child
Household 1───1 HouseholdSettings
Household 1───n Category

Household 1───n IncomeSource ─────────── beneficiary → User (nullable = foyer)
IncomeSource 1───n IncomeOccurrence ───── account_id → FinancialAccount

Household 1───n ChargePlan ────────────── beneficiary_members → [User|Child]* (0..n)
                                          financial_plan_id → FinancialPlan (nullable, V2.2)
ChargePlan 1───n Deadline ──────────────── provision_id → Provision (nullable)
Deadline 1───n Payment ──────────────────── account_id → FinancialAccount
Deadline 0───n Attachment
Deadline 0───n DeadlineChildAllocation ──── child_id → Child  (ventilation analytique, V2.2, RG-116)
ChargePlan }o──o{ Child

Household 1───n FinancialPlan ──────────── beneficiaries → [User|Child]* (0..n)   -- V2.2
                                          linked_provision_id → Provision (nullable)

Household 1───n VariableBudget ────────── category → Category
VariableBudget 1───n BudgetExpense ─────── account_id → FinancialAccount, member_tags → [User|Child]*

Household 1───n AdHocExpense ───────────── account_id → FinancialAccount, category → Category

Household 1───n SavingsPocket ─────────── owner → User (nullable)
                                          allocation_mode ∈ {virtual_allocation, backed_by_account}
                                          linked_account_id → FinancialAccount (si backed_by_account, sinon NULL)
Household 1───n Provision ──────────────── linked_deadlines → Deadline (0..n)
                                          allocation_mode, linked_account_id (idem)
SavingsPocket 1───n PocketMovement       (source de vérité si virtual_allocation ; absent/informatif si backed_by_account)
                                          intention_label optionnel, purement informatif (V2.2, RG-109)
Provision 1───n PocketMovement           (idem)

Household 1───n Goal
Goal 1───n GoalContribution
Goal 0───1 SavingsPocket

Household 1───n SimulationScenario
Household 1───n Alert
(ActionItem, LedgerEntry = vues calculées, pas de table)
```

**Règle d'intégrité clé (V2)** — une `SavingsPocket`/`Provision` en `backed_by_account` référence un `FinancialAccount` qui lui est **exclusivement dédié** (un compte ne peut être `linked_account_id` que d'une seule poche/provision à la fois) — cf. RG-072, la garantie anti-double-comptage.

---

## E. Règles de gestion

### E.0 Règle transverse
- **RG-000** — inchangée (aucune action financière réelle automatique, cf. document 01).

### E.1 Foyer, membres, droits
RG-001 à RG-005 inchangées.

### E.2 Revenus
RG-010 à RG-013 inchangées, avec ajout :
- **RG-014bis** — À la confirmation d'un `IncomeOccurrence` (`reçu`), le compte cible (`account_id`) est obligatoire — pré-rempli par défaut (compte habituel de la source de revenu) pour ne jamais alourdir la saisie (cf. §23 / RG-095).

### E.3 Charges, échéances, paiements

- **RG-014** *(révisée)* — Une `Deadline` porte un **état financier persistant** (`ouverte`, `partiellement_payée`, `soldée`, `annulée` — cf. F.2). Elle reçoit 0..n `Payment`. L'état passe à `partiellement_payée` dès qu'un paiement net existe avec `reste_a_payer > 0` ; à `soldée` uniquement après confirmation explicite de clôture (le simple atteinte du cumul ne suffit pas, un montant estimé pouvant encore être réévalué).
- **RG-015** *(corrigée — contradiction résolue)* — Un `Payment.amount` est **toujours strictement positif**. Le signe comptable est déduit du `type` par le moteur, jamais saisi :
  - `type = paiement` → réduit `reste_a_payer` (signe +)
  - `type = remboursement` → augmente `reste_a_payer` (signe −, ex. avoir reçu du fournisseur)
  - `type = ajustement` → porte un champ `direction ∈ {augmente_paye, diminue_paye}` explicite, réservé aux corrections de solde d'une échéance (distinct d'un `Adjustment` de compte, qui corrige un solde bancaire, cf. RG-085)
- **RG-016** *(généralisée — devient centrale, résout le point 5)* — `reste_a_payer(deadline) = montant_dû_courant − Σ(payments signés selon RG-015)`. C'est **la** valeur utilisée partout : engagements, projections, dashboard, calendrier, alertes, provisions, simulateur, arbitrage — plus aucune formule du produit ne doit utiliser `montant_dû` brut une fois des paiements enregistrés.
- **RG-016bis** — Invariant : `reste_a_payer ≥ 0`, sauf `type = remboursement` explicitement enregistré comme geste de gestion d'un avoir (auquel cas le `reste_a_payer` peut transitoirement redevenir positif après avoir été soldé — cf. H-02).
- RG-017 à RG-020 inchangées, avec précision :
- **RG-020bis** — Le report d'une échéance (« Reporter » dans le parcours de confirmation) **n'est plus un changement de statut** : c'est une modification historisée de `due_date` (nouvel événement d'audit, ancienne date conservée). L'état financier ne bouge pas — cf. F.2.

### E.4 Budgets variables
RG-021, RG-022, RG-023 inchangées.
- **RG-024** *(précisée — résout le point 14)* — Deux vues distinctes, jamais confondues :
  - **Budget contractuel restant** = `budget_période − consommé_à_date`
  - **Prévision au rythme actuel restant** = `(consommé_à_date / jours_écoulés × jours_totaux_période) − consommé_à_date`
  Le montant utilisé dans la **projection** (G.6) et le **simulateur** (G.11) est le maximum prudent des deux (`RG-024bis`), jamais les deux additionnés (ce qui doublonnerait le réel et le futur), et jamais le consommé_à_date une seconde fois.
- **RG-024bis** — `Projection_prudente_restante = MAX(Budget_contractuel_restant, Prévision_rythme_restant, 0)`. Ce choix est un paramètre foyer (`variable_budget_projection_mode`), défaut = `prudent_max` ; alternatives `contractuel` ou `rythme_reel` restent disponibles pour un foyer qui préfère une projection plus optimiste ou plus fidèle au budget engagé. Les deux valeurs (budget contractuel restant / projection au rythme actuel) restent **toujours affichées séparément** dans l'interface — jamais fusionnées silencieusement en un seul chiffre qui remplacerait le budget fixé par l'utilisateur (cf. document 03).
- **RG-098 — Semaine budgétaire = semaine calendaire réelle** *(V2.1, résout le point 6 des remarques)* — Pour un `VariableBudget` en `reference_period = semaine`, la période de suivi n'est **pas** une fenêtre glissante de 7 jours arbitraire : ce sont de vraies semaines calendaires successives, démarrant à `week_start_day` (paramètre foyer, défaut lundi). Une semaine complète comprise dans une fenêtre de calcul vaut `reference_amount` en entier (pas de prorata) ; seule une semaine **partielle** (bord de la fenêtre de calcul, ou tout début du budget) est proratée au nombre réel de jours qu'elle occupe dans cette fenêtre : `montant = (reference_amount / 7) × jours_de_cette_semaine_dans_la_fenêtre`. Un budget mensuel suit la même logique avec des mois calendaires réels (RG-022, inchangée).
- **RG-099 — Le prochain revenu ne redéfinit jamais la période du budget** *(V2.1)* — L'horizon `H*` (date de la prochaine rentrée significative, utilisé dans `Montants_engagés`, G.4/G.5) sert uniquement à déterminer **combien** de semaines/mois de budget variable tombent dans la fenêtre `[T, H*]` — il ne modifie jamais le découpage propre du budget (ses semaines/mois restent alignés sur `week_start_day`, indépendamment des dates de salaire). Chaque `VariableBudget` garde sa fréquence propre, jamais mélangée avec celle d'un autre.

### E.5 Épargne et provisions
- **RG-030, RG-031, RG-034, RG-035** inchangées dans leur principe.
- **RG-032** *(révisée — résout le point 2 et le point 13)* — `reste_à_constituer(provision) = Σ reste_a_payer(deadlines liées, non soldées/non annulées) − provision.current_amount`. Utilise donc désormais `reste_a_payer` (qui décroît avec les paiements partiels) et non plus le montant initial.
- **RG-032bis — Calcul temporel de suffisance** *(nouveau, résout le point 13)* — Quand une provision est liée à plusieurs échéances de dates différentes, le simple `reste / mois restants global` est insuffisant (il peut sous-provisionner une échéance intermédiaire). Algorithme retenu, symétrique de la détection des trous de trésorerie (RG-051) :
  1. Trier les échéances liées ouvertes par `due_date` croissante : d₁…dₙ, `reste_a_payer` r₁…rₙ.
  2. Calculer le besoin cumulé à chaque échéance : `R_i = Σ_{k≤i} r_k`.
  3. `versement_mensuel_recommandé = max_i [ (R_i − current_amount) / mois_restants(aujourd'hui, d_i) ]`, calculé sur tous les i où le numérateur est positif.
  Ce maximum garantit qu'aucun palier intermédiaire n'est sous-financé, même si le total global paraît suffisant à l'échéance finale.
- **RG-032ter — Alerte de tension à court terme** *(nouveau)* — Si `mois_restants(d_i) < 1` pour l'échéance la plus proche et que `current_amount < R_i`, le système n'affiche pas un taux mensuel (non actionnable à si court terme) mais une **alerte de tension immédiate** : montant manquant, date, avec actions proposées (versement ponctuel, report de l'échéance si possible, réduction d'un objectif de priorité inférieure) — jamais une exécution automatique.
- **RG-033** — la formule simple reste la référence pour une provision à échéance unique ; RG-032bis s'applique dès que plusieurs échéances sont liées.

**E.5bis — Anti-double-comptage (résout le point 2 et le point 8)**

- **RG-070 — Séparation compte / poche** — Un `FinancialAccount` est un lieu physique ; une `SavingsPocket`/`Provision` est une destination logique. Une poche référence *éventuellement* un compte (`backed_by_account`) mais n'en est jamais la même entité.
- **RG-071 — Deux modes exclusifs**
  - **`virtual_allocation`** — l'argent reste physiquement dans son(ses) compte(s) d'origine. Le `current_amount` de la poche est une **valeur calculée**, jamais stockée en dur : `current_amount = Σ(PocketMovement confirmés, signés selon leur type)`. Ce montant est déduit dans **Montants réservés** (G.3) et n'affecte jamais un solde de compte.
  - **`backed_by_account`** — l'argent a été réellement transféré vers un compte dédié. Le `current_amount` de la poche **n'est plus une donnée propre** : c'est une lecture directe du solde courant du compte lié (`current_amount = solde_courant(linked_account_id)`). Ce compte porte `include_in_operational_treasury = false` (ou `true` selon protection voulue, cf. RG-074), ce qui le retire déjà du calcul de la trésorerie opérationnelle.
- **RG-072 — Garantie anti-double-comptage** — Un compte ne peut être `linked_account_id` que d'**une seule** poche/provision `backed_by_account` à la fois (contrainte d'unicité en base). Le montant d'une poche `backed_by_account` **n'est jamais additionné** dans **Montants réservés** (G.3) : il est déjà retiré de la **Trésorerie opérationnelle** par l'exclusion de son compte dédié. Additionner les deux reviendrait à déduire le même dirham deux fois — interdit par construction (cf. formule G.3 et Invariant IF-06).
- **RG-073** — Un `AccountTransfer` confirmé vers un compte `backed_by_account` d'une poche est le seul mécanisme qui **fait grandir réellement** cette poche ; un `PocketMovement` confirmé est le seul mécanisme qui fait grandir une poche `virtual_allocation`. Les deux ne se mélangent jamais sur une même poche.
- **RG-074** — Le passage d'une poche de `virtual_allocation` à `backed_by_account` (ou l'inverse) est une action explicite, historisée, qui exige la création (ou suppression) du lien vers un compte dédié — jamais un simple changement de champ silencieux.

### E.5ter — Couverture d'une échéance par une provision *(V2.1 — corrige un double comptage résiduel)*

Le modèle V2 empêchait déjà le double comptage entre compte, poche virtuelle et poche adossée (RG-070→074). Il restait un double comptage possible entre **une provision déjà constituée et l'échéance qu'elle finance** : compter la provision dans `Montants_réservés` (G.3) **et** le montant dû complet de l'échéance dans `Montants_engagés` (G.4) revient à retirer deux fois le même argent de la trésorerie opérationnelle.

- **RG-090 — Couverture chronologique** — Pour une `Provision` liée à une ou plusieurs `Deadline` non soldées/non annulées, triées par `due_date` croissante (d₁…dₙ, `reste_a_payer` r₁…rₙ), la provision couvre ses échéances liées **dans l'ordre chronologique**, jusqu'à épuisement :
  ```
  disponible_provision ← provision.current_amount
  pour i = 1 à n (ordre chronologique) :
      couverture_affectée(dᵢ) = MIN(rᵢ, disponible_provision)
      disponible_provision ← disponible_provision − couverture_affectée(dᵢ)
      engagement_non_couvert(dᵢ) = rᵢ − couverture_affectée(dᵢ)
  ```
  Règle identique que la provision soit `virtual_allocation` ou `backed_by_account` — seul le calcul de `current_amount` en amont diffère (RG-071).
- **RG-091 — Une échéance sans provision liée** a `couverture_affectée = 0` et `engagement_non_couvert = reste_a_payer` — cas particulier de RG-090, aucune formule séparée nécessaire.
- **RG-092 — Non-double-comptage par construction** — `Montants_réservés` (G.3) continue de compter la **totalité** du `current_amount` d'une provision `virtual_allocation` ; `Montants_engagés` (G.4) utilise désormais `engagement_non_couvert` (et non `reste_a_payer` brut) pour toute échéance liée à une provision. La somme des deux reste toujours exactement égale au besoin réel total (`couverture_affectée + engagement_non_couvert = reste_a_payer`, jamais plus, jamais moins) — cf. Invariant IF-16.
- **RG-093 — Une provision `backed_by_account`** est déjà exclue de `Montants_réservés` (RG-072) ; sa couverture réduit néanmoins `engagement_non_couvert` de la même façon (RG-090), ce qui évite de redemander à la trésorerie opérationnelle un montant déjà mis de côté sur le compte dédié.
- **RG-094 — Réallocation naturelle** — Quand une échéance couverte devient `soldée` (payée, avec ou sans consommation explicite de la provision, cf. RG-096), elle sort du tri chronologique de RG-090 dès le calcul suivant. Si la provision n'a pas été explicitement consommée pour ce paiement (RG-096), sa capacité de couverture se reporte naturellement sur l'échéance liée suivante — comportement voulu, pas une anomalie : la provision n'a jamais été physiquement entamée, elle reste donc disponible pour la suite.

### E.5quater — Paiement financé par une provision *(V2.1, résout le point 4 des remarques)*

- **RG-095 — Un `Payment` porte un `funding_source ∈ {compte, provision}`.** Si `compte`, comportement inchangé (V2). Si `provision`, le paiement référence une `Provision` (ou `SavingsPocket`) liée à la `Deadline`, et déclenche **atomiquement**, dans la même transaction :
  1. la création du `Payment` (montant, type `paiement`) ;
  2. si la provision est `virtual_allocation` : la création d'un `PocketMovement` de type `retrait`, confirmé, du même montant, réduisant `current_amount` d'autant ;
  3. si la provision est `backed_by_account` : aucun `PocketMovement` — le `Payment.account_id` est simplement celui du compte dédié (`linked_account_id`), le solde du compte (et donc de la provision) baisse naturellement via G.1 ;
  4. la mise à jour du statut financier de la `Deadline` (`partiellement_payée` ou `soldée` selon RG-014).
  Une seule confirmation utilisateur suffit — RG-000 reste respectée puisque l'utilisateur a explicitement choisi et validé cette source de financement.
- **RG-096 — Financement combiné** — Un même paiement peut se répartir entre plusieurs sources en une seule confirmation (ex. 10 000 DH depuis la provision + 5 000 DH depuis le compte courant si la provision est insuffisante) : cela crée simplement deux `Payment` liés à la même `Deadline`, chacun avec son propre `funding_source`, dans la même transaction atomique — réutilise le mécanisme de paiement partiel déjà existant (RG-014), sans nouvel objet métier.
- **RG-097 — Hors financement explicite, aucun décrément automatique** — Si l'utilisateur paie une échéance liée à une provision **sans** choisir « payer avec la provision » (paiement depuis un compte classique), la provision n'est **jamais** décrémentée automatiquement (RG-000 inchangée) — cf. RG-094 pour la conséquence sur la couverture des échéances suivantes.

### E.3ter — Facturation, montant inconnu et charges optionnelles *(V2.2)*

**Date de facturation ≠ date d'échéance**

- **RG-100** — Une `Deadline` porte trois dates indépendantes : `expected_billing_date` (date attendue de réception de la facture, optionnelle), `billing_date` (date réelle de réception, renseignée à la confirmation), `due_date` (date limite de paiement, inchangée). Aucune de ces dates ne déclenche automatiquement un paiement (RG-000 inchangée) — `billing_date` déclenche au plus une question de confirmation du montant (RG-102), jamais un paiement.
- **RG-101 — Facture attendue non reçue** — Si `today > expected_billing_date` et `billing_date` est toujours vide, une `Action à traiter` qualitative est levée (« Facture T2 attendue mais non encore confirmée »), sans aucun effet sur `reste_a_payer` ni les projections (RG-101 ne rend jamais une facture certaine par simple écoulement du temps).

**Montant inconnu, estimé, confirmé — trois états, pas deux**

- **RG-102** — `Deadline.amount_status ∈ {inconnu, estimé, confirmé}` (remplace le simple booléen `is_estimated` de la V2 — migration : `is_estimated=true → estimé`, `is_estimated=false → confirmé`, `inconnu` est un état nouveau). `amount_current` est **nullable**, et n'est `NULL` que lorsque `amount_status = inconnu`.
- **RG-103 — `NULL` ≠ 0** — Un montant `inconnu` n'est **jamais** traité comme 0 DH, et n'est **jamais** silencieusement omis d'un calcul comme s'il n'existait pas : il est exclu de toute somme numérique (G.4, G.6, G.9, G.11 — cf. G.14) **et** signalé qualitativement partout où cette somme est affichée (« budget incomplet », cf. RG-113).
- **RG-104 — Confirmation de montant, distincte du paiement** — L'action « Facture reçue — confirmer le montant » fait passer `amount_status` de `inconnu`/`estimé` à `confirmé`, met à jour `amount_current`, horodate `confirmed_at`, et **conserve** `amount_initial_estimated` si un montant estimé existait. Cette confirmation peut intervenir **avant** tout paiement (au moment de la réception de facture) — elle n'est pas une conséquence du paiement, contrairement à la confirmation de clôture (RG-014). Toute confirmation de montant déclenche immédiatement le recalcul de `reste_a_payer`, `engagement_non_couvert`, des projections (G.6) et de la couverture provision (RG-090) — cf. G.13, IF-21.

**Charges obligatoires et optionnelles**

- **RG-105** — `ChargePlan.obligation_status ∈ {obligatoire, optionnelle_envisagée, optionnelle_souscrite, optionnelle_refusée}` (remplace le booléen `is_mandatory` de la V2 — migration : `is_mandatory=true → obligatoire`, `is_mandatory=false → optionnelle_souscrite` par défaut, à réévaluer au cas par cas).
- **RG-106 — Deux portées de projection, jamais fusionnées silencieusement** :
  - **Dépenses certaines** = échéances de `ChargePlan` en `obligatoire` ou `optionnelle_souscrite`, à montant connu (`estimé` ou `confirmé`). C'est la portée par défaut de `Montants_engagés` (G.4) et de toutes les projections/simulations (G.6, G.11) — inchangé par rapport à la V2.1.
  - **Options envisagées** = échéances de `ChargePlan` en `optionnelle_envisagée`, à montant connu. Calculées et affichées **séparément**, jamais additionnées par défaut aux Dépenses certaines.
  - **Projection prudente** = Dépenses certaines + Options envisagées — disponible à la demande (bascule explicite dans l'UX, jamais la valeur par défaut du dashboard).
- **RG-107** — Une charge `optionnelle_refusée` est conservée en historique (traçabilité) mais exclue de toute projection, comme une `Deadline` `annulée`.
- **RG-108** — Le passage d'`optionnelle_envisagée` à `optionnelle_souscrite` (ou `refusée`) est une action utilisateur explicite (RG-000) ; dès `optionnelle_souscrite`, la charge intègre les Dépenses certaines au recalcul suivant.

### E.5quinquies — Affectation indicative d'une provision *(V2.2, résout le point 6 des remarques)*

- **RG-109** — Un `PocketMovement` (contribution à une provision) peut porter un `intention_label` optionnel, libre ou lié à une `Deadline` (« destiné à T2 ») — **purement informatif**, à but de pilotage et de compréhension utilisateur. Ce label n'entre dans **aucune** formule : la couverture réelle d'une échéance par une provision reste exclusivement déterminée par l'allocation chronologique de RG-090, qui ignore totalement les `intention_label`. Deux intentions contradictoires (ex. deux versements tous deux « destinés à T2 ») ne créent donc jamais de double réservation — il n'existe qu'une seule provision, une seule couverture calculée (IF-22).

### E.12 — Plan financier thématique *(nouveau, V2.2, résout le point 7 des remarques)*

Structure générique regroupant un ensemble cohérent de charges/dépenses sur une période et pour un ou plusieurs bénéficiaires — sert aussi bien à « École 2026/2027 » qu'à « Vacances été 2027 » ou « Travaux maison ». Le module scolaire (document 01, INC-04) reste une **vue filtrée** au-dessus de cette structure générique, jamais une entité séparée.

- **RG-110** — Un `FinancialPlan` porte : libellé, période (`period_start`/`period_end`), bénéficiaires (0..n `Child`/`User`), et une liste de `ChargePlan` rattachés (0..n). Un `ChargePlan` peut être rattaché à 0 ou 1 `FinancialPlan`.
- **RG-111 — Aucun agrégat stocké** — Tous les indicateurs d'un `FinancialPlan` (budget connu, payé, reste à payer, provisionné, reste à financer, prochaine échéance, couverture de la prochaine échéance, projection jusqu'à `period_end`, éléments inconnus, options) sont **calculés à la demande** à partir des `ChargePlan`/`Deadline`/`Provision` liés — jamais dupliqués en colonnes propres (cf. G.15, IF-23).
- **RG-112** — Un `FinancialPlan` peut référencer une `Provision` associée (ex. « Provision Scolarité » pour le plan « École 2026/2027 ») — relation informative pour l'affichage consolidé, la couverture réelle restant régie par RG-090 indépendamment du `FinancialPlan`.
- **RG-113 — Complétude d'un plan** — Un `FinancialPlan` est `complet` si toutes ses `Deadline` liées ont `amount_status ∈ {estimé, confirmé}` et qu'aucune `ChargePlan` en `optionnelle_envisagée` n'attend de décision dont l'échéance de décision est dépassée ; sinon `incomplet`. Le « budget connu » d'un plan incomplet est **toujours** présenté comme un plancher (« Au moins 134 730 DH de dépenses sont déjà identifiées »), jamais comme un total définitif (cf. G.14).

### E.3quater — Charges communes à plusieurs enfants *(V2.2, résout le point 11 des remarques)*

- **RG-115** — Une `Deadline`/`ChargePlan` reste rattachable à 0, 1 ou n `Child` (inchangé, `charge_plan_child`, V1/V2). Une charge commune (ex. 40 000 DH pour Wael + Dina) génère **une seule** `Deadline` et **un seul** `Payment` réel — jamais deux paiements artificiels pour une seule facture.
- **RG-116 — Ventilation analytique optionnelle** — Une `Deadline` rattachée à plusieurs enfants peut porter une ventilation informative (`deadline_child_allocation`, ex. Wael 20 000 / Dina 20 000), utilisée uniquement pour les vues par enfant (document 03, §I.10bis) — **jamais** pour dédoubler l'écriture réelle. La somme des ventilations n'est pas contrainte à égaler `amount_current` (une ventilation partielle est valide, ex. seule la part de Wael est connue).

### E.6 Objectifs / projets
RG-040 à RG-042 inchangées.

### E.7 Priorité des engagements
RG-045, RG-046 inchangées, avec ajout :
- **RG-047 — Protection par défaut de l'épargne enfant** *(résout le point 12)* — Toute `SavingsPocket` dont le `beneficiary` est un `Child` avec un versement récurrent déclaré hérite par défaut de `is_protected = true`. Le moteur d'arbitrage (RG-046) ne la propose **jamais** comme source de financement d'un objectif de priorité inférieure ; seule une action utilisateur explicite (suspendre, réduire, réaffecter) peut la mobiliser.

### E.8 Comptes et rapprochement *(nouveau, résout les points 1, 9, 10)*

- **RG-080 — Solde courant calculé** — `solde_courant(compte, T) = dernier_solde_réconcilié(compte) + Σ mouvements réels nets sur ce compte depuis la date de ce dernier rapprochement jusqu'à T` (Payment, part `IncomeOccurrence.actual_amount` reçue sur ce compte, `AccountTransfer` entrants/sortants, `Adjustment`). L'utilisateur n'a jamais à ressaisir son solde pour chaque dépense — seule une déclaration de solde ponctuelle (rapprochement) crée un nouveau point d'ancrage.
- **RG-081 — Patrimoine liquide total** = `Σ solde_courant(compte)` pour tous les comptes actifs du foyer.
- **RG-082 — Trésorerie opérationnelle** = `Σ solde_courant(compte)` pour les comptes actifs où `include_in_operational_treasury = true`.
- **RG-083 — Rapprochement** — Quand l'utilisateur déclare un nouveau solde réel, le système compare `solde_courant` calculé au solde déclaré. Un écart crée une `Reconciliation` avec 4 actions possibles, jamais automatiques : enregistrer un ajustement (`Adjustment`), identifier une dépense oubliée (créer la `Payment`/`AdHocExpense` manquante), ignorer temporairement (le rapprochement reste `pending`), corriger une transaction existante.
- **RG-084** — Un `Adjustment` est toujours un mouvement réel typé et historisé (jamais une réécriture du solde de référence) — il apparaît dans `LedgerEntry`.
- **RG-085 — Transferts internes** — Un `AccountTransfer` confirmé crée une sortie sur `from_account_id` et une entrée sur `to_account_id` (ou l'inverse pour retrait/dépôt espèces, l'un des deux pouvant être NULL pour un flux externe). L'impact net foyer d'un transfert **interne** (deux comptes du foyer) est toujours nul. Un transfert n'est **jamais** un `Payment`, une `AdHocExpense` ni un `PocketMovement` — c'est un type de mouvement distinct dans `LedgerEntry`.
- **RG-086** — Un transfert vers/depuis un compte `backed_by_account` d'une poche ne crée **aucun** `PocketMovement` supplémentaire : le montant de la poche est déjà à jour par simple lecture du solde du compte (RG-071).

### E.9 Prévisions et alertes

- **RG-050** *(corrigée — résout le point 4)* — Les **Montants engagés** (G.4) et toutes les projections se basent **exclusivement** sur l'état financier persistant (`ouverte`, `partiellement_payée`) et la `due_date`, jamais sur l'état temporel calculé (`bientôt_due`, `due`…). Un statut temporel « à_venir »/« future » n'exclut jamais une échéance des engagements si sa `due_date` tombe dans l'horizon considéré — le statut UX n'est **jamais** source de vérité pour un calcul financier.
- **RG-051** — inchangée (trou de trésorerie, point bas < marge de sécurité), mais s'applique désormais sur les **deux** projections distinctes (physique et capacité libre, cf. G.6).
- RG-052, RG-053, RG-054 inchangées.
- **RG-117 — Alertes sur données manquantes, sans bruit** *(V2.2, résout le point 9 des remarques)* — Un montant `inconnu` (RG-102) ou une charge `optionnelle_envisagée` (RG-105) en attente de décision ne génère une `Action à traiter` que lorsque sa `due_date` (ou, pour une option, la date jugée structurante pour la décision) entre dans la fenêtre `seuil_à_venir` du foyer — jamais plusieurs mois à l'avance. Une information non encore pertinente pour l'horizon courant reste silencieusement en attente.
- **RG-118 — Pas de relance répétitive** *(V2.2)* — Une `Action à traiter` sur une donnée manquante suit la même règle anti-doublon que les autres notifications (document 04 §Q.4) : pas de nouvelle relance avant un délai de repos, sauf changement d'état (ex. `expected_billing_date` dépassée d'un délai supplémentaire).

### E.10 Statuts et cycle de vie *(nouveau, résout le point 6)*
Voir F.2 pour le détail. Principe : un état **financier persistant** (stocké) distinct d'un état **temporel** (toujours calculé à la lecture, jamais stocké) — évite de faire muter des milliers d'enregistrements simplement parce que le temps passe, et évite la confusion pointée en INC-06/V1.

### E.11 Historique, suppression, correction
- RG-060 à RG-063 inchangées, précisées (résout le point 17) :
- **RG-064 — Corrections d'opérations réelles** — Une opération réelle confirmée n'est jamais supprimée ni réécrite silencieusement :
  - `Payment` erroné → nouveau `Payment` de type `ajustement` (contre-écriture), jamais suppression.
  - `AccountTransfer` confirmé erroné → transfert inverse enregistré (contre-transfert), jamais suppression.
  - `Reconciliation`/`Adjustment` erronés → nouvel `Adjustment` compensatoire.
  - `IncomeOccurrence.actual_amount` erroné → correction directe du champ autorisée avec `AuditEvent` obligatoire (ce n'est pas une écriture en partie double, une seule ligne est concernée).
  - `Deadline` déjà `soldée` rouverte pour régularisation → réservé aux admins, cf. H-02.

---

## F. Statuts et transitions

### F.1 `IncomeOccurrence`
Inchangé (prévu → reçu / en_retard → reçu ; annulé).

### F.2 `Deadline` — refonte du modèle *(résout le point 6)*

**Ancien modèle (V1)**, contesté par l'utilisateur : `planifiée → à_venir → à_payer → partiellement_payée → payée`, plus `en_retard`, `reportée`, `annulée` — mélangeait un état temporel (le temps qui passe) et un état financier (l'argent qui bouge), ce qui obligeait à faire muter le statut de milliers d'échéances chaque nuit uniquement parce qu'une date était franchie, et rendait le report (`reportée`) ambigu avec une vraie annulation.

**Nouveau modèle (V2) — deux axes indépendants :**

**État financier persistant** (stocké, seule source de vérité pour les calculs) :
```
ouverte ──(paiement partiel)──► partiellement_payée ──(paiement complémentaire + clôture confirmée)──► soldée
ouverte ──(paiement complet + clôture confirmée)──► soldée
ouverte / partiellement_payée ──(annulation)──► annulée
```
`due_date` est modifiable à tout moment (report) — c'est un événement audité sur le champ, **pas** une transition de statut.

**État temporel** (toujours **calculé** à la lecture, jamais stocké) :
```
computed_temporal_status(deadline, today) =
   si état_financier ∈ {soldée, annulée} → terminal (aucun état temporel affiché)
   sinon si (due_date − today) > seuil_à_venir  → future
   sinon si (due_date − today) > seuil_à_payer  → bientôt_due
   sinon si today ≤ due_date                    → due
   sinon                                         → overdue
```
`seuil_à_venir` et `seuil_à_payer` sont des paramètres foyer (`HouseholdSettings`). L'affichage combine les deux axes (ex. badge `partiellement_payée · overdue`) mais **seul l'axe financier** entre dans une formule (G.3, G.4, G.6).

### F.3 – F.6 — autres cycles de vie
Inchangés : `VariableBudget` (niveau continu sous_budget/proche_limite/dépassé), `PocketMovement` (prévu → confirmé/en_retard/annulé), `Goal` (en_cours ⇄ en_pause → atteint/abandonné), `SimulationScenario` (brouillon → sauvegardé → supprimé).

### F.7 `AccountTransfer` *(nouveau)*
```
prévu ──(confirmation)──► confirmé
prévu / confirmé ──(annulation avant confirmation)──► annulé
```
Un `AccountTransfer` `confirmé` est immuable — toute erreur se corrige par un transfert inverse (RG-064).

### F.8 `Reconciliation` *(nouveau)*
```
pending ──(action de l'utilisateur : ajustement | transaction identifiée | correction)──► résolue
pending ──(ignorer temporairement)──► pending (relance différée)
```

---

## G. Formules de calcul — référence unique

> **Vocabulaire V2**, non ambigu et stable dans tout le dossier (résout le point 3) : **Solde physique** (par compte) → **Patrimoine liquide total** → **Trésorerie opérationnelle** → **Montants réservés** / **Montants engagés** → **Disponible libre**. Aucun de ces termes n'est jamais redéfini différemment ailleurs.

### G.1 — Solde physique d'un compte
```
solde_courant(compte, T) = dernier_solde_réconcilié(compte)
   + Σ mouvements réels nets sur ce compte depuis la date du dernier rapprochement jusqu'à T
   (Payment, IncomeOccurrence.actual_amount, AccountTransfer, Adjustment — cf. RG-080)
```

### G.2 — Patrimoine liquide total & Trésorerie opérationnelle
```
Patrimoine_liquide_total(T)   = Σ solde_courant(compte, T)                     pour tous les comptes actifs
Trésorerie_opérationnelle(T)  = Σ solde_courant(compte, T)                     pour les comptes actifs
                                    où include_in_operational_treasury = true
```

### G.3 — Montants réservés *(corrigée — anti-double-comptage, résout le point 2)*
```
Montants_réservés(T) = Σ current_amount(SavingsPocket)  où allocation_mode = virtual_allocation
                      + Σ current_amount(Provision)      où allocation_mode = virtual_allocation
```
Les poches/provisions `backed_by_account` sont **explicitement exclues** de cette somme (RG-072) : leur montant est déjà retiré de `Trésorerie_opérationnelle` via l'exclusion de leur compte dédié (G.2). Les additionner ici referait doublonner le même dirham — cf. Invariant IF-06.

### G.4 — Montants engagés *(corrigée V2 — indépendante du statut UX ; corrigée V2.1 — n'engage plus une seconde fois ce qu'une provision couvre déjà)*
```
Montants_engagés(T, H) = Σ engagement_non_couvert(deadline)  pour toute Deadline dont
                            état_financier ∈ {ouverte, partiellement_payée}
                            ET due_date ≤ H
                        + Σ Projection_prudente_restante(variable_budget)  pour les périodes se terminant ≤ H

  où engagement_non_couvert(deadline) = reste_a_payer(deadline) − couverture_affectée(deadline)   (RG-090/RG-091)
```
Sélection **uniquement** sur l'état financier et la date d'échéance — jamais sur l'état temporel calculé (`bientôt_due`/`future`), cf. RG-050.

**Pourquoi ce n'est pas un double comptage (ni dans un sens ni dans l'autre)** — `Montants_réservés` (G.3) compte la **totalité** du `current_amount` d'une provision `virtual_allocation`, sans le répartir par échéance. `Montants_engagés` (G.4) ne compte, pour chaque échéance liée, que la part **non couverte** par cette même provision. Ensemble, pour un jeu d'échéances liées à une provision, la somme (`Montants_réservés` attribuable + `Σ engagement_non_couvert`) égale toujours exactement le besoin réel total de ces échéances (`Σ reste_a_payer`) — ni plus, ni moins (cf. IF-16, démontré chiffres en main au document 06 §8bis).

### G.5 — Disponible libre
```
H* = date de la prochaine IncomeOccurrence « prévue » significative
Disponible_libre(T) = Trésorerie_opérationnelle(T) − Montants_réservés(T) − Montants_engagés(T, H*) − Marge_sécurité
```
*(remplace le « Disponible immédiat » ambigu de la V1 — même formule, vocabulaire clarifié.)*

### G.6 — Deux projections distinctes *(résout le point 3)*

**G.6a — Projection de trésorerie physique** *(vrais flux d'argent uniquement)*
```
Projection_physique(T+k) = Trésorerie_opérationnelle(T)
   + Σ IncomeOccurrence.montant           (prévu ou reçu, date ∈ [T, T+k], compte opérationnel)
   − Σ reste_a_payer(Deadline)            (état_financier ≠ soldée/annulée, due_date ∈ [T, T+k])
   − Σ Projection_prudente_restante       (part future des budgets variables, prorata des jours restants)
   ± Σ AccountTransfer                    (uniquement ceux qui font entrer/sortir un compte du périmètre opérationnel)
   pour k = 0..N
```
Une affectation virtuelle (`PocketMovement` sur poche `virtual_allocation`) **n'apparaît jamais** ici : elle ne déplace aucun argent réel.

**G.6b — Projection de capacité libre** *(ce qui reste réellement mobilisable)*
```
Projection_capacité_libre(T+k) = Projection_physique(T+k)
   − Montants_réservés(T+k)   (y compris les PocketMovement virtuels prévus/confirmés jusqu'à T+k)
   − Marge_sécurité
```
Le point bas (`min`) de chacune des deux séries sur la fenêtre sert respectivement à détecter une **tension de trésorerie physique** et une **tension de capacité libre** (RG-051) — ce sont deux alertes distinctes, jamais fusionnées en un seul chiffre.

### G.7 — Prorata d'un budget variable *(précisée V2.1 — RG-098)*
```
Cas « semaine » : chaque semaine calendaire réelle (du week_start_day au 6ᵉ jour suivant) comprise
   entièrement dans la fenêtre de calcul vaut reference_amount en entier.
   Une semaine partielle (bord de fenêtre) vaut (reference_amount / 7) × jours_de_cette_semaine_dans_la_fenêtre.
Cas « mois » : budget_période = (montant_référence / jours_référence) × jours_réels_du_mois (RG-022, inchangée).
```
La formule à taux journalier constant (`montant_référence/jours_référence × jours`) reste un raccourci **valide** quand la fenêtre considérée couvre un nombre entier de semaines/mois complets depuis une origine alignée (ex. un mois complet) — elle ne doit jamais être appliquée telle quelle à une fenêtre arbitraire non alignée sur les semaines réelles (ex. l'horizon `[T, H*]` d'un calcul de `Montants_engagés`), sous peine d'erreur de quelques jours en bord de fenêtre.

### G.8 — Rythme et projection prudente d'un budget *(précisée, résout le point 14)*
```
rythme_projeté           = (consommé_à_date / jours_écoulés) × jours_totaux_période
Budget_contractuel_restant = budget_période − consommé_à_date
Prévision_rythme_restant   = rythme_projeté − consommé_à_date
Projection_prudente_restante = MAX(Budget_contractuel_restant, Prévision_rythme_restant, 0)   [RG-024bis]
```
Le `consommé_à_date` n'entre **jamais** une seconde fois dans la partie « restante » — il est déjà compté dans le réalisé (`Trésorerie_opérationnelle` l'a déjà déduit via les `BudgetExpense` passées).

### G.9 — Provisions

**Reste à constituer (échéance unique)**
```
reste_à_constituer = Σ reste_a_payer(deadlines liées, non soldées/non annulées) − provision.current_amount
```

**Calcul temporel de suffisance (plusieurs échéances, RG-032bis)**
```
d₁ ≤ d₂ ≤ … ≤ dₙ (due_date croissantes), r₁, r₂, …, rₙ = reste_a_payer respectifs
R_i = Σ_{k=1}^{i} r_k
versement_mensuel_recommandé = max_i [ (R_i − provision.current_amount) / mois_restants(aujourd'hui, d_i) ]
   calculé sur chaque i où le numérateur est positif ; si mois_restants(d₁) < 1 et le numérateur i=1 est positif,
   basculer sur l'alerte de tension à court terme (RG-032ter) plutôt qu'afficher ce taux.
```

### G.10 — Capacité d'épargne et de financement
```
Capacité_épargne = Σ Revenus_prévus − Σ ChargePlan.obligatoire (priorité 1)
                  − Σ Provision.versement_recommandé (priorité 3)
                  − Σ Projection_prudente_restante (budgets variables)
                  − Δ_marge_sécurité

Capacité_financement(Goal) = Capacité_épargne
   − Σ versements engagés vers SavingsPocket protégées (priorité 2, y compris épargne enfant, RG-047)
   − Σ versements engagés vers d'autres Goal de priorité ≥
```

### G.11 — Simulateur « Puis-je me le permettre ? » *(enrichi, résout le point 11)*

```
Capacité_disponible_brute(t) = Projection_physique(t) − Montants_réservés(t)        [avant marge de sécurité]

Pour un achat (montant M, date souhaitée D, horizon d'analyse N jours) :
   Capacité_avec_achat(t) = Capacité_disponible_brute(t) − M   pour t ≥ D
   point_bas_après_achat  = min(Capacité_avec_achat(t))  sur [D, D + N]
   marge_vs_coussin        = point_bas_après_achat − Marge_sécurité

Verdict (quatre issues, comme en V1, mais toujours accompagné des indicateurs ci-dessous) :
   marge_vs_coussin ≥ 0                                     → possible maintenant
   point_bas_après_achat ≥ 0  et  marge_vs_coussin < 0        → possible mais risqué
   point_bas_après_achat < 0, mais une date D' du même horizon satisfait marge_vs_coussin ≥ 0  → recommandé plus tard (date D' = première date satisfaisante)
   aucune date de l'horizon ne satisfait la condition        → non compatible actuellement

Indicateurs systématiquement calculés et affichés (pas seulement le verdict) :
   • date techniquement possible (première date où point_bas_après_achat ≥ 0)
   • date recommandée (première date où marge_vs_coussin ≥ 0)
   • point bas de trésorerie après achat, et sa date
   • marge résiduelle par rapport au coussin (chiffrée, pas seulement qualifiée)
   • impact sur les provisions en cours (une provision liée voit-elle son financement retardé ?)
   • impact sur l'épargne protégée (par construction : aucun, car exclue de Capacité_disponible_brute — affiché explicitement pour rassurer/expliquer)
   • impact sur les autres objectifs de priorité ≥ (concurrence RG-041)
   • horizon d'analyse utilisé
   • niveau d'incertitude (G.14) : si une Deadline pertinente pour l'horizon [D, D+N] est à amount_status
     ∈ {estimé, inconnu} ou correspond à une option envisagée en attente, le verdict est accompagné d'une
     mention explicite (ex. « le montant de la restauration T2 n'est pas encore connu ») — jamais une
     fausse certitude silencieuse (V2.2, résout les points 12 et 13 des remarques, IF-27)
```
Calcul strictement en lecture (RG-000) — aucune donnée réelle modifiée, y compris pour un scénario sauvegardé (`SimulationScenario`).

### G.12 — Coussin de sécurité en mois de dépenses
Inchangée.

### G.13 — Écart prévu/réel
Inchangée — déclenche un recalcul immédiat de toute projection en aval (jamais de cache long, cf. document 04 §O.4).

### G.14 — Complétude d'une projection ou d'un plan *(nouveau V2.2, résout les points 8, 12, 13 des remarques)*
```
Pour un ensemble de Deadline considéré (un FinancialPlan, un horizon de projection, un simulateur) :

Dépenses_certaines_connues = Σ amount_current  pour les Deadline à amount_status ∈ {estimé, confirmé}
                                                    et ChargePlan.obligation_status ∈ {obligatoire, optionnelle_souscrite}
Options_envisagées_connues = Σ amount_current  pour les Deadline à amount_status ∈ {estimé, confirmé}
                                                    et ChargePlan.obligation_status = optionnelle_envisagée
Projection_prudente = Dépenses_certaines_connues + Options_envisagées_connues

Éléments_inconnus = liste des Deadline à amount_status = inconnu (qualitative, jamais un montant)
Complétude ∈ {complet, contient_estimations, contient_inconnues}
   complet              si aucune Deadline pertinente n'est à amount_status ∈ {inconnu} ni en option en attente
   contient_estimations si au moins une Deadline pertinente est à amount_status = estimé (montant connu mais non confirmé)
   contient_inconnues   si au moins une Deadline pertinente est à amount_status = inconnu, ou une option envisagée est en attente de décision
```
`Dépenses_certaines_connues` n'est **jamais** présenté comme un total définitif quand `Complétude ≠ complet` — toujours accompagné du statut (RG-113) : « Au moins X DH de dépenses sont déjà identifiées » plutôt que « Budget total = X DH ».

### G.15 — Agrégats d'un `FinancialPlan` ou d'une vue par enfant *(nouveau V2.2, résout les points 7 et 10 des remarques)*
```
Pour un FinancialPlan (ou un Child, en filtrant les Deadline par bénéficiaire) :

Budget_connu          = Dépenses_certaines_connues (G.14)                     [+ options si vue « prudente »]
Payé                  = Σ Payment.amount (signé)  sur les Deadline concernées
Reste_à_payer          = Σ reste_a_payer(deadline)  sur les Deadline concernées, ouvertes/partiellement payées
Provisionné            = Σ couverture_affectée(deadline)  sur les Deadline concernées (RG-090)
Reste_à_financer        = Σ engagement_non_couvert(deadline)  sur les Deadline concernées
Prochaine_échéance      = MIN(due_date) parmi les Deadline ouvertes/partiellement payées concernées
Couverture_prochaine    = couverture_affectée(Prochaine_échéance) / reste_a_payer(Prochaine_échéance)
Complétude              = G.14 restreinte à ces mêmes Deadline
```
Purement des agrégations en lecture sur les entités existantes (`ChargePlan`, `Deadline`, `Payment`, `Provision`) — aucune donnée dupliquée (IF-23). Une vue par enfant est le cas particulier où le filtre porte sur le bénéficiaire plutôt que sur le `FinancialPlan` ; une charge commune à plusieurs enfants (RG-115) contribue à chacune des vues concernées sans dédoubler le `Payment` réel sous-jacent — seule sa ventilation analytique (RG-116), quand elle existe, répartit visuellement le montant entre les vues.

---

## H. Cas limites

H-01 à H-11 (V1) restent valides, avec deux révisions et cinq ajouts :

- **H-02** *(révisée)* — Paiement réel supérieur à l'estimé après clôture : traité désormais comme un `Payment` de type `ajustement` (direction `augmente_paye`), cf. RG-064 — pas une simple « ligne complémentaire » non typée.
- **H-09** *(révisée)* — Une `Deadline` ne peut être liée qu'à une seule `Provision` (inchangé) ; **et** une seule `Provision`/`SavingsPocket` `backed_by_account` ne peut référencer qu'un seul compte, et réciproquement (RG-072).
- **H-12** *(nouveau)* — Rapprochement bancaire révélant un écart : le solde calculé et le solde déclaré divergent (frais bancaires oubliés, dépense non saisie…). Le système ne choisit jamais seul : il propose les 4 actions de RG-083, et tant qu'aucune n'est prise, le compte reste en `Reconciliation.pending` sans bloquer l'usage courant de l'app.
- **H-13** *(nouveau)* — Provision avec échéance imminente sous-financée (`mois_restants < 1`) : le taux mensuel recommandé devient mathématiquement énorme et non actionnable — le système bascule sur l'alerte de tension à court terme (RG-032ter) plutôt que d'afficher un chiffre absurde.
- **H-14** *(nouveau)* — Transfert vers un compte `backed_by_account` d'un montant qui dépasse la trésorerie opérationnelle disponible du compte source : refusé comme n'importe quel virement bancaire réel insuffisamment provisionné — l'application alerte mais ne bloque pas la saisie rétroactive (l'utilisateur peut avoir transféré par un autre canal et vient seulement l'enregistrer).
- **H-15** *(nouveau)* — Poche `virtual_allocation` que l'utilisateur souhaite transformer en `backed_by_account` : exige la création du compte dédié et, si un montant équivalent existe déjà ailleurs, un `AccountTransfer` réel vers ce compte — jamais un simple changement de mode qui ferait apparaître de l'argent par magie (RG-074).
- **H-16** *(nouveau)* — Deux comptes déclarés par les deux membres du couple sans jamais être rapprochés (aucune `AccountBalanceSnapshot` récente) : le `solde_courant` calculé dérive silencieusement de la réalité au fil des mois. Le système doit alerter (« Ce compte n'a pas été rapproché depuis 60 jours ») plutôt que de présenter un chiffre calculé comme s'il était certain.

---

## Invariants financiers *(nouveau, résout le point 21)*

Ces invariants deviendront des tests automatisés (cf. document 05, roadmap V2). Toute implémentation doit les respecter à tout instant.

- **IF-01** — Aucun `Payment`, `IncomeOccurrence.reçu`, `PocketMovement.confirmé` ou `AccountTransfer.confirmé` ne naît d'un enregistrement prévisionnel sans confirmation explicite d'un utilisateur (RG-000).
- **IF-02** — À tout instant, `Patrimoine_liquide_total = Σ solde_courant(compte)` sur l'ensemble des comptes actifs du foyer (G.2) — aucune autre source ne peut prétendre représenter le patrimoine liquide.
- **IF-03** — Un `AccountTransfer` interne (deux comptes du même foyer) a un impact net foyer strictement nul sur `Patrimoine_liquide_total`.
- **IF-04** — Un mouvement réel (`Payment`, `IncomeOccurrence.actual_amount`, `AccountTransfer`, `Adjustment`) n'est comptabilisé qu'une seule fois dans le calcul du solde d'un compte donné (pas de double lecture dans `LedgerEntry`).
- **IF-05** — `reste_a_payer(deadline) ≥ 0` sauf gestion explicite d'un avoir/remboursement (RG-016bis).
- **IF-06 — Anti-double-comptage** — Le montant d'une `SavingsPocket`/`Provision` `virtual_allocation` n'affecte jamais un `solde_courant` de compte ; le montant d'une `SavingsPocket`/`Provision` `backed_by_account` n'est jamais additionné dans `Montants_réservés` (RG-072). Aucun dirham n'est simultanément (a) présent dans un solde de compte opérationnel, (b) compté comme réserve, et (c) déduit une seconde fois.
- **IF-07** — Le solde d'une poche/provision `virtual_allocation` égale à tout instant `Σ(PocketMovement confirmés, signés)` — jamais une valeur stockée indépendamment (RG-071).
- **IF-08** — Le solde d'une poche/provision `backed_by_account` égale à tout instant `solde_courant(linked_account_id)` — jamais une valeur stockée indépendamment.
- **IF-09** — Toute correction d'une opération réelle est auditée (`AuditEvent`) et jamais silencieuse (RG-064).
- **IF-10** — Un `SimulationScenario` n'altère jamais, directement ou indirectement, une donnée du registre réel (comptes, échéances, poches, provisions, objectifs) — vérifiable en prouvant qu'aucune écriture n'est émise hors de la table `simulation_scenario` pendant son exécution.
- **IF-11** — La sélection des échéances entrant dans `Montants_engagés` (G.4) ne dépend jamais de l'état temporel calculé, uniquement de l'état financier persistant et de `due_date` (RG-050).
- **IF-12** — `Montants_engagés` (G.4) utilise systématiquement `reste_a_payer`, jamais `montant_dû` brut, dès qu'un `Payment` existe sur la `Deadline` (RG-016).
- **IF-13** — La part « réalisée » d'un `VariableBudget` (les `BudgetExpense` déjà enregistrées) n'apparaît jamais une seconde fois dans la part « projetée » (`Projection_prudente_restante`, RG-024bis).
- **IF-14** — Un compte ne peut être `linked_account_id` que d'une seule poche/provision `backed_by_account` à la fois (contrainte d'unicité, RG-072).
- **IF-15** — Toute suppression d'une opération financière validée est refusée par construction (seules `annulation`, `contre-écriture` et `ajustement` existent) — cf. RG-064.

**Invariants V2.1 — couverture provision/échéance et signes comptables**

- **IF-16** — Pour toute `Deadline` liée à une `Provision` : `couverture_affectée(deadline) + engagement_non_couvert(deadline) = reste_a_payer(deadline)`, exactement — jamais moins (argent non compté), jamais plus (argent compté en trop). (RG-090/RG-092)
- **IF-17** — Une même unité de `current_amount` d'une provision ne couvre jamais deux échéances simultanément — l'allocation chronologique de RG-090 est strictement séquentielle et exclusive (`disponible_provision` décroît de façon monotone au fil du tri par `due_date`).
- **IF-18** — L'affectation d'une provision à ses échéances liées se fait par défaut dans l'ordre chronologique des `due_date`, jamais par ordre de création ni par montant.
- **IF-19** — Un `Payment` avec `funding_source = provision` sur une provision `virtual_allocation` crée toujours, dans la même transaction, un `PocketMovement` de retrait du même montant — jamais l'un sans l'autre (RG-095).
- **IF-20** — Dans `LedgerEntry`, un `Payment` de type `paiement` (ou `ajustement` à direction `augmente_paye`) est toujours une **sortie** (montant négatif) sur le compte payeur ; un `Payment` de type `remboursement` (ou `ajustement` à direction `diminue_paye`) est toujours une **entrée** (montant positif) — ce signe est indépendant du signe utilisé pour `reste_a_payer` (RG-015), qui répond à une question différente (l'effet sur la dette de l'échéance, pas sur le solde du compte). Ne jamais réutiliser l'un pour l'autre.

**Invariants V2.2 — données manquantes, options, plans financiers**

- **IF-21** — Une confirmation de montant (RG-104) déclenche le même recalcul immédiat que tout écart prévu/réel (G.13) — aucune formule en aval ne reste calculée sur l'ancien montant après confirmation.
- **IF-22** — Un `intention_label` sur un `PocketMovement` n'entre dans aucune formule (G.3, G.4, G.9) — la couverture réelle d'une échéance par une provision reste exclusivement déterminée par RG-090, jamais influencée par une intention déclarée.
- **IF-23** — Aucun agrégat d'un `FinancialPlan` (budget connu, payé, reste à financer…) n'est stocké : toute lecture recalcule à partir des `ChargePlan`/`Deadline`/`Provision` liés au moment de la requête.
- **IF-24** — Un montant `inconnu` (`amount_current IS NULL`) n'est jamais compté comme 0 DH dans une somme, et n'est jamais omis silencieusement de l'affichage : toute somme qui l'exclut est accompagnée d'un indicateur de complétude explicite (RG-113, G.14).
- **IF-25** — Une charge `optionnelle_envisagée` n'entre jamais dans `Montants_engagés` (G.4) ni dans le disponible libre (G.5) par défaut — uniquement dans la Projection prudente affichée séparément (RG-106).
- **IF-26** — Une charge/`Deadline` commune à plusieurs enfants ne génère jamais plus d'un `Payment` réel pour un même règlement, quelle que soit sa ventilation analytique (RG-115/116).
- **IF-27** — Un plan financier ou une projection contenant au moins un montant `inconnu` ou une option `envisagée` pertinente pour l'horizon étudié ne peut jamais être présenté comme un total définitif ou un verdict de simulateur sans mention explicite de cette incertitude (RG-113, G.14, document 03 §I.13bis).
