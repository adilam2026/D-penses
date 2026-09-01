# 05 — Roadmap, risques, plan de développement (V2)

> Couvre les points K, L, T. La portée V1/V2/V3 (K) reste globalement valide ; ce document V2 met à jour la présence des comptes financiers dès le lot 0/1, ajoute des risques issus de la revue de cohérence, et surtout ajoute des **tests de calcul obligatoires par lot** (point 22 des remarques) — le développement n'est plus découpé uniquement par écrans.

---

## K. Fonctionnalités par version — mise à jour V2

### V1 — cœur du produit
Reprend l'ensemble de la V1 (document 05 initial), **augmenté de** :
- Comptes financiers (`FinancialAccount`), rapprochement bancaire simple, transferts entre comptes — dès la V1, pas différé, car la trésorerie déclarée seule s'est révélée insuffisante pour un modèle financièrement fiable.
- `reste_a_payer` comme valeur centrale partout où la V1 utilisait un montant dû brut.
- Modèle de statuts scindé financier/temporel pour les échéances.
- Simulateur enrichi (indicateurs multiples, pas seulement un verdict).

### V2 / V3
Inchangés pour l'essentiel. Précision : la **confidentialité fine des poches personnelles** (V2 en V1 du dossier) devient plus naturelle à livrer désormais que les comptes existent (un compte `owner_user_id` peut porter sa propre visibilité) — reste en V2, non promue en V1 pour ne pas alourdir les droits d'accès dès le départ.

**Hors périmètre à toute version** : inchangé (pas de connexion bancaire live, pas d'OCR, pas d'IA générative, pas de trading, pas de comptabilité professionnelle, pas de fiscalité).

---

## L. Risques

### L.1 Risques fonctionnels (V1, inchangés)
Confusion prévu/réel, fatigue de confirmation, double comptage épargne/provision (largement mitigé par RG-070→074 mais la vigilance UX reste nécessaire — cf. L.3), prorata mal compris, priorité mal comprise.

### L.2 Risques techniques (V1, inchangés)
Dérive de calcul client/serveur, performance de la projection glissante, conflits offline, fuite de données entre foyers, RRULE sous-estimée, croissance non maîtrisée du modèle.

### L.3 Nouveaux risques introduits par le modèle V2 *(issus de la revue de cohérence)*

