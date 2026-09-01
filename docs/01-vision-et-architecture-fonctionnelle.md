# 01 — Synthèse produit & architecture fonctionnelle

> Ce document couvre les points **A** (synthèse), **B** (architecture fonctionnelle), **M** (incohérences du cahier des charges) et **N** (améliorations recommandées) du livrable demandé. Voir `README.md` pour l'index complet.

---

## A. Synthèse du produit

### A.1 Ce que ce produit n'est pas

Ce n'est **pas** un tracker de dépenses. Un tracker répond à "où est passé mon argent ?". Ce produit répond à quatre questions orientées **futur et décision** :

1. Combien avons-nous **réellement** aujourd'hui (et pas seulement le solde brut du compte) ?
2. Qu'est-ce que nous **devons** payer prochainement ?
3. Où en serons-nous dans X jours/mois ?
4. Pouvons-nous **nous permettre** telle dépense sans fragiliser le foyer ?

### A.2 Le principe fondateur : séparation stricte Prévu / Engagé / Réalisé

Toute la solidité du produit repose sur une règle unique, déclinée partout : **une donnée prévisionnelle n'est jamais, automatiquement, une donnée réelle.** Un salaire "prévu" n'est pas un salaire "reçu" ; une échéance "à payer" n'est pas une dépense "payée" ; un versement d'épargne "planifié" n'est pas un versement "effectué". Rien ne bascule d'un état à l'autre sans confirmation humaine (cf. règle transverse §48 du cahier des charges, reprise en RG-000 dans le document 02).

C'est ce qui permet à l'application de **calculer un futur fiable** (parce que le prévisionnel est déclaratif et connu à l'avance) tout en gardant un **présent exact** (parce que le réalisé n'est jamais pollué par des suppositions).

### A.3 Le second principe : trésorerie multi-couches, pas un solde unique

Le foyer ne raisonne jamais sur un seul chiffre. Il raisonne sur quatre couches empilées :

```
Trésorerie déclarée   (ce qui est physiquement sur les comptes/espèces)
   − Engagée           (déjà "promis" : échéances à payer, reste de budgets variables)
   − Réservée           (épargne protégée + provisions)
   − Marge de sécurité  (coussin non touchable)
   = Argent réellement libre
```

Un point essentiel, absent du cahier des charges et que ce document clarifie (voir §M.1) : **"engagée" et "réservée" ne sont pas de l'argent stocké ailleurs.** Sauf compte d'épargne séparé déclaré comme tel, c'est le **même argent physique**, simplement **fléché logiquement**. Le produit doit donc afficher explicitement qu'il s'agit d'une comptabilité d'engagement (virtuelle), pas de comptes bancaires distincts — sous peine de faire croire au foyer qu'il a plus d'argent liquide qu'il n'en a réellement.

### A.4 Le troisième principe : le temps est continu, pas mensuel

Un mois globalement positif peut cacher un trou de trésorerie entre deux dates précises (ex. échéances le 15-18, salaire le 25). Le moteur de prévision doit raisonner **jour par jour**, pas "mois par mois", pour détecter ces tensions (cf. document 04, moteur de projection).

### A.5 Positionnement et philosophie

> *"Ne pas seulement montrer où l'argent est parti. Dire ce qui va arriver et aider à décider avant de dépenser."*

Le produit se positionne comme un **copilote de trésorerie familiale** : il suit, anticipe, alerte, conseille — jamais il n'agit seul sur l'argent réel. Toute automatisation reste dans le registre du calcul et de la recommandation (cf. RG-000).

### A.6 Utilisateurs cibles

- Un couple co-administrateur d'un foyer, avec économie partagée mais poches personnelles préservées (ex. "Or Lamiaa").
- Des enfants/personnes à charge, **objets** de gestion financière mais pas **sujets** applicatifs (pas de compte) en V1.
- Modèle de droits extensible dès la conception (admin / membre / lecture seule / futur enfant majeur), même si en V1 seul "admin" est réellement utilisé (couple = double admin).

---

## B. Architecture fonctionnelle

### B.1 Les quatre piliers fonctionnels

L'architecture fonctionnelle est organisée autour des 4 verbes du cahier des charges, qui dev4iennent 4 **couches de traitement** empilées sur un socle de données commun :

```
┌──────────────────────────────────────────────────────────────┐
│  4. CONSEILLER   → Moteur de recommandation / arbitrage       │
│     (capacité d'épargne, simulateur "puis-je", scénarios)     │
├──────────────────────────────────────────────────────────────┤
│  3. ALERTER      → Moteur de détection / notification         │
│     (échéances, dépassements, anomalies, oublis, trous)       │
├──────────────────────────────────────────────────────────────┤
│  2. ANTICIPER    → Moteur de projection                       │
│     (calendrier prévisionnel, projections 7j→12 mois)         │
├──────────────────────────────────────────────────────────────┤
│  1. SUIVRE       → Registre transactionnel                    │
│     (revenus, dépenses, échéances, épargne, provisions)       │
├──────────────────────────────────────────────────────────────┤
│  0. SOCLE        → Foyer, membres, catégories, sécurité       │
└──────────────────────────────────────────────────────────────┘
```

