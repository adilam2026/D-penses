# 02 — Modèle métier

> Couvre les points **C** (entités), **D** (modèle relationnel), **E** (règles de gestion), **F** (statuts/transitions), **G** (formules), **H** (cas limites).
> Rappel des principes fondateurs : voir `01-vision-et-architecture-fonctionnelle.md`. Le modèle de données technique (tables, types) est en `04-architecture-technique-et-donnees.md` — ce document reste au niveau **métier**.

---

## C. Entités métier

### C.1 Socle

| Entité | Rôle |
|---|---|
| **User** | Compte authentifié (email, mot de passe, profil, photo) |
| **Household** | Le foyer — unité d'isolation des données |
| **HouseholdMembership** | Lien User↔Household + rôle (admin / membre / lecture seule) |
| **Child** | Personne à charge sans compte (prénom, nom, naissance, école, classe) |
| **HouseholdSettings** | Paramètres du foyer : marge de sécurité, seuils d'alerte, priorités |
| **Category** | Catégorie de dépense/revenu, standard ou personnalisée |
| **Beneficiary/MemberTag** | Rattachement d'une opération à 0..n membres/enfants ou au foyer |

### C.2 Revenus

| Entité | Rôle |
|---|---|
| **IncomeSource** | Modèle de revenu récurrent ou ponctuel (salaire Lamiaa, prime, loyer perçu…) |
| **IncomeOccurrence** | Occurrence datée d'un `IncomeSource` : prévue puis confirmée reçue |

### C.3 Charges, échéances, paiements

| Entité | Rôle |
|---|---|
| **ChargePlan** | Plan de charge unifié (fixe récurrente **ou** planifiée à calendrier manuel **ou** ponctuelle) — remplace la distinction 6.1/6.2 du cahier des charges (cf. INC-03) |
| **Deadline** *(échéance)* | Occurrence datée d'un `ChargePlan`, montant prévu/estimé ou exact, statut de cycle de vie complet |
| **Payment** | Mouvement réel de paiement rattaché à une `Deadline` (peut être partiel, plusieurs par échéance) |
| **VariableBudget** | Budget périodique pour une catégorie variable (courses, essence…) |
| **BudgetExpense** | Dépense réelle imputée à un `VariableBudget` (ex. "légumes 100 DH") |
| **AdHocExpense** | Dépense ponctuelle non budgétée et non liée à une échéance (réparation, cadeau…) |

### C.4 Épargne, provisions, objectifs

| Entité | Rôle |
|---|---|
| **SavingsPocket** | Poche d'épargne patrimoniale indépendante (Or Lamiaa, Épargne Wael…) |
| **Provision** | Réserve dédiée à une ou plusieurs `Deadline` futures connues |
| **PocketMovement** | Versement/retrait confirmé sur une `SavingsPocket` ou une `Provision` (même logique prévu≠réalisé) |
| **Goal** *(objectif/projet)* | Achat souhaité avec plan de financement (PC, voyage, travaux…) |
| **GoalContribution** | Versement confirmé vers un `Goal` |

### C.5 Intelligence / pilotage

| Entité | Rôle |
|---|---|
| **CashflowProjection** | Résultat calculé (non stocké durablement, ou cache TTL court) de la projection glissante |
| **SimulationScenario** | Scénario "et si" / "puis-je me le permettre", sauvegardable, jamais injecté dans le réel |
| **Alert** | Instance d'alerte générée par le moteur de détection (retard, dépassement, anomalie, oubli, trou de trésorerie) |
| **ActionItem** | **Vue calculée** (non stockée) agrégeant tout ce qui requiert une décision — voir REC-04 |

### C.6 Transverses

| Entité | Rôle |
|---|---|
| **Attachment** | Justificatif (facture, reçu, photo, PDF, contrat) attaché à `Deadline`/`Payment`/`AdHocExpense` |
| **AuditEvent** | Événement immuable d'audit (qui, quoi, quand, avant/après) — event-sourcing léger, cf. REC-03 |
| **NotificationPreference** | Paramétrage des seuils/canaux de notification par utilisateur |
| **NotificationInstance** | Notification effectivement émise (pour historique et anti-doublon) |
| **Device / Session** | Appareils connectés, pour déconnexion globale (§44) |

