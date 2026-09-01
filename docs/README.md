# Application financière familiale — Analyse fonctionnelle et architecture (V2.1)

Ce dossier constitue le **livrable d'analyse préalable au développement**. Aucune ligne de code applicative n'est écrite à ce stade.

**V2.1** corrige un double comptage résiduel entre une provision déjà constituée et l'échéance qu'elle finance (nouvelle notion `engagement_non_couvert`, document 02 §E.5ter, formule G.4), ajoute le paiement atomique « avec la provision » (§E.5quater), corrige un bug de signe dans la vue `LedgerEntry` (document 04 §P.2), clarifie le budget hebdomadaire sur des semaines calendaires réelles (RG-098/RG-099), et met à jour le test oracle chiffré (document 06) en conséquence — dates calendaires corrigées, checkpoints recalculés, deux nouveaux cas de preuve (provision virtuelle et provision adossée à un compte).

## Philosophie retenue (inchangée)

Ce n'est pas un tracker de dépenses. C'est un outil de pilotage de trésorerie familiale, structuré autour d'une règle unique et non négociable : **une donnée prévisionnelle ne devient jamais automatiquement une donnée réelle**. Le système calcule, anticipe, alerte et recommande ; il n'agit jamais seul sur l'argent réel.

## Ce qui change en V2

La V1 posait les bonnes fondations (ChargePlan/Deadline/Payment, séparation prévu/réel, simulateur, Actions à traiter, moteur déterministe) mais s'appuyait sur une notion de trésorerie trop directe. La V2 introduit une vraie couche **comptes financiers**, sépare formellement **trésorerie physique** et **capacité libre**, rend le double comptage épargne/provision impossible par construction, et corrige plusieurs formules qui dépendaient à tort de statuts d'affichage plutôt que de l'état financier réel. Le détail complet est donné dans la synthèse remise en fin d'échange.

## Sommaire des documents

| Document | Contenu | Points couverts |
|---|---|---|
| [`01-vision-et-architecture-fonctionnelle.md`](./01-vision-et-architecture-fonctionnelle.md) | Synthèse produit, deux projections de trésorerie, état des incohérences, recommandations | A, B, M, N |
| [`02-modele-metier.md`](./02-modele-metier.md) | **Document normatif.** Entités (dont comptes financiers), modèle relationnel, règles de gestion, statuts (financier/temporel), formules de calcul, cas limites, **Invariants financiers** | C, D, E, F, G, H |
| [`03-parcours-et-ecrans.md`](./03-parcours-et-ecrans.md) | Parcours utilisateurs (dont rapprochement, transferts, simulateur enrichi), structure d'écrans | I, J |
| [`04-architecture-technique-et-donnees.md`](./04-architecture-technique-et-donnees.md) | Stack technique, schéma de données complet (comptes, rapprochement, transferts), notifications, offline, sécurité | O, P, Q, R, S |
| [`05-roadmap-et-risques.md`](./05-roadmap-et-risques.md) | V1/V2/V3, risques (dont nouveaux risques V2), plan par lots **avec tests de calcul obligatoires** | K, L, T |
| [`06-simulation-financiere-de-reference.md`](./06-simulation-financiere-de-reference.md) | **Test oracle chiffré** — foyer fictif complet, journal d'événements, trou de trésorerie prouvé, calcul de provision temporel prouvé, simulateur d'achat, preuves anti-double-comptage, vérification des invariants | Validation chiffrée |

## Comment lire ce dossier

1. Document 01 pour la vision d'ensemble et le vocabulaire (Trésorerie opérationnelle / Disponible libre / Patrimoine liquide total — jamais redéfinis ailleurs).
2. Document 02 est la **référence normative absolue** — toute règle (RG-xxx), tout statut, toute formule (G.x) ou invariant (IF-xxx) cité ailleurs doit y renvoyer.
3. Document 03 traduit le modèle en parcours et écrans, en gardant la saisie courante aussi simple qu'en V1 malgré la richesse du modèle sous-jacent.
4. Document 04 traduit le tout en schéma de données et choix techniques implémentables.
5. Document 05 séquence le développement, avec des tests de calcul obligatoires à chaque lot.
6. Document 06 prouve, chiffres à l'appui sur un cas réaliste, que le modèle ne double-compte jamais et détecte correctement les tensions de trésorerie.

## Points d'arbitrage nécessitant encore une validation

Voir la synthèse remise à l'issue de la V2, section « décisions nécessitant votre validation ».