Chaque couche **consomme** la couche du dessous et **ne modifie jamais** les données réelles de saisie (le moteur de projection est un calcul en lecture seule ; le simulateur "et si" est strictement non-persistant sauf validation explicite).

### B.2 Modules fonctionnels

| Module | Rôle | Alimente |
|---|---|---|
| **Foyer & membres** | Identité, droits, enfants, foyer | tout le reste |
| **Revenus** | Revenus récurrents/ponctuels, confirmation de réception | Trésorerie, projection |
| **Charges & échéances** | Fixes récurrentes, planifiées (calendrier), variables budgétées, ponctuelles | Trésorerie engagée, projection, alertes |
| **Paiements** | Confirmation, paiement partiel, écart prévu/réel | Charges & échéances, historique |
| **Épargne** | Poches patrimoniales indépendantes, protégées/flexibles | Trésorerie réservée |
| **Provisions** | Réserves liées à des échéances futures connues | Trésorerie réservée, alertes |
| **Objectifs / projets** | Achats souhaités, plan de financement | Simulateur, arbitrage |
| **Budget scolaire** | Vue consolidée par enfant, réutilise Charges + rattachement enfant | Charges, dashboard famille |
| **Abonnements** | Vue consolidée des charges fixes récurrentes de type abonnement | Charges (spécialisation, pas duplication) |
| **Moteur de projection** | Calcul glissant du solde prévisionnel jour par jour | Dashboard, alertes, simulateur |
| **Moteur d'alerte** | Détection règles (retard, dépassement, anomalie, oubli, trou de trésorerie) | Notifications, "Actions à traiter" |
| **Simulateur** | "Puis-je me le permettre", scénarios "et si" | Aucune donnée réelle (lecture seule) |
| **Notifications** | Émission, agrégation, préférences | Utilisateur |
| **Historique / audit** | Traçabilité de toute modification | Conformité, confiance multi-utilisateur |
| **Documents** | Justificatifs attachés aux échéances/dépenses | Charges, historique |
| **Sécurité** | Auth, chiffrement, PIN/biométrie, déconnexion globale | Transverse |

### B.3 Flux de données de référence

```
Saisie utilisateur (dépense / revenu / échéance / versement)
        │
        ▼
  Registre "SUIVRE" (statut = prévu/planifié)
        │
        ├── à la date d'échéance ──► Demande de confirmation (jamais auto)
        │                                   │
        │                      ┌─────────────┼─────────────┐
        │                    payé        partiel        non payé
        │                      │              │              │
        │                      ▼              ▼              ▼
        │                réalisé        réalisé partiel   en retard
        │
        ▼
  Moteur de projection (relit en continu le registre)
        │
        ▼
  Moteur d'alerte  ──► Notifications + "Actions à traiter"
        │
        ▼
  Dashboard (vue consolidée, lecture)
```

### B.4 "Actions à traiter" comme colonne vertébrale UX

Le cahier des charges (section 28) place cet écran comme "très important". Architecturalement, ce n'est **pas une entité stockée** mais une **vue calculée** : agrégation en temps réel de tout ce qui, dans le registre, est dans un état "nécessite une décision humaine" (échéance à confirmer, revenu à confirmer, versement d'épargne à confirmer, budget presque dépassé, anomalie détectée). Cela évite un double stockage désynchronisable (cf. recommandation N.4).

---

## M. Incohérences et zones d'ambiguïté du cahier des charges

Numérotées **INC-xxx**, avec la reformulation proposée à chaque fois.

### INC-01 — La formule "argent réellement libre" (§5) mélange un instantané et une projection
Le cahier des charges définit une formule unique mais ses termes ("charges à payer avant prochaines rentrées", "budgets variables restants") sont implicitement bornés dans le temps, alors que d'autres sections (§17-18) demandent une projection glissante à plusieurs horizons (7j → 12 mois).
**Proposition** : distinguer explicitement deux métriques (détaillées avec formules exactes dans le document 02, §G) :
- **Disponible immédiat** — photo à date T, horizon = jusqu'à la prochaine rentrée d'argent significative.
- **Projection glissante** — série de soldes prévisionnels quotidiens sur N jours, dont le disponible immédiat est le premier point.