**Entités volontairement absentes** (et pourquoi, cf. document 01 §M) : `Transaction` générique (INC-05), `SchoolCharge`/`Subscription` en entités séparées (INC-04) — ce sont des vues filtrées sur `ChargePlan`/`Deadline`.

---

## D. Modèle relationnel (vue logique)

```
Household 1───n HouseholdMembership n───1 User
Household 1───n Child
Household 1───1 HouseholdSettings
Household 1───n Category                (+ catégories globales système, non rattachées)

Household 1───n IncomeSource ────────── beneficiary → User (nullable = foyer)
IncomeSource 1───n IncomeOccurrence

Household 1───n ChargePlan ───────────── beneficiary_members → [User|Child]* (0..n)
ChargePlan 1───n Deadline
Deadline 1───n Payment
Deadline 0───n Attachment
ChargePlan }o──o{ Child                  (table de jonction : rattachement multiple)

Household 1───n VariableBudget ────────── category → Category
VariableBudget 1───n BudgetExpense ─────── member_tags → [User|Child]* (0..n)

Household 1───n AdHocExpense ───────────── category → Category, member_tags → [User|Child]*

Household 1───n SavingsPocket ─────────── owner → User (nullable), beneficiary → [User|Child] (nullable)
Household 1───n Provision ──────────────── linked_deadlines → Deadline (0..n)
SavingsPocket 1───n PocketMovement
Provision 1───n PocketMovement

Household 1───n Goal
Goal 1───n GoalContribution
Goal 0───1 SavingsPocket                 (financement optionnel via poche dédiée)

Household 1───n SimulationScenario ────── created_by → User
Household 1───n Alert
(ActionItem = vue calculée, pas de table)

* Attachment  →  polymorphe sur (Deadline | Payment | AdHocExpense)
* AuditEvent  →  polymorphe sur toute entité financière (entity_type, entity_id)
* NotificationInstance → User + polymorphe sur l'entité source de l'alerte
```

Règles d'isolation : **toutes** les entités "Household 1───n X" portent un `household_id` obligatoire et non modifiable après création ; toute requête est systématiquement filtrée par le foyer de l'utilisateur courant (cf. document 04 §S, isolation stricte entre foyers).

---

## E. Règles de gestion

Numérotation **RG-xxx**, regroupées par thème. RG-000 est la règle transverse qui chapeaute toutes les autres.

### E.0 Règle transverse

- **RG-000** — Aucune action financière réelle (paiement confirmé, revenu reçu confirmé, versement d'épargne confirmé, transfert entre poches, report de charge, réduction d'objectif) ne peut être exécutée automatiquement par le système. Toute transition d'un statut "prévu/planifié" vers un statut "réalisé" exige une action utilisateur explicite. Le système peut : calculer, recommander, alerter, proposer, pré-remplir. Il ne peut jamais : valider à la place de l'utilisateur.

### E.1 Foyer, membres, droits

- **RG-001** — Un `User` peut appartenir à un seul `Household` actif à la fois en V1 (multi-foyer = V2, ex. familles recomposées).
- **RG-002** — Un foyer doit toujours avoir au moins un membre avec le rôle `admin`. Le dernier admin ne peut pas se rétrograder ni quitter le foyer sans transférer le rôle.
- **RG-003** — Un rôle `lecture_seule` peut consulter toutes les données communes mais ne peut créer/modifier/confirmer aucune opération.
- **RG-004** — Un `Child` n'est jamais un `User`. Le passage à "enfant majeur avec compte" (V2/V3) crée un `User` + `HouseholdMembership` distinct, éventuellement lié au `Child` historique pour conserver l'historique de dépenses, mais ce n'est pas une mutation du même enregistrement (cf. REC-09).
- **RG-005** — Toute opération (`Deadline`, `AdHocExpense`, `BudgetExpense`, `PocketMovement`, `GoalContribution`) peut être rattachée à 0, 1 ou n membres/enfants, ou explicitement marquée "foyer global". L'absence de rattachement est une valeur valide, pas une erreur de saisie.

### E.2 Revenus

