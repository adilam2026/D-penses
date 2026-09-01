# 03 — Parcours utilisateurs & structure des écrans (V2)

> Couvre les points I, J. Les parcours I.2 à I.10 de la V1 restent valides tels quels (saisie rapide, confirmation d'échéance, paiement partiel, revenu, épargne, simulateur, Actions à traiter) — non reproduits ici sauf changement. S'y ajoutent les parcours comptes/rapprochement/transferts et le simulateur enrichi (V2).

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

### J.1 Fusions V1 — inchangées
Toutes les fusions de la V1 restent valides (feuille « + » unique, maître-détail charges, calendrier=échéances, Épargne+Provisions, Foyer+Enfant+Scolarité, Notifications=historique d'Actions à traiter, pas d'écran Documents dédié, Paramètres consolidé).

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

### J.4 Liste consolidée des écrans (V2 — 17 zones)
Identique à la liste V1 (16 zones), avec l'ajout de **Comptes** en sous-écran de Paramètres/Plus (pas une zone de navigation principale supplémentaire) :

1. Splash · 2. Connexion/Inscription · 3. Créer/rejoindre un foyer · 4. Onboarding financier (inclut désormais la déclaration de comptes) · 5. **Dashboard** · 6. **Transactions** (alimenté par `LedgerEntry`) · 7. Feuille « + » (dépense/revenu/échéance/objectif/**transfert**) · 8. **Charges & échéances** · 9. **Calendrier** · 10. **Budgets variables** · 11. **Épargne, Provisions & Objectifs** · 12. **Simulateur** (enrichi) · 13. **Foyer** · 14. **Actions à traiter** · 15. Historique/Audit · 16. Paramètres (inclut **Comptes** et rapprochement).