### INC-02 — "Trésorerie réservée" laisse croire à un argent physiquement séparé
Rien dans le cahier des charges ne précise si l'épargne/provision correspond à un compte bancaire distinct ou à un simple flag logique sur le même compte courant.
**Proposition** : modéliser un champ `mode_de_detention` (compte séparé déclaré vs. fléchage logique sur la trésorerie commune) par poche d'épargne/provision, et toujours afficher à l'utilisateur "ceci est un fléchage, pas un virement réel" tant que `mode_de_detention = logique`. Sinon, deux utilisateurs pourraient croire disposer deux fois du même argent.

### INC-03 — Confusion possible entre "Charge planifiée avec calendrier" (6.2) et "Charge fixe récurrente" (6.1)
La scolarité (échéances T1/T2/T3 à montants variables et dates propres) et l'internet (mensualité fixe récurrente) sont présentées comme deux familles distinctes, mais structurellement ce sont la même chose : un **plan de charge** (`ChargePlan`) qui génère des **occurrences/échéances** (`Deadline`). Seule la méthode de génération diffère (auto par fréquence vs. saisie manuelle du calendrier).
**Proposition** : une entité unique `RecurringCharge`/`ChargePlan` avec un attribut `mode_generation` (`auto_frequence` | `calendrier_manuel`), qui évite de dupliquer les règles de statut/paiement partiel/écart prévu-réel entre deux familles d'entités. Détail dans le document 02.

### INC-04 — Le module scolaire (§23) et les abonnements (§24) sont décrits comme des sous-systèmes autonomes
Si on les modélise comme des entités séparées avec leurs propres statuts, on duplique toute la mécanique de `ChargePlan`/`Deadline`/`Payment` déjà définie pour les charges. Cela crée un risque réel de divergence de règles (ex. un correctif de "paiement partiel" appliqué aux charges génériques mais oublié sur les charges scolaires).
**Proposition** : Scolarité et Abonnements sont des **vues filtrées** sur `RecurringCharge`/`Deadline` (filtre `catégorie = École` + `enfant_id`, resp. `catégorie = Abonnement` + `date_renouvellement`), pas des entités métier distinctes. Le "vrai sous-module" demandé existe au niveau **écran et requête**, pas au niveau **modèle de données**.

### INC-05 — Le mot "Transaction" est utilisé dans l'exemple d'entités (§50-C) alors que le corps du texte distingue Revenu / Dépense / Paiement / Versement d'épargne
Une entité `Transaction` générique risque de redevenir, de fait, "le tracker de dépenses" que le cahier des charges refuse explicitement (§ intro).
**Proposition** : ne pas créer d'entité `Transaction` fourre-tout. Chaque mouvement réel reste typé (`Payment`, `IncomeReceipt`, `SavingsMovement`, `Expense` ponctuelle). Une vue `LedgerEntry` unifiée (lecture seule, calculée) peut exister pour l'écran "Transactions" (§49-g), par simple UNION SQL/requête, sans devenir la source de vérité.

### INC-06 — Paiement partiel vs. statut de l'échéance parente : risque d'incohérence d'arrondi
Si `Deadline.montant_prevu = 10 000` et deux paiements de `6 000` + `4 000` sont saisis, il faut définir : le statut passe-t-il à "payée" automatiquement au moment où `Σ(paiements) ≥ montant_prevu`, ou seulement quand l'utilisateur clôture explicitement l'échéance (cas où le réel dépasse ou est inférieur au prévu) ?
**Proposition** (détaillée en RG-014/015, document 02) : passage automatique à "payée" quand `Σ(paiements) ≥ montant_prévu_ou_reestimé` **et** que l'utilisateur a confirmé le dernier paiement comme "solde final" — un simple cumul ne suffit pas car un montant peut être re-estimé en cours de route (§37).

### INC-07 — "Budget conseillé" (§20) et "action utilisateur requise partout" (§48) sont en tension
§20 propose un budget calculé automatiquement, §48 interdit toute action automatique sans consentement. Il n'y a pas de contradiction réelle (§20 dit bien "l'utilisateur accepte ou refuse") mais le cahier des charges ne précise pas ce qui se passe si l'utilisateur ignore la suggestion : le budget reste-t-il l'ancien indéfiniment ?
**Proposition** : toute suggestion (budget, provision mensuelle recommandée, arbitrage) reste **à l'état de suggestion non appliquée** tant qu'elle n'a pas été explicitement acceptée ; une suggestion ignorée expire silencieusement au recalcul suivant (pas de relance infinie, sinon fatigue de notification — cf. §51).

### INC-08 — Priorité des engagements (§15) : arbitrage automatique implicite
§15 donne un exemple : *"Reporter l'épargne PC plutôt que réduire la provision scolaire"* — c'est une **recommandation textuelle**, cohérente avec §48. Mais rien n'indique comment le moteur choisit entre deux objectifs de même priorité (ex. deux projets "Priorité 4").
**Proposition** : à priorité égale, trier par date cible la plus proche, puis par ordre de création (règle RG-041, document 02), et toujours présenter l'arbitrage comme **une proposition classée**, jamais un choix unique imposé.

