# 03 — Parcours utilisateurs & structure des écrans (V2.2)

> Couvre les points I, J. Les parcours I.2 à I.10 de la V1 restent valides tels quels (saisie rapide, confirmation d'échéance, paiement partiel, revenu, épargne, simulateur, Actions à traiter) — non reproduits ici sauf changement. S'y ajoutent les parcours comptes/rapprochement/transferts et le simulateur enrichi (V2), puis confirmation de montant, plan financier générique, vue par enfant et assistant scolaire (V2.2).

---

## I. Parcours utilisateurs clés

### I.1 Onboarding foyer — précisé (comptes dès le départ)
L'étape 1 de l'onboarding financier (« Trésorerie déclarée actuelle ») devient concrètement la **déclaration des comptes** — mais reste rapide et facultative dans le détail :
```
Onboarding financier :
  1. Comptes — ajout rapide : nom, type (courant/épargne/espèces), solde actuel
     (1 ligne par compte, "Compte courant" pré-rempli comme premier type suggéré ;
      possibilité de tout faire tenir en un seul compte "Trésorerie" si l'utilisateur
      ne veut pas se compliquer la vie dès le premier lancement, cf. §23)
  2. Marge de sécurité souhaitée (suggestion possible si historique insuffisant)
  3. Revenus récurrents principaux
  4. Charges fixes principales
```
Un foyer qui ne déclare qu'un seul compte n'est jamais bloqué — le modèle à plusieurs comptes est disponible, jamais imposé.

### I.2 – I.10 (V1)
Inchangés — saisie rapide d'une dépense, confirmation d'échéance à sa date, paiement anticipé, paiement partiel, confirmation de revenu, versement d'épargne/provision, création d'objectif, traiter « Actions à traiter ». Un seul ajustement transversal : chaque dépense/paiement utilise désormais implicitement un compte (RG-uxA ci-dessous), sans jamais l'exposer par défaut à l'utilisateur.

**RG-uxA (UX, ex-RG-095 V2)** — Toute saisie de dépense/paiement pré-remplit le compte avec, dans l'ordre : le compte favori déclaré par l'utilisateur, sinon le dernier compte utilisé pour cette catégorie, sinon le compte principal du foyer. Le champ compte reste modifiable en un tap mais n'exige jamais une décision explicite pour une saisie courante (cf. §23, point 23 des remarques).

### I.3bis — Payer une échéance avec une provision *(nouveau V2.1, résout le point 4 des remarques)*

Quand une `Deadline` est liée à une `Provision` disposant d'un solde, l'action « Marquer comme payée » (I.3) propose une étape supplémentaire, en une seule confirmation :
```
« Marquer comme payée » → montant réel + date (comme en I.3)
   → « Source du paiement ? »
        ○ Compte courant (ou compte favori, pré-sélectionné)
        ○ Un autre compte
        ○ Provision Scolarité (12 000 DH disponibles)         ← si la provision liée a un solde > 0
        ○ Répartir (ex. 10 000 DH depuis la provision + 5 000 DH depuis le compte courant)
   → [Confirmer] — une seule validation, quel que soit le nombre de sources choisies
```
Derrière cette unique confirmation (document 02, RG-095/RG-096) : le `Payment` est créé (un ou deux enregistrements si répartition), la provision est décrémentée du montant utilisé (si `virtual_allocation` : retrait confirmé automatique ; si `backed_by_account` : simple conséquence du compte dédié débité), et l'échéance passe `soldée` ou `partiellement_payée` selon le montant couvert. Si la provision est **insuffisante** pour couvrir la totalité, l'écran propose directement le complément par un compte, sans étape supplémentaire ni double confirmation.

### I.10bis — Confirmer le montant d'une facture *(nouveau V2.2, résout le point 2 des remarques)*
```
Action à traiter : « Facture T2 attendue mais non encore confirmée » (depuis le jour expected_billing_date)
   → ouvre la Deadline (montant = « estimé » ou « inconnu »)
   → « Facture reçue — confirmer le montant »
        saisie du montant réel (pré-rempli avec l'estimation si elle existe)
   → [Confirmer] → amount_status → confirmé, billing_date renseignée, montant estimé initial conservé
```
Distinct du paiement (I.3) : confirmer un montant ne le paie pas, et payer une échéance n'exige pas d'être passé par cette étape au préalable (une facture peut être payée directement, montant confirmé au même moment).

**Nouveaux types d'Actions à traiter (V2.2, RG-117/118)** — exemples de formulation, générés seulement quand pertinents pour l'horizon courant (jamais des mois à l'avance) : « Restauration T2 : montant non encore renseigné. » · « Garderie Wael : indiquez si le service sera utilisé. » · « Échéance T2 : montant encore estimé, à confirmer si la facture est arrivée. » · « Facture T2 attendue depuis le 12 janvier mais non confirmée. » · « Assurance continuité : décision à prendre. »

### I.13bis — Simulateur : incertitude affichée *(nouveau V2.2, résout les points 12/13)*
Quand une `Deadline` pertinente pour l'horizon simulé (I.13) est à `amount_status ∈ {estimé, inconnu}` ou correspond à une option `envisagée`, le résultat du simulateur ajoute une ligne explicite, jamais silencieuse :
```
« Selon les dépenses actuellement renseignées, cet achat est possible en décembre.
   ⚠ Le montant de la restauration scolaire T2 n'est pas encore connu — cette projection pourrait évoluer. »
```

### I.14 — Assistant « Ajouter les frais scolaires » *(nouveau V2.2, résout le point 14 des remarques)*
Assistant UX uniquement — n'introduit aucun modèle de données propre à l'école (réutilise `FinancialPlan`, `ChargePlan`, `Deadline`, `Child`) :
```
1. Année scolaire, établissement
2. Enfant(s) concerné(s) — crée ou réutilise un FinancialPlan « École 20XX/20XX »
3. Scolarité annuelle (montant global si connu)
4. Échéances T1/T2/T3 si connues — sinon « Je ne connais pas encore » → Deadline amount_status=inconnu
5. Fournitures, uniforme, sorties, réinscription — idem, chaque montant inconnu reste inconnu, jamais 0
6. Restauration — forfait trimestriel/mensuel/annuel si connu ; sinon amount_status=inconnu
   (jamais un calcul par prix unitaire × nombre de repas, cf. document 02 §E.3ter)
7. Garderie — ChargePlan mensuel classique ; ou « pas encore décidé » → obligation_status=optionnelle_envisagée
8. Assurance — obligatoire ou optionnelle (souscrite/envisagée/refusée)
9. Autres frais scolaires
   → [Créer le plan] — chaque étape passable sans donnée, jamais bloquante
```

### I.10ter — Vue par enfant et vue Plan financier *(nouveau V2.2, résout les points 7 et 10)*
```
Fiche enfant → onglet « Coûts » (agrégation G.15, filtrée par bénéficiaire) :
   Coût connu | Payé | Reste à payer | Provisionné | Reste à financer
   Répartition par catégorie (scolarité, restauration, garderie, activités, fournitures, sorties, uniforme, assurance…)
   Bandeau « Budget incomplet » si Complétude ≠ complet (G.14), jamais un total présenté comme définitif

Plan → « École 2026/2027 » (ou tout autre FinancialPlan) :
   Budget connu (avec statut complet/incomplet) | Payé | Reste à payer | Provisionné | Reste à financer
   Prochaine échéance + son taux de couverture par la provision associée
   Projection jusqu'à la fin de la période
   Éléments encore inconnus (liste qualitative) | Options envisagées (montant séparé, jamais fusionné)
```
Correspondance UX ↔ modèle (document 02, G.14/G.15, RG-119) : « Coût/Budget connu » = `known_plan_cost` (total historique, payé ou non) ; « Payé » = `paid_amount` ; « Reste à payer » = `remaining_due` ; « Provisionné » = `provision_coverage` ; « Reste à financer » = `remaining_to_fund`. Seuls ces deux derniers entrent dans Montants engagés (G.4) — jamais « Coût/Budget connu », qui reste un total descriptif.
Une charge commune à plusieurs enfants (ex. facture école 40 000 DH, Wael + Dina) apparaît dans les deux vues enfant sans dédoubler le paiement réel — sa ventilation analytique, quand elle existe, répartit seulement l'affichage (document 02, RG-116).

### I.11 — Rapprochement bancaire *(nouveau)*
```
Écran Compte → « Mettre à jour le solde »
   → saisie du solde réel actuel
   → comparaison automatique avec le solde calculé (G.1)
   → si écart : « Votre solde calculé est de 29 300 DH, votre banque indique 29 050 DH (écart : -250 DH) »
        [Enregistrer un ajustement]   → Adjustment créé, solde aligné
        [J'ai oublié une dépense]      → ouvre la saisie rapide pré-remplie avec le montant de l'écart
        [Ignorer pour l'instant]       → Reconciliation reste "pending", pas de blocage de l'app
        [Corriger une opération]       → ouvre la liste des mouvements récents du compte pour édition
   → si aucun écart : confirmation simple, nouveau point d'ancrage (AccountBalanceSnapshot)
```
Ce parcours n'apparaît **jamais** de façon proactive/bloquante — il est accessible à tout moment depuis la fiche compte, et suggéré (notification douce) uniquement après 60 jours sans rapprochement (H-16).

### I.12 — Transfert entre comptes *(nouveau)*
```
« + » → « Transfert »
   → compte source, compte destination (ou "Retrait espèces"/"Dépôt espèces"), montant, date
   → [Valider] → AccountTransfer confirmé immédiatement (ou "prévu" si date future)
   → aucun impact sur le disponible libre au niveau foyer si les deux comptes sont opérationnels ;
     impact visible si l'un des deux comptes est hors-périmètre opérationnel (ex. vers l'épargne enfants)
```
Distinct visuellement (icône, libellé « Transfert ») de toute dépense — jamais classé comme une charge ou imputé à une catégorie de dépense.

### I.13 — Simulateur enrichi *(révisé, résout le point 11)*
```
Simulateur → Achat (nom, montant, date souhaitée optionnelle, horizon d'analyse)
   → Résultat structuré, pas seulement un verdict :
        Verdict qualitatif (possible maintenant / possible mais risqué / recommandé plus tard / non compatible)
        + « Date techniquement possible : … »
        + « Date recommandée : … »
        + « Point bas de trésorerie après achat : X DH, le [date] »
        + « Marge par rapport à votre coussin de sécurité : ± Y DH »
        + « Impact sur vos provisions en cours : … » (le cas échéant)
        + « Impact sur votre épargne protégée : aucun — elle n'est jamais mobilisée automatiquement »
        + « Objectifs concurrents : … » (le cas échéant)
        + graphique de la trajectoire de capacité disponible avec/sans l'achat
   → [Enregistrer ce scénario] ou [Transformer en objectif]
   → Aucune donnée réelle modifiée (IF-10)
```
Exemple de formulation cible (cf. G.11) : *« Achat possible dès le 30 novembre, mais avec seulement 866 DH de marge au-dessus de votre coussin de sécurité. Fin décembre offre une marge nettement plus confortable (+6 158 DH). »*

---

## J. Structure des écrans

### J.1 Fusions V1 — inchangées, module scolaire précisé
Toutes les fusions de la V1 restent valides (feuille « + » unique, maître-détail charges, calendrier=échéances, Épargne+Provisions, Foyer+Enfant+Scolarité, Notifications=historique d'Actions à traiter, pas d'écran Documents dédié, Paramètres consolidé). **V2.2** : l'onglet Scolarité d'une fiche enfant (déjà fusionné en V1) est désormais explicitement une vue filtrée sur `FinancialPlan` (I.10ter) — pas d'écran ni de modèle de données supplémentaire pour l'école.

### J.2 Écran Comptes *(nouveau, minimal)*
Ajouté à la section « Plus », **jamais** en onglet de navigation principale (cf. §23 — la complexité des comptes reste secondaire) :
```
Plus → Comptes
   → liste des comptes (nom, type, solde courant, dernière date de rapprochement)
   → fiche compte → historique des mouvements (LedgerEntry filtrée), bouton "Mettre à jour le solde"
```
Le dashboard affiche la trésorerie de façon agrégée (Trésorerie opérationnelle, Patrimoine liquide total en un tap secondaire) — le détail par compte reste à un niveau de profondeur, jamais imposé en lecture courante.

### J.3 Dashboard — vocabulaire mis à jour *(résout le point 3)*
Le bandeau trésorerie du dashboard (§27) affiche désormais, dans cet ordre et avec ce vocabulaire stable :
```
Trésorerie opérationnelle   [montant]     (i) "L'argent disponible sur vos comptes courants et espèces"
Disponible libre            [montant]     (i) "Ce qui reste après vos engagements, réserves et coussin de sécurité"
─────────────────────────────────────────
Montants réservés           [montant]     (épargne + provisions non adossées à un compte dédié)
Montants engagés            [montant]     (échéances ouvertes + budgets restants avant votre prochaine rentrée)
```
« Patrimoine liquide total » (incluant l'épargne adossée à un compte dédié) reste accessible en un tap, mais n'est **jamais** le chiffre mis en avant par défaut — conformément à la distinction demandée entre patrimoine total et trésorerie mobilisable.

### J.4 Liste consolidée des écrans (V2.2 — 17 zones, inchangé en nombre)
Identique à la liste V2 (17 zones) — la notion de **Plan financier** (École, Vacances, Voiture…) et la **vue par enfant** (V2.2) ne créent pas de zone de navigation supplémentaire : elles vivent respectivement comme sous-écran de « Charges & échéances » / « Foyer » (fiche enfant), conformément à §23 (ne pas transformer l'application en tableur) :

1. Splash · 2. Connexion/Inscription · 3. Créer/rejoindre un foyer · 4. Onboarding financier (inclut désormais la déclaration de comptes) · 5. **Dashboard** · 6. **Transactions** (alimenté par `LedgerEntry`) · 7. Feuille « + » (dépense/revenu/échéance/objectif/**transfert**) · 8. **Charges & échéances** (inclut les **Plans financiers**, ex. « École 2026/2027 ») · 9. **Calendrier** · 10. **Budgets variables** · 11. **Épargne, Provisions & Objectifs** · 12. **Simulateur** (enrichi, signale l'incertitude) · 13. **Foyer** (fiche enfant → onglet Coûts, V2.2) · 14. **Actions à traiter** (inclut les données manquantes, V2.2) · 15. Historique/Audit · 16. Paramètres (inclut **Comptes** et rapprochement).