- **RG-010** — Une `IncomeOccurrence` naît au statut `prévu`, générée automatiquement à la date habituelle par la récurrence de l'`IncomeSource` (ou saisie manuelle si ponctuel).
- **RG-011** — Le passage à `reçu` exige une confirmation utilisateur, qui peut modifier le montant réel au moment de la confirmation (le montant prévu initial reste conservé pour le calcul d'écart).
- **RG-012** — Si la date habituelle est dépassée de plus de N jours (paramétrable, défaut 3) sans confirmation, le statut passe automatiquement à `en_retard` (c'est un changement de **statut d'affichage/alerte**, pas une écriture financière réelle — ne viole pas RG-000).
- **RG-013** — Un revenu `annulé` reste visible dans l'historique (traçabilité), exclu des calculs de trésorerie futurs.

### E.3 Charges, échéances, paiements

- **RG-014** — Une `Deadline` peut recevoir 0..n `Payment`. Le statut passe à `partiellement_payée` dès qu'un paiement existe avec `Σ(payments) < montant_dû`, et à `payée` uniquement lorsque l'utilisateur **confirme explicitement la clôture** de l'échéance (bouton "Marquer comme soldée"), pas par simple atteinte automatique du cumul — car un montant estimé peut encore être réévalué (cf. INC-06, RG-037).
- **RG-015** — Un `Payment` ne peut pas être négatif. Un remboursement/avoir se modélise comme un `Payment` de signe négatif explicitement typé `remboursement`, jamais par suppression d'un paiement existant (cf. RG-050, suppression logique).
- **RG-016** — `montant_dû` d'une `Deadline` = `montant_estimé_ou_exact` initial, éventuellement révisé (`RG-037`), diminué d'aucun paiement (les paiements sont un flux, pas une déduction du montant dû affiché — le "reste à payer" est une valeur calculée = `montant_dû − Σ(payments)`).
- **RG-017** — Un `ChargePlan` en mode `calendrier_manuel` (ex. scolarité T1/T2/T3) exige la saisie d'au moins une `Deadline` à la création ; chaque `Deadline` est indépendante (statut, paiements, écart propres), aucune ne dépend de l'état des autres échéances du même plan.
- **RG-018** — Un `ChargePlan` en mode `auto_frequence` (ex. internet mensuel) génère ses `Deadline` futures selon une règle de récurrence (RRULE), avec une fenêtre de génération glissante (ex. les 3 prochaines occurrences toujours matérialisées) plutôt que de générer indéfiniment dans le futur.
- **RG-019** — Un `ChargePlan` peut avoir une `date_fin` ; passé cette date, plus aucune `Deadline` n'est générée, mais les échéances passées restent intactes.
- **RG-020** — Le caractère `obligatoire` d'un `ChargePlan` (booléen) sert exclusivement au moteur de priorité (§15) et à l'affichage — il ne modifie aucune règle de statut.

### E.4 Budgets variables

- **RG-021** — Un `VariableBudget` définit un montant et une **fréquence de référence** (semaine ou mois). La conversion vers une période calendaire précise suit RG-022 (prorata), jamais un calcul naïf de multiplication (§19).
- **RG-022 (prorata)** — `budget_periode_calendaire = (montant_reference / nb_jours_reference) × nb_jours_reels_de_la_periode`. Exemple : budget hebdo 1 500 DH → taux journalier 214,29 DH → mois de 30 jours = 6 428,57 DH (jamais `1500 × 4 = 6000`).
- **RG-023** — Une `BudgetExpense` est toujours rattachée à un `VariableBudget` actif à sa date ; si aucun budget actif n'existe pour la catégorie à cette date, la dépense est enregistrée comme `AdHocExpense` (jamais bloquée en saisie, cf. §51 "pénible à utiliser").
- **RG-024** — Le "rythme de dépense" (§6.3) se calcule ainsi : `rythme_projete = consommé_a_date / jours_ecoules × jours_totaux_periode`. Un dépassement probable est signalé si `rythme_projete > budget_periode_calendaire × seuil` (seuil paramétrable, défaut 100 %).

### E.5 Épargne et provisions

- **RG-030** — Une `SavingsPocket` a un caractère `protégée` ou `flexible` (booléen), déterminant si elle peut être proposée par le moteur d'arbitrage comme source de financement d'un `Goal` tiers.
- **RG-031** — Un versement planifié sur une poche (mensualité récurrente déclarée) génère une occurrence prévue, jamais un `PocketMovement` réel — même logique que RG-010/011 appliquée à l'épargne (§10, "un versement prévu ne doit pas être comptabilisé automatiquement").
- **RG-032** — Une `Provision` peut être liée à 1..n `Deadline` futures. Le "reste à constituer" = `Σ(montant_dû des Deadline liées non payées) − montant_actuel_provision`.
- **RG-033** — Le versement mensuel recommandé pour une `Provision` = `reste_a_constituer / nb_mois_restants_avant_echeance_la_plus_proche` (arrondi au multiple pertinent, ex. dizaine de DH). C'est une **suggestion**, jamais une écriture automatique (RG-000).
- **RG-034** — Argent d'une `SavingsPocket`/`Provision` **protégée** : exclu par construction des calculs de "capacité de financement" d'un `Goal` (§34, ne jamais mélanger).
- **RG-035** — Un transfert entre deux poches, ou d'une poche vers le compte courant, est toujours une action explicite à deux écritures liées (retrait poche A + réaffectation), jamais un déplacement automatique inter-objectifs (§38 "ne jamais déplacer automatiquement").

### E.6 Objectifs / projets

- **RG-040** — Un `Goal` a un statut (`en_cours`, `atteint`, `en_pause`, `abandonné`). Le passage à `atteint` peut être proposé automatiquement par le système dès que `montant_disponible ≥ prix_cible`, mais reste soumis à confirmation utilisateur avant d'être considéré comme "financé et déclenché à l'achat".
- **RG-041 (arbitrage à priorité égale)** — Quand plusieurs `Goal` de même niveau de priorité sont en concurrence pour la capacité de financement disponible, l'ordre de suggestion est : (1) date cible la plus proche, (2) date de création la plus ancienne. L'utilisateur reste libre de réordonner manuellement.
- **RG-042** — Un `Goal` peut être financé par des `GoalContribution` directes et/ou par rattachement à une `SavingsPocket` dédiée (`RG` D) — jamais les deux mécanismes ne comptent le même DH deux fois (contrôle d'unicité applicatif).

### E.7 Priorité des engagements (§15)

- **RG-045** — Chaque engagement financier récurrent porte un niveau de priorité 1 à 4 : (1) obligations incompressibles, (2) épargne protégée, (3) provisions importantes, (4) projets/objectifs. Le niveau est **par défaut déduit du type d'entité** (ex. tout `ChargePlan.obligatoire = true` → priorité 1) mais reste modifiable par l'utilisateur.
- **RG-046** — Le moteur d'arbitrage, en cas de capacité insuffisante détectée sur une période, ne réordonne ni ne réduit jamais automatiquement un engagement de priorité inférieure ; il **propose textuellement** un ordre de réduction/report, classé priorité 4 → 1, jamais l'inverse.

### E.8 Prévisions et alertes

- **RG-050** — La projection de trésorerie est un calcul **jour par jour** (pas mois par mois), sommant chronologiquement tous les mouvements prévus (`IncomeOccurrence` prévues, `Deadline` non soldées, `BudgetExpense` projetées via rythme, `Provision`/`SavingsPocket` versements planifiés) à partir du solde déclaré actuel (cf. formules G.4-G.5).
- **RG-051 (trou de trésorerie)** — Une alerte "tension de trésorerie" est déclenchée dès que le solde projeté quotidien passe sous le seuil de marge de sécurité à une date donnée, même si le solde du mois calendaire pris globalement reste positif (§18).
- **RG-052 (anomalie)** — Une dépense/échéance réalisée est signalée "anormale" si elle dépasse la moyenne historique de sa catégorie (fenêtre glissante, défaut 6 mois) d'un seuil paramétrable (défaut ±40 %). Ce n'est jamais bloquant (§21), uniquement une alerte informative.
- **RG-053 (charge oubliée)** — Si un `ChargePlan` récurrent a produit une `Deadline` chaque période depuis au moins 3 occurrences consécutives, et qu'aucune `Deadline` n'existe pour la période courante après la date habituelle attendue, une alerte "charge potentiellement oubliée" est levée avec 3 actions possibles : créer une estimation, ignorer cette période, confirmer qu'elle n'est pas due (§22).
- **RG-054 (suggestion de budget appris)** — Après un historique suffisant (défaut : 3 périodes complètes minimum), le système peut suggérer un budget révisé = moyenne mobile de la consommation réelle. Suggestion seule, jamais appliquée sans acceptation (cf. INC-07).

### E.9 Historique, suppression, justificatifs

- **RG-060 (suppression logique)** — Aucune opération financière validée (`Payment`, `IncomeOccurrence.reçu`, `PocketMovement`, `GoalContribution`) n'est supprimable physiquement par un utilisateur standard. Seules les opérations encore à l'état `prévu`/`planifié` peuvent être supprimées directement (elles n'ont jamais représenté un fait réel). Toute autre suppression = archivage (`statut = annulé` ou `archivé`) tracé dans `AuditEvent`.
- **RG-061** — Toute modification de champ sensible (montant, date, statut, bénéficiaire) sur une entité financière génère un `AuditEvent` (ancienne valeur, nouvelle valeur, auteur, horodatage) — cf. REC-03.
- **RG-062** — Un `Attachment` peut être associé à `Deadline`, `Payment` ou `AdHocExpense`, jamais obligatoire, taille et formats limités (image, PDF).
- **RG-063** — Un montant peut être marqué `est_estime = true`. Quand un montant réel est renseigné (paiement confirmé), le montant estimé initial est conservé en historique et l'écart (`montant_reel − montant_estime`) est calculé et affiché (§36-§37).

---

## F. Statuts et transitions

### F.1 `IncomeOccurrence`

```
prévu ──(confirmation utilisateur, montant saisi)──► reçu
prévu ──(date dépassée + délai de grâce)──► en_retard ──(confirmation tardive)──► reçu
prévu / en_retard ──(annulation utilisateur)──► annulé
```
Aucun retour arrière automatique. `annulé → prévu` possible manuellement (correction de saisie), tracé en audit.

### F.2 `Deadline` (échéance)

Statuts : `planifiée` → `à_venir` → `à_payer` → {`payée` | `partiellement_payée` → `payée`} ; branches parallèles `en_retard`, `reportée`, `annulée`.

- **planifiée** : date d'échéance à plus de `seuil_a_venir` jours (paramètre foyer, défaut 30j).
- **à_venir** : dans la fenêtre `seuil_a_venir` mais avant `seuil_a_payer`.
- **à_payer** : dans la fenêtre `seuil_a_payer` jours avant échéance (défaut 7j) jusqu'à la date d'échéance incluse, statut par défaut qui déclenche la question de confirmation (§7).
- **partiellement_payée** : au moins un `Payment` existe et `Σ(payments) < montant_dû` (RG-014).
- **payée** : clôture confirmée par l'utilisateur.
- **en_retard** : date d'échéance dépassée sans clôture ni paiement complet (transition automatique de *statut d'affichage*, cf. RG-012 par analogie — ne constitue pas une écriture financière).
- **reportée** : l'utilisateur choisit "Reporter" (§7) → nouvelle date d'échéance saisie, l'ancienne est conservée en historique (audit), le statut revient à `planifiée`/`à_venir`/`à_payer` selon la nouvelle date.
- **annulée** : l'échéance ne sera pas payée (ex. charge finalement non due) — archivage logique, jamais suppression physique.

Diagramme :
```
planifiée → à_venir → à_payer ──┬─► payée
                                 ├─► partiellement_payée ─► payée
                                 ├─► en_retard ─┬─► payée
                                 │              └─► partiellement_payée ─► payée
                                 ├─► reportée ─► (ré-entre le cycle à la nouvelle date)
                                 └─► annulée  (terminal)
```

### F.3 `VariableBudget` (par période)

Pas un statut binaire mais un **niveau calculé en continu** : `sous_budget` / `proche_limite` (≥ seuil paramétrable, défaut 80 %) / `dépassé` (> 100 %). Purement informatif, jamais bloquant.

### F.4 `PocketMovement` (épargne/provision)

```
prévu ──(confirmation utilisateur)──► confirmé
prévu ──(date dépassée)──► en_retard ──(confirmation tardive)──► confirmé
prévu / en_retard ──(annulation)──► annulé
```
Identique en structure à `IncomeOccurrence` (RG-031), volontairement — cohérence de mental model pour l'utilisateur.

### F.5 `Goal`

```
en_cours ──(financement complet + confirmation achat)──► atteint
en_cours ──(mise en pause manuelle)──► en_pause ──► en_cours
en_cours / en_pause ──(abandon manuel)──► abandonné
```

### F.6 `SimulationScenario`

```
brouillon ──(sauvegarde nommée)──► sauvegardé
sauvegardé ──(suppression manuelle)──► supprimé (physique, car aucune donnée réelle engagée)
```
Seul type d'entité pour lequel la suppression physique est admise sans restriction (RG-060 ne s'applique pas : ce n'est jamais un fait financier réel).

---

## G. Formules de calcul (référence unique — toute autre occurrence dans le produit doit pointer ici)

### G.1 Trésorerie déclarée
```
Trésorerie_déclarée(T) = Σ soldes des comptes/espèces déclarés par le foyer à la date T
```
Saisie manuelle en V1 (pas de connexion bancaire, §46).

### G.2 Trésorerie engagée (à un instant T, jusqu'à horizon H)
```
Engagée(T, H) = Σ montant_dû des Deadline dont statut ∈ {à_payer, partiellement_payée, en_retard}
                  et date_échéance ≤ H
              + Σ (budget_periode_calendaire − consommé_a_date) des VariableBudget actifs
                  dont la période se termine ≤ H
```

### G.3 Trésorerie réservée
```
Réservée = Σ montant_actuel des SavingsPocket (protégées + flexibles)
         + Σ montant_actuel des Provision
```
> Rappel INC-02 : ce montant est un **fléchage logique**, pas nécessairement un compte séparé physiquement.

### G.4 Disponible immédiat *(remplace la formule ambiguë du §5, cf. INC-01/REC-02)*
```
H* = date de la prochaine IncomeOccurrence "prévue" significative
Disponible_immédiat = Trésorerie_déclarée(T) − Engagée(T, H*) − Réservée − Marge_sécurité
```

### G.5 Projection glissante quotidienne (pour un horizon N jours)
```
Solde_projeté(T+k) = Trésorerie_déclarée(T)
   + Σ IncomeOccurrence.montant_prévu (statut=prévu, date ∈ [T, T+k])
   − Σ Deadline.montant_dû            (statut≠payée/annulée, date ∈ [T, T+k])
   − Σ BudgetExpense projetées         (rythme_projeté réparti au prorata des jours, date ∈ [T, T+k])
   − Σ PocketMovement.montant_prévu    (versements épargne/provision planifiés, date ∈ [T, T+k])
   pour k = 0 .. N
```
Le point bas (`min(Solde_projeté)`) sur la fenêtre sert à détecter les trous de trésorerie (RG-051), indépendamment du solde de fin de mois.

### G.6 Prorata d'un budget variable (RG-022)
```
taux_journalier = montant_référence / nb_jours_période_référence
budget_periode_calendaire = taux_journalier × nb_jours_réels_de_la_période
```

### G.7 Rythme de consommation d'un budget (RG-024)
```
rythme_projeté = (consommé_à_date / jours_écoulés_dans_la_période) × jours_totaux_période
dépassement_probable = rythme_projeté − budget_periode_calendaire   (si > 0)
```

### G.8 Reste à constituer d'une provision (RG-032/033)
```
reste_à_constituer = Σ(montant_dû des Deadline liées, non payées) − montant_actuel_provision
versement_mensuel_recommandé = reste_à_constituer / nb_mois_restants(date_échéance_la_plus_proche_liée)
```

### G.9 Capacité d'épargne (période donnée)
```
Capacité_épargne = Σ Revenus_prévus(période)
                  − Σ ChargePlan.obligatoire (priorité 1, période)
                  − Σ Provision.versement_recommandé (priorité 3, période)
                  − Σ VariableBudget.budget_periode_calendaire (période)
                  − Δ_marge_sécurité (si la marge cible n'est pas encore atteinte)
```

### G.10 Capacité de financement d'un objectif
```
Capacité_financement(Goal) = Capacité_épargne(période)
   − Σ versements déjà engagés vers SavingsPocket protégées (priorité 2)
   − Σ versements déjà engagés vers d'autres Goal de priorité ≥ (RG-041)
```

### G.11 Simulateur "Puis-je me le permettre ?"
```
Pour un achat (montant M, date_souhaitée D) :
   Solde_projeté_avec_achat(t) = Solde_projeté(t) − M   pour t ≥ D
   marge_résiduelle_min = min(Solde_projeté_avec_achat(t)) sur [D, D+horizon_analyse]

Verdict :
   marge_résiduelle_min ≥ Marge_sécurité                        → "possible maintenant"
   0 ≤ marge_résiduelle_min < Marge_sécurité                     → "possible mais risqué"
   marge_résiduelle_min < 0 mais devient ≥ Marge_sécurité         → "recommandé plus tard"
     à une date D' calculée (recherche de la 1ʳᵉ date où la condition "possible" est vraie)
   Aucune date raisonnable (horizon_analyse) ne satisfait la condition → "non compatible actuellement"
```
Calcul strictement en lecture : aucune écriture, cf. RG-000 et E.9.

### G.12 Coussin de sécurité en mois de dépenses (§16, REC-08)
```
dépenses_mensuelles_moyennes = moyenne mobile 6 mois (ChargePlan obligatoires + budgets variables moyens)
coussin_en_mois = Marge_sécurité_actuelle / dépenses_mensuelles_moyennes
```

### G.13 Écart prévu/réel (§37)
```
écart = montant_réel − montant_prévu_ou_estimé
```
Déclenche un recalcul immédiat de toute projection en aval (toute lecture de G.5 est toujours faite à la volée sur les données courantes, jamais en cache long — cf. document 04, pas de dénormalisation dangereuse).

---

## H. Cas limites

- **H-01 — Deux confirmations simultanées** : Adil et Lamiaa confirment la même `Deadline` en même temps depuis deux appareils. Résolution : le premier `Payment`/confirmation écrit gagne ; le second déclenche un conflit détecté (cf. document 04 §R) affiché à l'auteur du second geste ("cette échéance vient d'être confirmée par Lamiaa, voir détail") plutôt qu'un écrasement silencieux.
- **H-02 — Paiement réel supérieur au montant estimé après clôture** : l'utilisateur rouvre une `Deadline` `payée` pour corriger — autorisé uniquement en admin, génère un `AuditEvent`, ne supprime jamais le paiement initial (ajoute un `Payment` complémentaire typé `régularisation`).
- **H-03 — Échéance annulée après provision déjà constituée** : la `Provision` liée reste positive ; l'utilisateur est invité (jamais forcé) à la réaffecter à une autre `Deadline` ou à la convertir en `SavingsPocket` flexible.
- **H-04 — Revenu prévu jamais confirmé ni annulé pendant des mois** : au-delà d'un délai paramétrable (défaut 60 jours), l'occurrence bascule d'`en_retard` à un état d'affichage `obsolète` (n'entre plus dans les projections actives) sans jamais être supprimée.
- **H-05 — Budget variable modifié en cours de période** : le nouveau montant s'applique au prorata restant (RG-022 recalculée sur les jours restants), l'historique du montant précédent est conservé pour ne pas fausser l'apprentissage (§20).
- **H-06 — Enfant retiré du foyer (déménagement, majorité)** : `Child` n'est jamais supprimé si des opérations lui sont rattachées ; passage à un statut `inactif`, conservé pour l'historique et les budgets scolaires passés.
- **H-07 — Devise unique supposée** : le cahier des charges est mono-devise (DH) ; si un revenu/charge en devise étrangère apparaît (ex. virement depuis l'étranger), V1 l'exclut explicitement (converti manuellement par l'utilisateur à la saisie) — pas de moteur multi-devise en V1 (cf. K, roadmap).
- **H-08 — Objectif atteint puis le prix cible change** (inflation) : `Goal.prix_cible` reste modifiable manuellement en `en_cours`, ce qui rouvre le calcul de capacité de financement sans changer le statut.
- **H-09 — Deux `Provision` liées à la même `Deadline`** : interdit par construction (une `Deadline` ne peut être rattachée qu'à une seule `Provision` à la fois) pour éviter un double comptage du "reste à constituer" (cf. §34).
- **H-10 — Marge de sécurité négative de fait** (dépenses obligatoires dépassant la trésorerie déclarée) : le disponible immédiat (G.4) peut être négatif ; l'UI l'affiche tel quel en rouge plutôt que de le clipper à 0, car masquer un déficit réel serait contraire à la philosophie du produit (§1).
- **H-11 — Suppression d'un `ChargePlan` ayant des `Deadline` déjà payées** : interdite ; seule la désactivation (`date_fin = aujourd'hui`, plus de génération future) est possible, l'historique des échéances passées reste intact.