### INC-09 — Fréquence "personnalisée" (§4) et prorata (§19) sous-spécifiés
"Fréquence personnalisée" pour un revenu et "budget par semaine converti en mois" (§19) nécessitent tous deux un moteur de calendrier récurrent robuste (RFC 5545-like), non détaillé dans le cahier des charges.
**Proposition** : adopter un modèle de récurrence à la RRULE (iCal) dès la V1 pour tous les objets récurrents (revenus, charges, budgets), plutôt que des enums figées — cf. document 04, choix techniques.

### INC-10 — Suppression logique (§35) vs. RGPD / droit à l'effacement (§45 "suppression de compte")
§35 interdit la suppression brutale des opérations financières ; §45 exige de pouvoir supprimer un compte/foyer. Ces deux règles coexistent mais doivent être hiérarchisées : l'archivage logique protège l'intégrité **tant que le foyer existe** ; la suppression de compte/foyer est une purge **définitive et volontaire** qui prime.
**Proposition** : deux mécanismes distincts et documentés séparément — `soft_delete` (réversible, courant) vs. `hard_delete_rgpd` (irréversible, déclenché uniquement par une procédure de suppression de compte avec double confirmation, cf. document 04 §S).

---

## N. Améliorations recommandées

**REC-01 — Un seul moteur de "plan de charge"** générique (INC-03/04) plutôt que trois sous-systèmes (charges fixes, charges planifiées, module scolaire/abonnements). Réduit drastiquement la surface de bugs et le coût de maintenance, sans rien retirer à l'expérience utilisateur (les écrans restent spécialisés et filtrés).

**REC-02 — Deux métriques de disponible, nommées explicitement dans l'UI** ("Disponible maintenant" vs. "Disponible fin de mois") plutôt qu'un unique nombre "réellement libre" qui mélangerait des horizons différents (INC-01). Réduit le risque d'incompréhension du chiffre le plus important de l'app.

**REC-03 — Historisation par événements plutôt que par simple diff avant/après.** Le cahier des charges (§29) demande ancienne/nouvelle valeur + auteur + date. Recommandation : modéliser l'AuditLog comme un **flux d'événements immuables** (event sourcing léger sur les entités financières sensibles) plutôt qu'un simple journal de diffs, ce qui permet de rejouer l'historique complet d'une échéance (prévu → modifié → payé partiellement → soldé) sans perte d'information, et facilite le mode hors-ligne (résolution de conflits par rejeu d'événements plutôt que par écrasement de valeur).

**REC-04 — "Actions à traiter" en vue calculée**, jamais en table stockée (cf. B.4), pour interdire par construction toute désynchronisation entre l'état réel des échéances et la liste des tâches.

**REC-05 — Poser une limite explicite à l'IA générative dès la V1** (le cahier des charges l'exclut déjà en §46, à raison) : toute la couche "Conseiller" doit être un moteur de règles déterministe et explicable (l'utilisateur doit toujours pouvoir voir *pourquoi* une recommandation est faite), pas un LLM en boîte noire sur des données financières sensibles. Cohérent avec §51 (ne pas complexifier inutilement, rester compréhensible).

**REC-06 — Fatigue de notification : agréger par défaut.** Le cahier des charges le demande déjà (§26 "notifications agrégées") ; recommandation additionnelle : définir une **fréquence maximale** de notifications par jour par foyer (paramétrable), avec priorisation (retard > dépassement > prévision > conseil), pour ne jamais spammer un couple qui utilise l'app quotidiennement.

**REC-07 — Le simulateur doit être un "bac à sable" persistant, pas juste un calcul volatile.** Le cahier des charges dit "sans modifier les vraies données" (§14) — recommandation : permettre de **sauvegarder un scénario** (nommé, horodaté) pour comparer plusieurs simulations dans le temps, sans jamais les injecter dans le registre réel. Utile pour "et si le salaire baisse ?" comparé à plusieurs mois d'intervalle.

**REC-08 — Seuils d'alerte et marge de sécurité recommandés, pas seulement déclarés.** §16 mentionne "l'application peut éventuellement proposer un niveau recommandé" — je le rends V1 (calcul simple : nombre de mois de charges fixes couvert) car c'est peu coûteux et à forte valeur perçue dès le premier lancement (onboarding financier, écran §49-e).

**REC-09 — Ne pas fusionner les enfants avec les "membres" du foyer dans le même modèle de droits.** Un enfant n'aura *jamais* de compte en V1 ; garder `Child` totalement séparé de `HouseholdMembership` (qui porte l'auth et les rôles) évite une modélisation prématurée du cas "enfant majeur" (§2) qui, en réalité, sera un **User** rattaché au foyer avec un rôle restreint, pas une évolution du type `Child`.
