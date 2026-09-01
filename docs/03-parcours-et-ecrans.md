# 03 — Parcours utilisateurs & structure des écrans

> Couvre les points **I** (parcours) et **J** (écrans, avec challenge de la liste §49).

---

## I. Parcours utilisateurs clés

### I.1 Onboarding foyer (premier lancement)

```
Splash → Connexion/Inscription → [Créer un foyer | Rejoindre un foyer (code/invitation)]
   → Onboarding financier :
        1. Trésorerie déclarée actuelle (comptes/espèces)
        2. Marge de sécurité souhaitée (avec suggestion REC-08 si historique insuffisant : "définir plus tard")
        3. Revenus récurrents principaux (rapide, 1-2 lignes, complétable plus tard)
        4. Charges fixes principales (idem, quick-add)
   → Dashboard (même incomplet — jamais bloquer sur un onboarding long, cf. §51)
```
Principe : chaque étape est **sautable**. Un foyer doit pouvoir arriver au dashboard en moins de 2 minutes, et enrichir les données progressivement (§51, §40 "ne pas surcharger").

### I.2 Saisie rapide d'une dépense (le geste le plus fréquent, §41)

```
Bouton flottant "+" → "Dépense"
   → Montant (clavier numérique, focus auto)
   → Catégorie (grille d'icônes, catégories récentes en premier)
   → [Valider]  ── champs secondaires (membre, note, justificatif, budget explicite) repliés par défaut
```
Cible : 3 interactions, quelques secondes (§41 respecté à la lettre). Si la catégorie correspond à un `VariableBudget` actif, la dépense y est rattachée automatiquement (RG-023) sans étape supplémentaire ; sinon `AdHocExpense`.

### I.3 Confirmation d'une échéance à sa date (§7)

```
Notification / "Actions à traiter" : "Électricité ~900 DH — à confirmer"
   → Ouvre le détail de la Deadline → 4 actions :
        [Marquer payée]   → montant réel (préremplie = estimé, modifiable) + date + moyen + justificatif
        [Pas encore]       → reste en `à_payer`/`en_retard`, rappel reprogrammé
        [Modifier]         → édite montant/date prévue (avant échéance)
        [Reporter]         → nouvelle date, historisée
        [Annuler]          → archivage motivé
```

### I.4 Paiement anticipé (§7, exemple paiement le 7 pour échéance le 10)

```
Depuis la liste des échéances → ouvrir Deadline (statut à_venir, pas encore à_payer)
   → [Marquer payée] disponible à tout moment (pas seulement à la date d'échéance)
   → saisie montant réel + date réelle → statut passe directement à `payée`
```

### I.5 Paiement partiel (§9)

```
Deadline "École 10 000 DH" → [Enregistrer un paiement]
   → 6 000 DH le [date] → statut = partiellement_payée, reste affiché = 4 000 DH
   → (plus tard) [Enregistrer un paiement] → 4 000 DH → [Marquer soldée] → statut = payée
```

### I.6 Confirmation de revenu (§4)

```
J (date habituelle du salaire) : notification "Salaire Adil 18 000 DH reçu ?"
   → [Oui, montant conforme] → reçu
   → [Montant différent] → saisie du montant réel → reçu (écart calculé et affiché)
   → [Pas encore] → reste prévu, passera en retard après délai de grâce
```

### I.7 Versement d'épargne/provision (§10)

```
Rappel mensuel : "Versement épargne Wael 1 000 DH effectué ?"
   → [Confirmer] → PocketMovement confirmé, solde de la poche mis à jour
   → [Pas ce mois-ci] → reste prévu / passe en retard
```

### I.8 Créer un objectif et voir le plan de financement (§13)

```
"+" → Objectif → nom, prix cible, date souhaitée (optionnelle), priorité
   → Écran plan de financement :
        curseur "versement mensuel" → recalcul en direct de la date d'atteinte
        + recommandation système : "Capacité réaliste actuelle : 650 DH/mois → atteint en 23 mois"
   → [Enregistrer le plan] (crée les GoalContribution futures planifiées, jamais réelles)
```

### I.9 Simulateur "Puis-je me le permettre ?" (§14)

```
Simulateur → Achat (nom, montant, date souhaitée optionnelle)
   → Calcul (G.11) → Verdict + explication en langage clair + graphique de la trajectoire de trésorerie
        avec/sans l'achat
   → [Enregistrer ce scénario] (optionnel, SimulationScenario) ou [Transformer en objectif]
   → Aucune donnée réelle modifiée tant que l'utilisateur ne clique pas "Transformer en objectif"
     (qui, elle, ne crée qu'un Goal en_cours — toujours pas d'écriture financière réelle, RG-000)
```

### I.10 Traiter la liste "Actions à traiter" (§28)

```
Onglet dédié (ou section du Dashboard) → liste triée par urgence :
   retards d'abord, puis échéances à payer proches, puis confirmations de revenu,
   puis budgets proches de la limite, puis suggestions (budget appris, provision insuffisante)
   → chaque item ouvre directement l'action correspondante (pas de navigation intermédiaire)
```

### I.11 Consultation multi-utilisateur / résolution de conflit (§42, H-01)

```
Lamiaa confirme une échéance pendant qu'Adil a la fiche ouverte
   → Adil reçoit une mise à jour en temps quasi-réel (ou au retour au premier plan)
   → si Adil tente de confirmer après coup : message "Déjà confirmée par Lamiaa le [heure]" + détail,
     pas d'écrasement silencieux
```

