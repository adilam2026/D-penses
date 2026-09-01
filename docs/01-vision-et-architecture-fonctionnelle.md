# 01 — Synthèse produit & architecture fonctionnelle (V2)

> Couvre les points A, B, M, N. **V2** : vocabulaire de trésorerie clarifié en deux projections distinctes (physique / capacité libre), introduction des comptes financiers comme brique de base. Voir document 02 pour les définitions normatives complètes.

---

## A. Synthèse du produit

### A.1 – A.2 Ce que ce produit n'est pas / le principe fondateur
Inchangés (cf. V1) : pas un tracker de dépenses ; séparation stricte Prévu / Réel (RG-000).

### A.3 Trésorerie : deux moteurs distincts, pas un solde unique *(révisé V2)*

La V1 posait déjà une trésorerie « en couches » ; l'expérience de modélisation a montré qu'il fallait aller plus loin et séparer **deux projections indépendantes**, jamais fusionnées en un seul chiffre :

```
PROJECTION DE TRÉSORERIE PHYSIQUE            PROJECTION DE CAPACITÉ LIBRE
(les vrais flux d'argent, rien d'autre)       (ce qui reste réellement mobilisable)

Solde physique par compte                     Trésorerie opérationnelle
   + revenus reçus/attendus                       − Montants réservés (épargne/provisions virtuelles)
   − paiements réels                               − Montants engagés (échéances ouvertes, budgets restants)
   − dépenses réelles                              − Marge de sécurité
   ± transferts réels entre comptes              = Disponible libre
= Trésorerie opérationnelle (projetée)
```

Une **affectation virtuelle** d'épargne ou de provision ne fait *jamais* baisser un solde bancaire — elle ne vit que dans la seconde colonne. Un **transfert réel** entre comptes déplace de l'argent dans la première colonne mais a un impact net foyer nul. C'est cette séparation, formalisée dans le document 02 (G.1-G.6), qui rend le modèle financièrement incontestable : à tout instant, on peut répondre séparément à « combien avons-nous physiquement ? » et « combien pouvons-nous engager sans nous mettre en danger ? ».

**Patrimoine liquide total** (tous les comptes, y compris l'épargne adossée à un compte dédié) reste une troisième notion, distincte des deux précédentes — utile pour une vue patrimoniale globale, mais jamais utilisée pour décider d'une dépense courante (cf. document 02, RG-081/G.2).

### A.4 Le temps est continu, pas mensuel
Inchangé — le moteur raisonne jour par jour ; démontré chiffres en main dans le document 06.

### A.5 – A.6 Positionnement et utilisateurs
Inchangés.

---

## B. Architecture fonctionnelle

### B.1 Quatre piliers empilés
Inchangé (Suivre / Anticiper / Alerter / Conseiller), avec une précision : la couche « Suivre » repose désormais explicitement sur les **comptes financiers** comme brique de base — toute écriture réelle (revenu reçu, paiement, dépense, transfert, ajustement) référence un compte, ce qui rend le solde de trésorerie recalculable à tout instant plutôt que déclaré une fois pour toutes (document 02, RG-080).

### B.2 Modules fonctionnels — ajout
| Module (nouveau) | Rôle | Alimente |
|---|---|---|
| **Comptes** | Lieux physiques de l'argent, rapprochement bancaire, transferts internes | Trésorerie physique, toutes les projections |

Les autres modules (Revenus, Charges & échéances, Paiements, Épargne, Provisions, Objectifs, Budget scolaire, Abonnements, Moteur de projection, Moteur d'alerte, Simulateur, Historique/audit) restent inchangés dans leur rôle, avec les corrections de calcul détaillées au document 02.

### B.3 – B.4 Flux de données de référence, « Actions à traiter »
Inchangés dans leur principe. Le flux de référence intègre désormais le rapprochement comme point d'entrée additionnel :
```
Rapprochement bancaire (déclaration d'un solde réel)
        │
        ▼
Écart détecté ? ──oui──► Reconciliation.pending ──► action utilisateur (jamais automatique)
        │
        non
        ▼
Nouveau point d'ancrage (AccountBalanceSnapshot) → solde_courant recalculé à partir de là
```

---

## M. Incohérences — état V2

Les incohérences INC-01 à INC-10 identifiées en V1 restent documentées pour mémoire (traçabilité de la conception) ; leur statut est désormais :

| # | Statut V2 |
|---|---|
| INC-01 (deux horizons mélangés) | **Résolu** — remplacé par les deux projections physique/capacité libre (A.3, document 02 G.5-G.6), plus précis que la simple distinction « immédiat/glissant » de la V1. |
| INC-02 (réservée ≠ argent séparé) | **Résolu et formalisé** — `allocation_mode` (`virtual_allocation`/`backed_by_account`), garantie anti-double-comptage RG-072/IF-06. |
| INC-03 (charge fixe vs. planifiée) | Résolu (V1), inchangé. |
| INC-04 (scolaire/abonnements en vues filtrées) | Résolu (V1), inchangé. |
| INC-05 (pas d'entité Transaction générique) | Résolu (V1), renforcé par `LedgerEntry` (document 02 C.6, point 16 des remarques). |
| INC-06 (paiement partiel → clôture) | Résolu (V1), renforcé par `reste_a_payer` généralisé (RG-016). |
| INC-07 (suggestion ignorée) | Résolu (V1), inchangé. |
| INC-08 (arbitrage à priorité égale) | Résolu (V1), inchangé. |
| INC-09 (fréquence personnalisée → RRULE) | Résolu (V1), inchangé. |
| INC-10 (suppression logique vs. RGPD) | Résolu (V1), étendu par RG-064 (corrections d'opérations réelles). |

**Nouvelles clarifications V2** (corrections de modélisation propre, pas des incohérences du cahier des charges initial — documentées en détail au document 02) : modèle de statuts des échéances scindé financier/temporel (E.10), calcul des engagements indépendant du statut UX (RG-050), calcul temporel de suffisance des provisions (RG-032bis), correction de la contradiction sur les remboursements (RG-015).

---

## N. Recommandations — ajouts V2

Les recommandations REC-01 à REC-09 (V1) restent valides. S'y ajoutent :

- **REC-10** — Ne jamais afficher un seul « chiffre magique » de trésorerie sur le dashboard : toujours au moins deux nombres côte à côte (Trésorerie opérationnelle / Disponible libre), avec une explication en un tap. Un utilisateur presse verra vite lequel regarder selon son besoin (« puis-je payer ceci maintenant » vs. « puis-je me permettre ceci »).
- **REC-11** — Garder la notion de compte totalement invisible pour un foyer qui ne veut gérer qu'un seul compte global. Le modèle multi-comptes doit être une capacité, jamais une contrainte de saisie (cf. §23 des remarques, document 03 §I.1/RG-095).
- **REC-12** — Documenter le calcul temporel de suffisance des provisions (RG-032bis) comme *le* mécanisme de référence dès que plusieurs échéances sont liées à une même provision — la formule naïve (reste global / mois restants) reste correcte uniquement dans le cas à échéance unique, et doit être présentée comme un cas particulier, jamais comme la règle générale.