| Risque | Impact | Mitigation |
|---|---|---|
| **Complexité perçue par l'utilisateur final** — les comptes, le rapprochement, les transferts peuvent donner une impression « logiciel comptable » | Rejet de l'app par des utilisateurs non financiers | UX par défaut à un seul compte implicite (RG-095), écran Comptes en profondeur secondaire jamais en navigation principale (§23) |
| **Confusion entre les deux projections** (physique vs. capacité libre) si mal présentées | L'utilisateur regarde le mauvais chiffre pour décider ("j'ai 57 000 DH, pourquoi le simulateur dit non ?") | Vocabulaire stable et explication en un tap partout (REC-10), jamais un seul nombre sur le dashboard |
| **Erreur de saisie du mode d'allocation** (`virtual_allocation` déclaré alors que l'argent a réellement été transféré, ou l'inverse) | Double comptage ou sous-comptage silencieux, exactement le bug que RG-070→074 vise à éliminer | Contrainte d'unicité base (IF-14), parcours explicite de conversion (H-15), alerte si un compte `backed_by_account` reçoit un mouvement hors `AccountTransfer` |
| **Calcul temporel de suffisance des provisions mal compris par l'utilisateur** (RG-032bis produit un chiffre plus élevé que l'intuition « reste/mois ») | Le foyer conteste la recommandation, la juge trop prudente | Toujours expliquer *pourquoi* (afficher l'échéance intermédiaire qui contraint le calcul), jamais un chiffre nu — cf. document 06 pour l'exemple pédagogique |
| **Oubli de rapprochement prolongé** (H-16) rendant le solde calculé de plus en plus fictif | Toutes les projections deviennent silencieusement fausses sans que l'utilisateur s'en rende compte | Alerte passive à 60 jours (Q), jamais bloquante |
| **Sur-ingénierie du modèle de comptes en développement** (ex. vouloir gérer des soldes multi-devises ou des comptes joints complexes dès la V1) | Dérive de planning, retour au risque de croissance non maîtrisée (L.2) | S'en tenir strictement au schéma du document 04 §P pour la V1 ; toute extension passe par une revue de conception |

---

## T. Plan de développement par lots — mis à jour, avec tests obligatoires

> **Changement V2 majeur (point 22 des remarques)** : chaque lot est désormais accompagné d'une liste de **tests de calcul obligatoires**, à valider avant de considérer le lot terminé — le développement n'est plus scindé uniquement par écrans visibles.

### Lot 0 — Socle
Auth, Household, HouseholdMembership, Child, Category, HouseholdSettings, isolation multi-foyer, sécurité de base, navigation à vide.
*Pas de test de calcul financier à ce stade (aucune donnée financière encore modélisée).*

### Lot 1 — Comptes financiers *(nouveau, avancé plus tôt qu'en V1)*
`FinancialAccount`, `AccountBalanceSnapshot`, calcul de `solde_courant` (G.1), `AccountTransfer`, `Reconciliation`/`Adjustment`.
**Tests obligatoires :**
- Transfert interne entre deux comptes du foyer → impact net foyer = 0 (IF-03).
- Rapprochement avec écart → `Reconciliation.pending` créée, aucune écriture automatique tant qu'aucune action n'est choisie.
- Solde recalculé correctement après une suite de mouvements réels sur plusieurs jours sans nouvelle déclaration de solde (scénario du point 9 des remarques : 30 000 → 29 300 sans ressaisie).

### Lot 2 — Suivre : revenus & charges de base
IncomeSource/Occurrence (avec `account_id`), ChargePlan/Deadline (mode `auto_frequence`), Payment (avec `account_id`, `type`), confirmation prévu→réel, écran Transactions (`LedgerEntry`), saisie rapide « + ».
**Tests obligatoires :**
- Paiement anticipé d'une échéance avant sa date d'échéance.
- Paiement partiel puis second paiement qui solde → `reste_a_payer` correctement décroissant, statut financier `partiellement_payée` puis `soldée`.
- Remboursement (`type=remboursement`) → `reste_a_payer` augmente correctement, jamais de valeur négative interdite par erreur.
- Modification du montant d'une échéance déjà partiellement payée → `reste_a_payer` recalculé sur le nouveau montant, pas l'ancien.
- Annulation d'une échéance → exclusion immédiate de toutes les projections.
- **(V2.1)** Un `Payment` de type `paiement` sur un compte de 10 000 DH pour 1 000 DH → `solde_courant` = 9 000 DH, jamais 11 000 DH (test de régression du signe dans `LedgerEntry`, document 04 §P.2).

### Lot 3 — Budgets variables & dépenses ponctuelles
VariableBudget + prorata (G.7), BudgetExpense, AdHocExpense, `Projection_prudente_restante` (G.8).
**Tests obligatoires :**
- Le consommé réel n'apparaît jamais une seconde fois dans le restant projeté (IF-13).
- Prorata correct sur un mois de 28, 30 et 31 jours (pas de calcul naïf ×4).
- Budget modifié en cours de période → recalcul au prorata des jours restants uniquement.
- **(V2.1)** Budget hebdomadaire : une semaine calendaire complète comprise dans une fenêtre de calcul vaut le montant plein (pas de prorata) ; une fenêtre non alignée sur les semaines réelles (ex. horizon `Montants_engagés`) proratise correctement les seules semaines partielles en bord de fenêtre, sans jamais mélanger la fréquence du budget avec la date du prochain salaire (RG-098/RG-099).

### Lot 4 — Charges planifiées & module scolaire/abonnements
ChargePlan `calendrier_manuel`, fiche enfant + vues filtrées scolarité/abonnements, justificatifs.
**Tests obligatoires :** identiques au Lot 2 appliqués à une charge à calendrier manuel (aucune duplication de règle).

### Lot 5 — Trésorerie & dashboard
G.2 à G.5 (patrimoine liquide, trésorerie opérationnelle, montants réservés, montants engagés, disponible libre), Dashboard v1, Calendrier financier.
**Tests obligatoires :**
- Une échéance au statut temporel « à venir »/« future » dont la `due_date` tombe avant la prochaine rentrée d'argent est bien incluse dans les Montants engagés (RG-050/IF-11 — le scénario exact du point 4 des remarques).
- Une poche `backed_by_account` n'apparaît jamais dans Montants réservés (IF-06).

### Lot 6 — Épargne, provisions, objectifs
SavingsPocket/Provision (`allocation_mode`), PocketMovement, calcul temporel de suffisance (RG-032bis), Goal/GoalContribution, priorités, protection par défaut de l'épargne enfant (RG-047).
**Tests obligatoires :**
- Une poche `virtual_allocation` : son solde égale exactement la somme de ses `PocketMovement` confirmés, jamais une valeur stockée à part (IF-07).
- Une poche `backed_by_account` : son solde égale exactement le solde courant de son compte lié (IF-08), et son montant n'apparaît jamais dans Montants réservés.
- Provision liée à 3+ échéances de dates différentes → le versement recommandé couvre bien le palier intermédiaire le plus contraignant, pas seulement le total final (le scénario exact du document 06).
- Le moteur d'arbitrage ne propose jamais une épargne enfant protégée pour financer un objectif de priorité inférieure sans action utilisateur explicite (RG-047).
- **(V2.1)** Couverture provision/échéance : `couverture_affectée + engagement_non_couvert = reste_a_payer` exactement, sur une provision virtuelle comme sur une provision `backed_by_account` (RG-090→093, IF-16).
- **(V2.1)** Provision liée à 2 échéances chronologiques : la couverture s'affecte à la plus proche en premier jusqu'à épuisement, jamais réparties au prorata des deux (IF-17/IF-18).
- **(V2.1)** « Payer avec la provision » (RG-095/RG-096) : une seule confirmation crée atomiquement le `Payment` et le retrait de provision (poche virtuelle) ou débite directement le compte dédié (poche adossée) ; cas provision suffisante, insuffisante, et combinaison provision + compte courant.
- **(V2.1)** Un paiement réglé sans passer par « payer avec la provision » ne décrémente jamais la provision (RG-097), même une fois l'échéance soldée.

### Lot 7 — Moteur de projection & alertes
G.6a/G.6b (deux projections distinctes), détection de trou de trésorerie sur chacune, alertes retard/dépassement/oubli/anomalie, Actions à traiter, notifications.
**Tests obligatoires :**
- Un mois globalement positif contenant un trou de trésorerie intra-mois déclenche bien l'alerte (RG-051) sur le point bas, pas sur le solde de fin de mois.
- Une affectation virtuelle ne fait jamais varier la projection physique (G.6a), seulement la projection de capacité libre (G.6b).
- Un transfert interne entre deux comptes opérationnels ne modifie jamais la Trésorerie opérationnelle agrégée du foyer.

### Lot 8 — Simulateur & scénarios
G.11 enrichi (verdict + indicateurs multiples), coussin de sécurité, sauvegarde de scénario.
**Tests obligatoires :**
- Achat possible (point bas après achat confortablement au-dessus du coussin).
- Achat risqué (point bas positif mais marge résiduelle sous le coussin).
- Achat à reporter (point bas négatif à la date souhaitée, mais une date ultérieure satisfait la condition — la date recommandée doit être correctement identifiée).
- Plusieurs objectifs concurrents de même priorité → l'ordre de suggestion respecte RG-041.
- Aucune écriture réelle n'est produite pendant l'exécution d'une simulation, y compris sauvegardée (IF-10).

### Lot 9 — Historique, audit, robustesse multi-utilisateur
AuditEvent complet, synchronisation quasi temps réel, gestion de conflits (H-01), corrections d'opérations réelles par contre-écriture (RG-064).
**Tests obligatoires :**
- Toute correction d'une opération validée passe par une contre-écriture auditée, jamais une suppression (IF-09/IF-15).
- Deux confirmations simultanées sur la même échéance depuis deux appareils → la seconde est explicitement signalée, jamais silencieusement écrasée.

### Lot 10 — Offline V1
Cache local lecture complète + file d'écriture simple.

### Lot 11 — Sauvegarde, export, finitions sécurité
Export CSV/PDF, suppression de compte/foyer, déconnexion multi-appareils, durcissement sécurité.

**Dépendances critiques (mises à jour)** : le Lot Comptes (1) précède désormais tout le reste, car `account_id` est référencé dès le Lot 2. Le Lot Trésorerie (5) dépend des Lots 1-2-3 ; le Lot Épargne (6) peut être partiellement parallélisé avec le Lot 5 une fois le Lot 1 stable ; le Lot Projection (7) dépend de 5 et 6 ; le Lot Simulateur (8) dépend de 7.