---

## J. Structure des écrans

### J.1 Challenge de la liste §49

La liste brute du cahier des charges compte 28 écrans. Certains sont naturellement des **onglets d'un même écran à tiroirs** plutôt que des pages séparées, pour respecter §40 ("ne pas créer 50 écrans complexes") et §51 (pas pénible à utiliser). Fusions proposées :

| Écrans §49 fusionnés | Devient |
|---|---|
| f. Ajouter dépense, i. Ajouter revenu, l. (ajout échéance), t. (ajout objectif), r. (transfert épargne) | **Une seule feuille modale "+"** à typologie sélectionnable en première étape (§40 le demande déjà — je le formalise comme LE point d'entrée de toute saisie) |
| j. Charges récurrentes + k. Détail charge | **Un écran liste + détail** (pattern maître-détail standard, pas deux écrans indépendants dans l'arborescence) |
| l. Échéances + m. Calendrier | **Une vue Calendrier avec bascule Liste/Calendrier** du même jeu de données (évite la duplication d'écran pour la même information sous deux formes) |
| r. Épargne + s. Provision | **Un onglet "Épargne & Provisions"** avec deux sections clairement typées (mais jamais mélangées dans les calculs, cf. §11) — la distinction conceptuelle reste, la distinction d'écran non |
| o. Membres du foyer + p. Enfant + q. Scolarité enfant | **Un écran "Foyer"** : liste des membres/enfants → fiche enfant → onglet scolarité *dans* la fiche enfant (pas 3 écrans séparés) |
| v. Notifications + w. Actions à traiter | **Fusion partielle** : "Actions à traiter" est l'écran actionnable (liste des décisions en attente) ; "Notifications" devient l'historique des alertes déjà émises, accessible en un tap depuis Actions à traiter — pas deux points d'entrée de navigation principale |
| y. Documents | Pas d'écran dédié en V1 : les justificatifs se consultent **depuis** l'échéance/dépense qui les porte (cf. C.6 Attachment) ; un écran "Tous les documents" (recherche transverse) devient une fonctionnalité V2 |
| z. Paramètres, aa. Sécurité, ab. Gestion foyer | **Un écran "Plus / Paramètres"** avec sous-sections (déjà suggéré par la nav §40 : "Plus") |

### J.2 Navigation principale (5 zones, conforme §40)

```
┌─────────────────────────────────────────────────────────┐
│                        Dashboard                          │  ← Accueil
│  (trésorerie, disponible, actions à traiter, alertes)      │
├─────────────────────────────────────────────────────────┤
│ [Accueil] [Transactions] [ (+) ] [Calendrier] [Épargne] [Plus] │
└─────────────────────────────────────────────────────────┘
```

- **Accueil** — Dashboard (J.3)
- **Transactions** — vue `LedgerEntry` (dépenses, revenus, paiements) avec recherche/filtres (§32)
- **(+)** — bouton flottant central, feuille modale de saisie rapide (dépense / revenu / échéance / objectif / transfert épargne)
- **Calendrier** — vue calendrier + liste des échéances, bascule d'affichage
- **Épargne** — poches + provisions + objectifs (3 sections d'un même onglet)
- **Plus** — Foyer & membres, Enfants/Scolarité, Budgets variables, Simulateur, Historique/Audit, Notifications, Paramètres/Sécurité

### J.3 Dashboard — contenu (§27)

Ordre d'affichage, du plus urgent au plus informatif :
1. **Bandeau trésorerie** : Trésorerie déclarée / Disponible immédiat (G.4) / Engagée / Réservée — avec info-bulle explicative (§5 "explicité dans l'UX")
2. **Actions à traiter** (top 3, avec lien "voir tout")
3. **Prochaines échéances** (7 prochains jours)
4. **Ce mois** : prévu / réalisé / restant, par grande masse (revenus, charges, épargne)
5. **Épargne & objectifs** : progression synthétique
6. **À anticiper** : alerte qualitative sur le(s) mois suivant(s) (ex. §17 "Novembre plus chargé de 31 %")

### J.4 Écran final retenu (liste consolidée, ~16 écrans/zones de navigation)

1. Splash
2. Connexion / Inscription
3. Créer ou rejoindre un foyer
4. Onboarding financier
5. **Dashboard** (Accueil)
6. **Transactions** (liste + filtres, §32)
7. Feuille "+" (saisie rapide, multi-type)
8. **Charges & échéances** (liste maître-détail, inclut charges fixes + planifiées + ponctuelles)
9. **Calendrier** (bascule liste/calendrier)
10. **Budgets variables** (suivi consommé/restant/rythme)
11. **Épargne & Provisions & Objectifs** (3 sections)
12. **Simulateur** ("puis-je" + scénarios "et si")
13. **Foyer** (membres, droits, enfants → fiche enfant → scolarité)
14. **Actions à traiter** (+ accès Notifications/historique des alertes)
15. **Historique / Audit**
16. **Paramètres** (profil, sécurité/PIN/biométrie, gestion foyer, sauvegarde/export, marge de sécurité, priorités)

Chaque justificatif/document reste rattaché contextuellement (pas d'écran 17 "Documents" en V1, cf. J.1).
