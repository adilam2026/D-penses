# 05 — Roadmap, risques, plan de développement

> Couvre les points **K** (V1/V2/V3), **L** (risques), **T** (plan de développement par lots).

---

## K. Fonctionnalités par version

### V1 — Cœur du produit (cf. §46, "le cœur V1 doit parfaitement gérer")

- Foyer multi-utilisateur (2 admins), enfants sans compte
- Revenus (récurrents/ponctuels) avec confirmation prévu→reçu
- Charges unifiées (`ChargePlan`/`Deadline`) : fixes récurrentes, planifiées à calendrier manuel, ponctuelles — statuts complets, paiement partiel, écart prévu/réel, justificatifs
- Budgets variables avec prorata correct (RG-022) et suivi rythme
- Épargne (poches multiples, protégée/flexible) + Provisions liées aux échéances, avec confirmation prévu→confirmé
- Objectifs/projets avec plan de financement et capacité réaliste
- Moteur de projection glissante (7j → 12 mois) et détection des trous de trésorerie intra-mois
- Moteur d'alerte : retard, dépassement de budget, anomalie simple (moyenne historique), charge oubliée
- Simulateur "Puis-je me le permettre ?" (lecture seule, sans persistance obligatoire)
- Module scolaire et Abonnements comme **vues filtrées** (pas d'entités dupliquées)
- Calendrier financier, écran "Actions à traiter"
- Notifications (échéances, agrégées, budget, prévision), paramétrables
- Historique/audit complet, suppression logique uniquement
- Sécurité : auth, PIN/biométrie, déconnexion multi-appareils, isolation stricte des foyers
- Sauvegarde cloud, export CSV/PDF basique
- Consultation offline complète + saisie offline en file d'attente simple (sans résolution de conflit avancée)

### V2 — Approfondissement

- Résolution de conflits offline avancée (event replay complet, R.2/R.3)
- Scénarios "et si ?" sauvegardés et comparables entre eux, avec impact affiché sur 30/90/365 jours (§39 au-delà du strict "puis-je")
- Suggestions de budget apprises sur historique long (§20) avec plus de finesse (saisonnalité)
- Détection d'anomalies plus fine (double paiement, hausse de prix abonnement, §21/§24)
- Confidentialité fine sur les poches d'épargne personnelles entre co-admins (§S.5)
- Multi-foyer par utilisateur (familles recomposées, RG-001 assoupli)
- Écran "Documents" transverse avec recherche sur justificatifs
- Rôle "enfant majeur avec compte" (RG-004, User distinct relié à l'historique Child)
- Export PDF enrichi (rapports mensuels/annuels par enfant, par catégorie)
- Notifications email (résumé hebdomadaire)

### V3 — Extensions

- Multi-devise (H-07)
- Import bancaire (relevé CSV/OFX en import assisté — pas de connexion bancaire live, cohérent avec la prudence du §46) pour accélérer la saisie sans devenir un agrégateur bancaire
- Partage/export d'un budget scolaire enfant vers l'autre parent hors foyer (garde alternée, cas non couvert par le cahier des charges actuel — à valider avec l'utilisateur avant de l'engager)
- Tableaux de bord comparatifs multi-mois avancés / rapports annuels automatisés
- API/Webhooks pour intégrations tierces (comptable familial, etc.)

**Ce qui reste explicitement hors périmètre à toute version tant que non redemandé** (§46) : connexion bancaire automatique live, OCR, IA générative, trading/investissement, comptabilité professionnelle, fiscalité.

---

## L. Risques fonctionnels et techniques

### L.1 Risques fonctionnels

| Risque | Impact | Mitigation |
|---|---|---|
| **Confusion prévu/réel malgré tout** (l'utilisateur clique vite, ne lit pas) | Chiffres faux perçus comme fiables → perte de confiance dans l'app | UI qui distingue visuellement (couleur, libellé) systématiquement "prévu" vs "réel" partout, jamais un même style pour les deux (cf. RG-000) |
| **Fatigue de saisie de confirmation** (couple qui ignore les confirmations pendant des semaines) | Projections de plus en plus fausses, `Actions à traiter` qui s'accumule et devient anxiogène | Agrégation (Q.1), délai de grâce avant `en_retard`, jamais de blocage de l'app tant que non confirmé (§51) |
| **Double comptage épargne/provision** si l'utilisateur crée manuellement les deux pour le même besoin | Le "réellement libre" affiché est trop bas, décision d'achat erronée | Documentation produit + garde-fou UI (avertissement à la création d'une provision si une poche similaire existe déjà pour le même enfant/catégorie) |
| **Sous-estimation du prorata budget variable si mal comprise par l'utilisateur** | Décalage entre budget affiché et ressenti utilisateur | Toujours afficher le calcul en clair ("1 500 DH/semaine ≈ 6 429 DH ce mois-ci (30 jours)") plutôt qu'un chiffre opaque |
| **Priorité mal comprise par les deux membres du couple** (désaccord sur ce qui est "obligatoire") | Conflits de priorité dans l'arbitrage, recommandations perçues comme illégitimes | Les priorités restent modifiables et visibles à deux, tracées en audit (qui a changé quoi) |

### L.2 Risques techniques

| Risque | Impact | Mitigation |
|---|---|---|
| **Dérive de calcul entre client et serveur** si la logique est dupliquée | Deux téléphones affichant des chiffres différents pour la même donnée | Source de vérité unique côté serveur (O.4), client = pur affichage |
| **Performance du calcul de projection glissante** (recalcul jour par jour sur 12 mois à chaque ouverture) | Latence perçue, dashboard lent | Calcul incrémental/caché à TTL court (quelques minutes) invalidé à toute écriture financière, pas de recalcul complet synchrone à chaque écran |
| **Conflits offline mal gérés** | Perte silencieuse d'une confirmation de paiement (grave, argent réel) | Jamais d'écrasement silencieux (R.3), toute perte potentielle repasse par `Actions à traiter` |
| **Fuite de données entre foyers** (bug d'isolation) | Violation de confidentialité financière grave | Défense en profondeur : filtre applicatif + Row-Level Security base (S.2) |
| **Complexité de la RRULE (récurrence)** sous-estimée en développement | Bugs sur fréquences personnalisées, dates de génération d'échéances incorrectes | Utiliser une librairie RRULE éprouvée plutôt qu'un moteur de dates maison |
| **Croissance non maîtrisée du modèle** (ajout d'entités dupliquées type "SchoolCharge" par convenance de développement) | Retour au piège identifié en INC-04, dette technique | Revue de conception obligatoire avant toute nouvelle entité "spécialisée" — vérifier d'abord si une vue filtrée suffit |

---

## T. Plan de développement par lots

> Découpage pensé pour livrer un produit **utilisable en continu** (chaque lot est démontrable), pas un big-bang. Un lot = un incrément fonctionnel cohérent.

### Lot 0 — Socle
Auth, Household, HouseholdMembership, Child, Category, isolation multi-foyer, sécurité de base (S.1-S.3), navigation à vide.

### Lot 1 — Suivre (revenus & charges de base)
IncomeSource/IncomeOccurrence, ChargePlan/Deadline (mode `auto_frequence` d'abord), Payment, confirmation prévu→réel (RG-000 à RG-020), écran Transactions, saisie rapide "+".

### Lot 2 — Budgets variables & dépenses ponctuelles
VariableBudget + prorata (RG-022), BudgetExpense, AdHocExpense, rythme de consommation (RG-024).

### Lot 3 — Charges planifiées & module scolaire/abonnements (vues)
`ChargePlan` mode `calendrier_manuel`, paiements partiels (RG-014), fiche enfant + vue scolaire filtrée, vue abonnements filtrée, justificatifs (Attachment).

### Lot 4 — Trésorerie & dashboard
Formules G.1-G.4 (disponible immédiat), Dashboard v1, écran Calendrier financier.

### Lot 5 — Épargne, provisions, objectifs
SavingsPocket, Provision (liée aux Deadline), PocketMovement, Goal/GoalContribution, formules G.8-G.10, priorités (E.7).

### Lot 6 — Moteur de projection & alertes
Projection glissante (G.5), détection trous de trésorerie (RG-051), alertes retard/dépassement/oubli/anomalie (RG-052/053), écran "Actions à traiter" (vue calculée), notifications (Q).

### Lot 7 — Simulateur & scénarios
"Puis-je me le permettre" (G.11), coussin de sécurité (G.12), sauvegarde de scénario simple.

### Lot 8 — Historique, audit, robustesse multi-utilisateur
AuditEvent complet (REC-03), synchronisation temps quasi-réel, gestion de conflits H-01/R.3.

### Lot 9 — Offline V1
Cache local lecture complète + file d'écriture simple (R.1-R.2).

### Lot 10 — Sauvegarde, export, finitions sécurité
Export CSV/PDF, suppression de compte/foyer (S.6), déconnexion multi-appareils, durcissement sécurité avant mise en production.

**Dépendances critiques** : Lot 4 (trésorerie) dépend des Lots 1-2 ; Lot 6 (projection/alertes) dépend de Lot 4 + Lot 5 (provisions) ; Lot 7 (simulateur) dépend de Lot 6. Les Lots 3, 8 et 9 peuvent être partiellement parallélisés une fois le Lot 1 stabilisé.
