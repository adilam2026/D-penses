# Application financière familiale — Analyse fonctionnelle et architecture

Ce dossier constitue le **livrable d'analyse préalable au développement**, tel que demandé dans le cahier des charges : aucune ligne de code applicative n'est écrite à ce stade. L'objectif est de fixer un modèle métier solide, non ambigu, avant toute implémentation.

## Philosophie retenue

Ce n'est pas un tracker de dépenses. C'est un outil de pilotage de trésorerie familiale, structuré autour d'une règle unique et non négociable : **une donnée prévisionnelle ne devient jamais automatiquement une donnée réelle** — toute confirmation (revenu reçu, échéance payée, versement d'épargne effectué) exige un geste humain explicite. Le système calcule, anticipe, alerte et recommande ; il n'agit jamais seul sur l'argent réel.

## Sommaire des documents

| Document | Contenu | Points du livrable couverts |
|---|---|---|
| [`01-vision-et-architecture-fonctionnelle.md`](./01-vision-et-architecture-fonctionnelle.md) | Synthèse produit, architecture fonctionnelle en couches, incohérences du cahier des charges et reformulations, recommandations d'amélioration | A, B, M, N |
| [`02-modele-metier.md`](./02-modele-metier.md) | Entités métier, modèle relationnel, règles de gestion numérotées (RG-xxx), statuts et transitions, formules de calcul de référence, cas limites | C, D, E, F, G, H |
| [`03-parcours-et-ecrans.md`](./03-parcours-et-ecrans.md) | Parcours utilisateurs clés (saisie rapide, confirmation d'échéance, simulateur, arbitrage), structure d'écrans challengée et consolidée, navigation | I, J |
| [`04-architecture-technique-et-donnees.md`](./04-architecture-technique-et-donnees.md) | Stack technique recommandée, schéma de données (tables), stratégie notifications, offline/synchronisation, sécurité | O, P, Q, R, S |
| [`05-roadmap-et-risques.md`](./05-roadmap-et-risques.md) | Périmètre V1/V2/V3, risques fonctionnels et techniques avec mitigations, plan de développement par lots livrables | K, L, T |

## Comment lire ce dossier

1. Commencer par le document 01 pour la vision d'ensemble et comprendre **pourquoi** certains choix de modélisation ont été faits (notamment les fusions d'entités du document 02, motivées par les incohérences identifiées en §M).
2. Le document 02 est la **référence normative** : toute règle de gestion (RG-xxx) ou formule (G.x) citée ailleurs dans le produit doit pointer vers ce document, jamais être redéfinie localement.
3. Le document 03 traduit ce modèle en expérience utilisateur concrète.
4. Le document 04 traduit le tout en architecture technique implémentable.
5. Le document 05 séquence le développement et liste ce qui reste volontairement hors périmètre.

## Points d'arbitrage nécessitant une validation explicite avant développement

Ces sujets ont été tranchés par une proposition raisonnée mais méritent une confirmation ou un ajustement de votre part avant le premier lot de code (cf. document 05, Lot 0) :

1. **Fusion des charges fixes/planifiées/scolaires/abonnements** en une seule famille d'entités (`ChargePlan`/`Deadline`) avec des vues filtrées par écran (document 01, INC-03/INC-04 ; document 02, C.3). Recommandé pour éviter la duplication de règles, mais impacte directement le modèle de données du document 04.
2. **Deux métriques de disponible** ("Disponible maintenant" vs. projection glissante) plutôt qu'un chiffre unique "réellement libre" (document 01, INC-01/REC-02 ; document 02, G.4/G.5).
3. **Nature du fléchage épargne/provision** (logique sur le même compte vs. compte réellement séparé) à clarifier dans l'onboarding et affichée à l'utilisateur (document 01, INC-02).
4. **Découpage des écrans** proposé (16 zones au lieu de 28), avec fusions par pattern maître-détail et feuilles modales (document 03, J.1).
5. **Portée exacte du offline V1** (consultation complète + saisie en file simple, résolution de conflits avancée repoussée en V2) (document 05, K ; document 04, R.1).

Merci de valider ou d'amender ces points avant que le premier lot de développement ne démarre.
