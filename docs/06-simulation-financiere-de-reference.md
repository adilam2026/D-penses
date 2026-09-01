# 06 — Simulation financière de référence (V2.2)

> **V2.2** ajoute §10-§11 (mini-cas scolaire et tests des nouvelles capacités : facturation différée, montants inconnus/estimés, charges optionnelles, plan financier générique, charges communes à plusieurs enfants). Le scénario 90 jours (§0-§9) n'est pas retouché.


> Document de validation fonctionnelle chiffrée (points 18 à 20 de la revue V2, corrigé en V2.1 pour la couverture provision/échéance, les dates calendaires et le budget hebdomadaire). Sert de **test oracle** pour le développement futur. Foyer et personnages fictifs, construits pour ce test uniquement.
>
> **Corrections V2.1 apportées à ce document** : couverture chronologique provision → échéance appliquée partout où elle s'applique (§3.1, §3.2, §5, nouveaux Cas F/G en §8) ; démonstration du paiement atomique « avec la provision » (§5, jour 75) ; table de correspondance jour ↔ date et correction des libellés de date erronés (§0bis) ; budget courses recalculé sur des semaines calendaires réelles plutôt qu'un taux journalier appliqué à une fenêtre arbitraire (§3.2/§3.3) ; correction de la phrase sur la trésorerie de fin septembre (§3, ce n'est pas une hausse) ; simulateur recalculé en conséquence (§7).

---

## 0. Objectif
Inchangé : prouver, chiffres à l'appui, que le modèle (1) détecte un trou de trésorerie intra-mois, (2) propage `reste_a_payer` correctement, (3) ne compte jamais un dirham deux fois — **y compris désormais entre une provision et l'échéance qu'elle finance**, (4) calcule une recommandation de provision qui respecte chaque échéance intermédiaire, (5) produit un verdict de simulateur nuancé.

### 0bis. Table de correspondance jour ↔ date *(nouveau V2.1)*

Convention unique et désormais strictement appliquée : **jour 0 = 1er septembre**, un lundi (jour de référence de la semaine budgétaire, `week_start_day = lundi`). `Date(jour n) = 1er septembre + n jours`. Septembre compte 30 jours (jours 0-29), octobre 31 jours (jours 30-60), novembre 30 jours (jours 61-90), décembre 31 jours (jours 91-121).

| Jour | Date | Jour | Date | Jour | Date |
|---|---|---|---|---|---|
| 0 | 1 sept (lun.) | 45 | 16 oct | 75 | 15 nov |
| 14 | 15 sept | 54 | 25 oct | 78 | 18 nov |
| 22 | 23 sept | 57 | 28 oct | 85 | 25 nov |
| 29 | 30 sept | 65 | 5 nov | 88 | 28 nov |
| 34 | 5 oct | 70 | 10 nov | 90 | 30 nov |
| 39 | 10 oct | 72 | 12 nov | 119 | 29 déc |
| 42 | 13 oct | | | 136 | 15 janv |

---

## 1. Foyer de référence — état initial (1er septembre, jour 0)
Inchangé — voir tableaux détaillés : comptes (ACC-1 Nabil 22 000, ACC-2 Salma 15 000, ACC-3 Épargne enfants 30 000 non-opérationnel, ACC-4 Espèces 2 000 ; patrimoine 69 000, trésorerie opérationnelle 39 000), revenus (salaires 18 000/12 000, prime 5 000), charges fixes (crédit 4 500/j5, internet 399/j10, téléphone 250/j12, électricité estimée 900/j18), scolarité liée à la Provision Scolarité (D-S1 20 000/15 sept, D-S2 2 000/30 sept, D-S3 20 000/15 nov, D-S4 6 000/15 janv), budget courses 1 500 DH/**semaine calendaire** (lundi→dimanche), épargne (Or Nabil 4 000 virtuel, Épargne Enfants 30 000 adossée à ACC-3), Provision Scolarité 9 000 initiale, objectif PC 15 000 DH, marge de sécurité 10 000 DH.

---

## 2. Journal chronologique des événements

| J | Date | Événement | Impact compte |
|---|---|---|---|
| 0 | 1 sept | **a-f.** Création foyer, comptes, revenus, échéances, budget, poches | — |
| 2 | 3 sept | **o.** Courses — légumes | ACC-1 −100 |
| 3 | 4 sept | **o.** Courses — supermarché | ACC-1 −600 |
| 4 | 5 sept | **o.** Courses — boucherie | ACC-1 −300 |
| 5 | 6 sept | Crédit logement (à échéance) | ACC-1 −4 500 |
| 7 | 8 sept | **g.** Paiement anticipé électricité · **h.** montant réel 847 DH (≠ estimé 900) | ACC-2 −847 |
| 9 | 10 sept | Internet + **o.** courses supermarché | ACC-1 −399, −550 |
| 11 | 12 sept | Téléphone à échéance — **q. non payée** (reste ouverte) | — |
| 14 | 15 sept | **i.** D-S1 (20 000 DH) — 1ᵉʳ paiement partiel 15 551 DH | ACC-1 −15 551 (→ 0) |
| 15 | 16 sept | Retrait espèces 500 DH (ACC-2 → ACC-4) | ACC-2 −500, ACC-4 +500 |
| 16 | 17 sept | **o.** Courses — légumes (cash) | ACC-4 −120 |
| 18 | 19 sept | **j.** D-S1 — 2ᵉ paiement, solde l'échéance (4 449 DH) | ACC-2 −4 449 |
| 20 | 21 sept | **k / m.** Versement épargne enfants sept. confirmé — transfert réel | ACC-2 −2 000, ACC-3 +2 000 |
| 22 | 23 sept | **o.** Courses — supermarché | ACC-2 −480 |
| 24 | 25 sept | Salaire Nabil reçu (exact) | ACC-1 +18 000 |
| 25 | 26 sept | **n.** Affectation virtuelle +3 000 DH à la Provision Scolarité (aucun mouvement bancaire) | provision 9 000→12 000 |
| 27 | 28 sept | **r.** Salaire Salma prévu 12 000, reçu réel 12 350 | ACC-2 +12 350 |
| 29 | 30 sept | D-S2 payée (2 000 DH) · **p.** rapprochement ACC-2, écart −250 DH → ajustement enregistré | ACC-1 −2 000 ; ACC-2 −250 |

*(Événement **l** observé mi-octobre, statut « prévu ». Événements **s/t** — simulateur — traités en §7.)*

---

## 3. Trajectoire de septembre — preuve du trou de trésorerie (RG-051)

**Trésorerie opérationnelle** = ACC-1 + ACC-2 + ACC-4 (ACC-3 exclu).

| Jour | Événement | Trésorerie opérationnelle |
|---|---|---|
| 0 | Départ | 39 000 |
| 2-4 | Courses (−1 000 cumulé) | 38 000 |
| 5 | Crédit logement | 33 500 |
| 7 | Électricité (847) | 32 653 |
| 9 | Internet + courses | 31 704 |
| 14 | D-S1 — 1ᵉʳ paiement (−15 551) | 16 153 |
| 16 | Courses | 16 033 |
| 18 | D-S1 — 2ᵉ paiement (−4 449) | 11 584 |
| 20 | Transfert épargne enfants (sort du périmètre opérationnel) | 9 584 |
| **22** | **Courses (−480) → POINT BAS** | **9 104** |
| 24 | Salaire Nabil (+18 000) | 27 104 |
| 27 | Salaire Salma (+12 350) | 39 454 |
| 29 | D-S2 (−2 000) + ajustement rapprochement (−250) | **37 204** |

**Point bas = 9 104 DH le jour 22 (23 septembre)**, soit **896 DH sous la marge de sécurité (10 000 DH)**. Septembre se termine à **37 204 DH, en léger retrait par rapport au départ (39 000 DH, −1 796 DH, −4,6 %)** — ce n'est pas une hausse : le mois a absorbé une échéance scolaire lourde (20 000 DH) tout juste compensée par les deux salaires ; ce qui importe est que le mois reste sain dans l'ensemble malgré la tension du 20-24 septembre détectée par RG-051, qu'un raisonnement mensuel global aurait masquée.

### 3.1 Checkpoint complet — jour 16 (pendant le paiement partiel, avant couverture par provision)

- `reste_a_payer(D-S1)` = 20 000 − 15 551 = **4 449 DH** (état financier `partiellement_payée`).
- **Couverture par la Provision Scolarité** (RG-090, provision = 9 000 DH, échéances liées non soldées triées par date : D-S1 due 15 sept en premier, puis D-S2 due 30 sept, puis D-S3, D-S4) : `couverture_affectée(D-S1) = MIN(4 449, 9 000) = 4 449` → **`engagement_non_couvert(D-S1) = 0`**. Il reste `9 000 − 4 449 = 4 551 DH` de provision disponible, qui couvre ensuite intégralement D-S2 (2 000 DH) → `engagement_non_couvert(D-S2) = 0` également.
- **Montants engagés** (horizon H\* = jour 45, prime) : seules les charges **non liées à la provision** y entrent — téléphone sept (250) + téléphone oct (250, due jour 42) + crédit oct (4 500, due jour 34) + internet oct (399, due jour 39) = **5 399 DH**. Ni les 4 449 DH restant dus sur D-S1, ni les 2 000 DH de D-S2, n'y figurent : ils sont déjà couverts par les 9 000 DH que `Montants_réservés` retient par ailleurs.
- **Preuve directe des points 1 et 5 des remarques** : le moteur ne compte jamais deux fois le même argent — ni le montant initial de D-S1 (20 000, déjà exclu par `reste_a_payer`), ni son reste dû une fois que la provision le couvre (exclu par `engagement_non_couvert`).

### 3.2 Checkpoint complet — jour 22 (point bas)

- Trésorerie opérationnelle = 9 104 DH
- Montants réservés = Or Nabil (4 000) + Provision Scolarité (9 000, avant l'affectation du jour 25) = **13 000 DH** *(inchangé — la provision est toujours comptée en entier ici, cf. RG-092)*
- Couverture (D-S1 déjà soldée depuis le jour 18, sort du calcul) : disponible_provision = 9 000 → D-S2 (reste 2 000, due jour 29) : `couverture = MIN(2 000, 9 000) = 2 000` → `engagement_non_couvert(D-S2) = 0`.
- Montants engagés (H\*=jour 45) = téléphone sept (250) + téléphone oct (250) + crédit oct (4 500) + internet oct (399) + D-S2 (engagement non couvert = **0**) + **budget courses restant** (voir ci-dessous) = 5 399 + budget.
- **Budget courses restant, calculé sur des semaines calendaires réelles (RG-098)**, fenêtre [jour 22, jour 45] : reste de la semaine en cours S4 (jours 21-27 ; consommé à date 480 DH sur 2 jours écoulés, rythme projeté = (480/2)×7 = 1 680, budget contractuel restant = 1 500−480 = 1 020, `prudent_max` = **1 200** pour les 5 jours restants de S4) + semaine S5 complète (jours 28-34) = 1 500 + semaine S6 complète (jours 35-41) = 1 500 + semaine S7 partielle (jours 42-45, 4 jours sur 7) = 1 500×4/7 ≈ 857. **Total = 1 200+1 500+1 500+857 = 5 057 DH.**
- **Montants engagés = 5 399 + 5 057 = 10 456 DH**
- **Disponible libre** = 9 104 − 13 000 − 10 456 − 10 000 = **−24 352 DH**

Ce chiffre très négatif signale correctement qu'aucune dépense discrétionnaire ne devrait être engagée à ce moment, alors même que le compte n'est pas à découvert — la différence entre trésorerie physique et capacité libre (document 01, A.3).

### 3.3 Checkpoint complet — jour 29 (fin septembre, post-rapprochement)

- Trésorerie opérationnelle = **37 204 DH**
- Montants réservés = Or Nabil (4 000) + Provision Scolarité (12 000, après affectation du jour 25) = **16 000 DH**
- Couverture : D-S1 et D-S2 sont soldées, sorties du calcul. Aucune échéance liée à la provision ne tombe dans l'horizon [jour 29, jour 45] (D-S3 et D-S4 sont bien au-delà). Montants engagés = téléphone sept (250) + téléphone oct (250) + crédit oct (4 500) + internet oct (399) = 5 399, inchangé par la couverture.
- **Budget courses restant** [jour 29, jour 45] : reste de S5 (jours 30-34, 5 jours, semaine tout juste commencée le 28, rien consommé encore → prudent_max = budget contractuel = 1 500) + S6 complète (1 500) + S7 partielle (jours 42-45, 4/7) ≈ 857. **Total = 1 500+1 500+857 = 3 857 DH.**
- **Montants engagés = 5 399 + 3 857 = 9 256 DH**
- **Disponible libre** = 37 204 − 16 000 − 9 256 − 10 000 = **1 948 DH**

---

## 4. Provision Scolarité — calcul temporel de suffisance (RG-032bis)

État au jour 29 : `current_amount` = 12 000 DH. Échéances encore liées et non soldées : D-S3 (20 000, jour 75) et D-S4 (6 000, jour 136).

| i | Échéance | reste_a_payer (rᵢ) | Besoin cumulé Rᵢ | Mois restants | Taux requis |
|---|---|---|---|---|---|
| 1 | D-S3 (jour 75) | 20 000 | 20 000 | 46j ≈ 1,53 mois | (20 000−12 000)/1,53 = **5 229 DH/mois** |
| 2 | D-S4 (jour 136) | 6 000 | 26 000 | 107j ≈ 3,57 mois | (26 000−12 000)/3,57 = 3 922 DH/mois |

**Versement mensuel recommandé = max(5 229 ; 3 922) = 5 229 DH/mois**, arrondi à 5 200 DH/mois.

> **Note de cohérence (V2.1)** — Ce calcul (RG-032bis, prospectif : combien verser chaque mois pour éviter un manque futur) et la couverture chronologique de §3.1/3.2 (RG-090, instantané : combien du solde actuel de la provision couvre déjà chaque échéance) utilisent la même mécanique. Le « gap » `R_i − current_amount` de ce tableau (8 000 DH pour D-S3) est exactement `engagement_non_couvert(D-S3)` au jour 29 — les deux notions sont les deux faces d'un même calcul, jamais en contradiction.

**Preuve que le calcul naïf sous-provisionnerait** : une approche « reste global / mois restants total » donnerait `(26 000−12 000)/3,57 = 3 922 DH/mois`. À ce rythme, au jour 75 (D-S3), la provision contiendrait `12 000 + 3 922×1,53 ≈ 18 001 DH` — 1 999 DH de moins que les 20 000 DH requis. Le calcul par palier (RG-032bis) l'évite.

---

## 5. Octobre – Novembre — projection agrégée, avec paiement de D-S3 via la provision

**Octobre** (jour 29 → jour 60) : + salaires (18 000 le 25 oct, jour 54 + 12 000 le 28 oct, jour 57) + prime (5 000, jour 45/16 oct) − crédit (4 500, jour 34/5 oct) − internet (399, jour 39/10 oct) − téléphone ×2 (250+250, dont le retard de septembre enfin réglé) − électricité (880 réel, jour 47/18 oct) − courses (≈6 429, un mois complet de semaines) − transfert épargne enfants (2 000) = **+20 292 DH**.
→ Trésorerie opérationnelle jour 60 = 37 204 + 20 292 = **57 496 DH**. Aucun point bas sous la marge (minimum estimé ≈ 32 000 DH avant la prime et les salaires).

**Novembre** (jour 60 → jour 90) — **paiement de D-S3 via la provision (RG-095/RG-096, point 4 des remarques)** au jour 75 (15 nov) : la Provision Scolarité contient alors 17 000 DH (12 000 + 5 000 versés en octobre, conformément à la recommandation §4). L'utilisateur confirme « Marquer comme payée » → « Source du paiement ? » → répartition **17 000 DH depuis la Provision Scolarité + 3 000 DH depuis le compte courant**, en une seule confirmation. Atomiquement : deux `Payment` sont créés sur D-S3 (17 000 `funding_source=provision`, 3 000 `funding_source=compte`), un `PocketMovement` de retrait de 17 000 DH est créé sur la provision (12 000+5 000−17 000 = **0**), D-S3 passe `soldée`.

Flux du mois : + salaires (18 000 le 25 nov, jour 85 + 12 000 le 28 nov, jour 88) − crédit (4 500, jour 65/5 nov) − internet (399, jour 70/10 nov) − téléphone (250, jour 72/12 nov) − électricité (880, jour 78/18 nov) − courses (≈6 429) − transfert épargne enfants (2 000) − **D-S3 (20 000 au total, dont 17 000 « depuis » la provision et 3 000 depuis le compte — impact réel sur la trésorerie opérationnelle : −20 000 dans tous les cas, la provision étant virtuelle et non un compte séparé)** = **−4 458 DH**.
→ Trésorerie opérationnelle jour 90 = 57 496 − 4 458 = **53 038 DH**.

**Point bas de novembre** (jour 75, juste après D-S3, avant les salaires de fin de mois) ≈ **26 918 DH** (calcul identique à la V2 — la mécanique de financement de D-S3 via la provision ne change rien au flux de trésorerie réel, seulement à la comptabilité des réserves, cf. ci-dessous). Confortablement au-dessus de la marge — aucune alerte RG-051 ce mois-ci.

### Checkpoint complet — jour 75 *(corrigé V2.1 — la provision est désormais correctement consommée)*
- Trésorerie opérationnelle = 26 918 DH
- Montants réservés = Or Nabil (4 000) + **Provision Scolarité (0, intégralement consommée pour payer D-S3)** = **4 000 DH** *(V2 avait, à tort, laissé la provision à 21 000 DH sans jamais la décrémenter malgré le paiement de D-S3 — double comptage exactement du type dénoncé au point 1 des remarques, désormais corrigé)*
- Montants engagés (horizon → jour 85, salaire Nabil) : D-S4 (due jour 136) hors horizon, exclue. Électricité nov restante (0, déjà payée par cette date) + budget courses restant (≈3 000, approximation pour les ~14 jours restants de novembre, méthode simplifiée pour cette projection agrégée — cf. note ci-dessous) = **≈ 3 880 DH**
- **Disponible libre** = 26 918 − 4 000 − 3 880 − 10 000 = **9 038 DH**
- **Capacité disponible brute** (avant marge, cf. §7) = 9 038 + 10 000 = **19 038 DH**

> Note méthodologique : contrairement aux checkpoints de septembre (§3.2/3.3, semaines calendaires exactes), le budget restant d'octobre/novembre/décembre reste ici approximé par un taux journalier moyen (correct en agrégat mensuel, cf. §6, mais approximatif sur une fenêtre d'horizon non alignée aux semaines) — suffisant pour cette projection à but illustratif, sans reprendre le détail semaine par semaine déjà démontré en septembre.

### Checkpoint complet — jour 90 (fin novembre)
Provision : reçoit une nouvelle contribution confirmée de **3 000 DH** (repart de 0 après le jour 75) → `current_amount` = 3 000, destinée à D-S4 (6 000, jour 136).
- Trésorerie opérationnelle = 53 038 DH
- Montants réservés = Or Nabil (4 000) + Provision (3 000) = **7 000 DH**
- Montants engagés (horizon → jour ≈114, salaire Nabil décembre) : D-S4 hors horizon (due 136), exclue de toute façon. Charges fixes de décembre (≈6 029) + budget restant (≈5 143, approximation) = **≈ 11 172 DH**
- **Disponible libre** = 53 038 − 7 000 − 11 172 − 10 000 = **24 866 DH**
- **Capacité disponible brute** = 34 866 DH

### Checkpoint extrapolé — jour 119 (~29 décembre)
Provision : +3 000 DH supplémentaires → `current_amount` = 6 000, couvrant désormais intégralement D-S4 (6 000).
- Trésorerie opérationnelle ≈ 68 580 DH (extrapolation, flux récurrents de décembre similaires à octobre)
- Montants réservés = 4 000 + 6 000 = **10 000 DH**
- Montants engagés ≈ **11 172 DH** (pattern récurrent, approximation)
- **Disponible libre** ≈ 37 408 DH
- **Capacité disponible brute** ≈ **47 408 DH**

---

## 6. Projections 7 / 30 / 60 / 90 jours (référence : jour 29, 30 septembre)

*(Table inchangée par la V2.1 — ces valeurs sont des soldes de trésorerie opérationnelle purs, non affectés par la correction de couverture provision/échéance.)*

| Horizon | Jour cible | Trésorerie opérationnelle | Point bas de la fenêtre | Alerte RG-051 |
|---|---|---|---|---|
| 7 jours | 36 | 32 704 (après crédit oct.) | 32 704 | non |
| 30 jours | 60 | 57 496 | ≈ 32 000 | non |
| 60 jours | 90 | 53 038 | 26 918 (jour 75) | non |
| 90 jours | 119 | ≈ 68 580 (extrapolé) | 26 918 (jour 75) | non |

*(Le point bas de la fenêtre complète depuis le jour 0 reste le jour 22 = 9 104 DH, déjà sous la marge — cf. §3.)*

---

## 7. Simulateur — achat du PC (15 000 DH) *(recalculé V2.1)*

**Capacité disponible brute** (= Disponible libre + Marge de sécurité) aux dates clés, avec les valeurs corrigées :

| Date | Jour | Capacité disponible brute (V2, erronée) | Capacité disponible brute (V2.1, corrigée) |
|---|---|---|---|
| 30 septembre (aujourd'hui) | 29 | 12 376 | **11 948** *(léger ajustement, correction du budget hebdomadaire)* |
| 15 novembre (après paiement D-S3) | 75 | 2 038 | **19 038** *(provision correctement consommée, non double-comptée)* |
| 30 novembre | 90 | 15 866 | **34 866** |
| 29 décembre (extrapolé) | 119 | 26 408 | **47 408** |

La correction du double comptage provision/échéance change significativement le diagnostic : la V2 laissait croire à une tension artificielle en novembre (la provision restait comptée comme réservée après avoir servi à payer D-S3), la V2.1 montre une trajectoire nettement plus favorable, sans faux creux.

### s. Achat simulé « aujourd'hui » (30 septembre, jour 29)
```
Capacité_avec_achat(t) = Capacité_brute(t) − 15 000
Point bas sur [29,119] = 11 948 (au jour 29 lui-même — la trajectoire est désormais croissante, plus de creux en novembre)
Capacité_avec_achat(29) = 11 948 − 15 000 = −3 052
```
**Verdict : non compatible actuellement**, mais de peu (−3 052 DH, contre −12 962 DH en V2) — l'écart à combler est nettement plus faible qu'estimé précédemment.

### t. Comparaison de plusieurs dates d'achat
- **15 novembre (jour 75, juste après le paiement de D-S3)** : capacité après achat = 19 038 − 15 000 = **4 038 DH** (≥ 0, techniquement possible) ; marge vs. coussin = 4 038 − 10 000 = **−5 962 DH** → **possible mais risqué**.
- **30 novembre (jour 90)** : capacité après achat = 34 866 − 15 000 = **19 866 DH** ; marge vs. coussin = 19 866 − 10 000 = **+9 866 DH** → **possible maintenant**, confortable.
- Par interpolation entre le 15 et le 30 novembre (progression ≈ 1 055 DH/jour), la marge repasse positive vers le **21 novembre** environ.

**Message produit généré** :
> « Achat techniquement possible dès le 15 novembre, une fois l'échéance scolaire de novembre réglée via votre provision — mais avec seulement 4 038 DH de marge après achat, en dessous de votre coussin de sécurité de 10 000 DH. Autour du 21 novembre, la marge redevient confortable ; le 30 novembre offre une marge nettement plus large (+9 866 DH au-dessus du coussin). »

- **Impact sur les provisions** : la Provision Scolarité, déjà consommée pour D-S3, continue de se reconstituer pour D-S4 indépendamment de cet achat.
- **Impact sur l'épargne protégée** : aucun — Or Nabil et Épargne Enfants ne sont jamais inclus dans `Capacité_disponible_brute`.
- **Objectifs concurrents** : aucun autre `Goal` actif.

---

## 8. Preuves anti-double-comptage

Cas A à E (V2, inchangés — non affectés par les corrections V2.1) : provision logique n'affecte jamais un solde de compte (Cas A) ; transfert réel conserve le patrimoine total (Cas B) ; `reste_a_payer` seul entre dans les engagements (Cas C) ; le consommé d'un budget variable n'est jamais reprojeté (Cas D) ; tout transfert interne a un impact net foyer nul (Cas E).

### Cas F — Provision virtuelle ↔ échéance *(nouveau V2.1, exemple didactique indépendant du scénario)*

```
Trésorerie opérationnelle = 50 000 DH
Provision (virtual_allocation) déjà constituée = 12 000 DH
Échéance liée, reste_a_payer = 20 000 DH
Marge de sécurité = 10 000 DH
```
**Calcul erroné (V2)** : `50 000 − 12 000(réservé) − 20 000(engagé, brut) − 10 000(marge) = 8 000 DH` — les 12 000 DH de provision sont retirés une première fois via `Montants_réservés`, puis les 20 000 DH complets de l'échéance (dont ces mêmes 12 000 DH font partie) sont retirés une seconde fois via `Montants_engagés`.

**Calcul correct (V2.1)** : `couverture_affectée = MIN(20 000, 12 000) = 12 000` → `engagement_non_couvert = 20 000 − 12 000 = 8 000`.
```
Disponible libre = 50 000 − 12 000(réservé, inchangé) − 8 000(engagement non couvert) − 10 000(marge) = 20 000 DH
```
Vérification : `réservé(12 000) + engagement_non_couvert(8 000) = 20 000 = reste_a_payer` exactement (IF-16) — les 12 000 DH ne sont jamais comptés deux fois, et l'intégralité du besoin (20 000 DH) reste bien couverte par la somme des deux termes.

### Cas G — Provision adossée à un compte (`backed_by_account`) ↔ échéance *(nouveau V2.1)*

```
Compte opérationnel = 30 000 DH
Compte école dédié (protégé, non opérationnel) = 15 000 DH
Provision école (backed_by_account, linked_account = compte école) = 15 000 DH (lecture du solde du compte)
Échéance école, reste_a_payer = 15 000 DH
```
`Montants_réservés` ne compte **pas** cette provision (déjà exclue, RG-072 — son compte dédié est hors périmètre opérationnel). Couverture (RG-090) : `couverture_affectée = MIN(15 000, 15 000) = 15 000` → `engagement_non_couvert = 0`.
```
Disponible libre = 30 000 − 0(réservé, provision backed exclue) − 0(engagement non couvert) − Marge = 30 000 − Marge
```
Les 15 000 DH du compte école ne sont **jamais redemandés** à la trésorerie opérationnelle : ils sont déjà hors périmètre (exclusion du compte) et couvrent intégralement l'échéance (coverage), sans jamais apparaître une seconde fois nulle part.

### Cas H — Signe des mouvements dans `LedgerEntry` *(nouveau V2.1)*
Le paiement du crédit logement (jour 5, ACC-1) apparaît dans `LedgerEntry` comme **`-4 500`** (sortie du compte payeur), jamais `+4 500` — cohérent avec la trajectoire de trésorerie opérationnelle du §3 (22 000 → 16 500 après ce paiement, dans la séquence complète). Cf. document 04 §P.2 pour le test de régression associé (10 000 → 9 000, pas 11 000).

---

## 9. Vérification des invariants financiers

| Invariant | Statut sur ce scénario |
|---|---|
| IF-01 à IF-15 | ✓ — inchangés, vérifiés comme en V2 (rien de réel sans confirmation, patrimoine = Σ soldes, transferts internes neutres, `reste_a_payer` ≥ 0, anti-double-comptage compte/poche, soldes de poches dérivés de leurs mouvements, engagements indépendants du statut temporel, pas de double comptage budget variable, un compte = une poche adossée) |
| **IF-16** (couverture + non couvert = reste_a_payer) | ✓ — Cas F (12 000+8 000=20 000), Cas G (15 000+0=15 000), §3.1 (4 449+0=4 449 pour D-S1 une fois couvert) |
| **IF-17** (une unité de provision ne couvre pas deux échéances) | ✓ — §3.1/3.2 : la provision de 9 000 DH se répartit strictement séquentiellement entre D-S1 puis D-S2, jamais les deux simultanément au-delà du solde disponible |
| **IF-18** (affectation chronologique par défaut) | ✓ — D-S1 (due 15 sept) toujours couverte avant D-S2 (due 30 sept) elle-même avant D-S3 (due 15 nov) |
| **IF-19** (paiement + retrait de provision atomiques) | ✓ — §5, jour 75 : le paiement de D-S3 (17 000 DH depuis la provision) crée en une seule transaction le `Payment` et le `PocketMovement` de retrait, ramenant la provision à 0 |
| **IF-20** (signe `Payment` dans `LedgerEntry`) | ✓ — Cas H |

Ce jeu de données et ces résultats constituent le test oracle de référence — toute divergence de l'implémentation future avec les valeurs ci-dessus doit être traitée comme un bug.

**Invariants V2.2 (données manquantes, options, plan financier, charges communes)** :

| Invariant | Statut sur le mini-cas §10 |
|---|---|
| IF-21 (confirmation de montant → recalcul immédiat) | ✓ — §10, Scolarité T2 : 20 000 → 21 300, `reste_a_payer`/projections recalculés au même instant (TEST 2, §11) |
| IF-22 (`intention_label` hors formule) | ✓ — §10, contribution « préparation T2 » : aucune formule ne la lit (TEST 8, §11) |
| IF-23 (aucun agrégat de `FinancialPlan` stocké) | ✓ — le Budget connu du plan « École 2026/2027 » (§10) est recalculé à chaque lecture depuis les `ChargePlan`/`Deadline` liés |
| IF-24 (`inconnu` ≠ 0, jamais omis) | ✓ — Restauration T2 : exclue de la somme, mais listée explicitement dans les « éléments inconnus » (§10, TEST 3) |
| IF-25 (option envisagée hors Dépenses certaines) | ✓ — Garderie Ines : dans « Options envisagées » (2 500 DH), jamais dans « Dépenses certaines » (§10, TEST 4) |
| IF-26 (charge commune = un seul Payment réel) | ✓ — TEST 6, §11 |
| IF-27 (incertitude signalée, jamais silencieuse) | ✓ — TEST 7, §11 |

---

## 10. Mini-cas scolaire — `FinancialPlan` « École 2026/2027 » (V2.2)

Vient compléter le foyer de référence (§1) : Yanis et Ines ont chacun leurs frais scolaires regroupés dans un `FinancialPlan` unique, lié à la `Provision Scolarité` déjà existante (§1.7). Ce mini-cas ne redémarre pas la simulation 90 jours — c'est un jeu de données autonome, à la même date de référence (aujourd'hui = jour 29, 30 septembre).

### 10.1 Charges du plan

| Charge | Enfant(s) | Montant | `amount_status` | `obligation_status` | `expected_billing_date` | `due_date` |
|---|---|---|---|---|---|---|
| Scolarité T1 | Yanis | 20 000 DH | confirmé | obligatoire | 14 sept (reçue) | 30 sept |
| Scolarité T2 | Yanis | 21 300 DH *(initialement estimé 20 000)* | confirmé *(après facture)* | obligatoire | 12 janv | 28 janv |
| Scolarité T3 | Yanis | 14 500 DH | estimé | obligatoire | — | 15 avril |
| Restauration T1 | Yanis | 1 800 DH | confirmé (forfait trimestriel réel, **pas** un calcul par repas) | obligatoire | — | 30 sept |
| Restauration T2 | Yanis | **inconnu** (forfait pas encore communiqué par l'établissement) | inconnu | obligatoire | 5 janv | 28 janv |
| Assurance continuité scolaire | Yanis | 1 575 DH | confirmé | **optionnelle_souscrite** (décision prise) | — | 30 sept |
| Uniforme | Yanis / Ines | 600 DH / 500 DH | confirmé | obligatoire | — | 15 sept |
| Fournitures | Yanis / Ines | 400 DH / 350 DH | confirmé | obligatoire | — | 15 sept |
| Garderie | Ines | 250 DH/mois | confirmé (le tarif est connu) | **optionnelle_envisagée** (utilisation pas encore décidée) | — | mensuel |
| Sorties scolaires *(charge commune)* | Yanis + Ines | 1 000 DH *(un seul règlement)* | confirmé | obligatoire | — | 20 oct |

Scolarité Yanis : 20 000 + 21 300 + 14 500 = **54 500 DH/an**, conforme au montant annuel global connu dès le départ, dont la ventilation T1/T2/T3 s'est affinée avec le temps (§10.2, exactement le cas d'usage du point 2 des remarques).

### 10.2 Confirmation du montant T2 (TEST 2)
Au jour 29, Scolarité T2 est encore `estimé` à 20 000 DH. À réception de la facture (12 janvier, `billing_date` renseignée), l'utilisateur confirme un montant réel de **21 300 DH** : `amount_initial_estimated = 20 000` (conservé), `amount_current = 21 300`, `amount_status = confirmé`, `confirmed_at` horodaté. `reste_a_payer`, la couverture par la Provision Scolarité (RG-090) et toutes les projections en aval sont recalculés immédiatement sur 21 300 (IF-21) — jamais sur l'estimation initiale, jamais perdue pour autant.

### 10.3 Budget connu, options, inconnues (TEST 3, TEST 4, TEST 5)

```
Dépenses certaines connues (G.14) =
   20 000 (T1) + 21 300 (T2) + 14 500 (T3, estimé) + 1 800 (restauration T1)
   + 1 575 (assurance, optionnelle_souscrite → comptée, RG-108)
   + 600 + 500 (uniformes) + 400 + 350 (fournitures) + 1 000 (sorties communes)
   = 62 025 DH

Options envisagées connues = 250 × 10 mois (garderie Ines, année scolaire) = 2 500 DH   (jamais dans les 62 025 ci-dessus, IF-25)

Éléments inconnus = { Restauration T2 (Yanis) }                                          (jamais comptée 0, IF-24)

Complétude = contient_inconnues
```
**Affichage produit** : « Au moins **62 025 DH** de dépenses sont déjà identifiées pour École 2026/2027. + 2 500 DH d'options envisagées (garderie Ines). **Budget total : incomplet** — la restauration T2 de Yanis n'est pas encore chiffrée. »

Jamais : « Budget total = 62 025 DH » présenté comme définitif.

### 10.4 Charge commune Yanis + Ines (TEST 6, illustration dédiée)
```
Deadline « Réinscription groupée 2026/2027 » = 40 000 DH, bénéficiaires = {Yanis, Ines}
Payment réel = un seul enregistrement de 40 000 DH (un seul virement, une seule facture)
Ventilation analytique (deadline_child_allocation, informative) : Yanis 20 000 / Ines 20 000
```
La vue « Coûts » de la fiche Yanis affiche 20 000 DH pour cette ligne, celle d'Ines également — mais un seul `Payment` de 40 000 DH existe dans `LedgerEntry`, jamais deux (IF-26). Modifier ou supprimer la ventilation analytique ne touche jamais au montant réel payé.

### 10.5 Provision — affectation indicative (TEST 8)
Le foyer verse 833 DH/mois (≈10 000 DH/an) sur la Provision Scolarité, en étiquetant mentalement chaque versement : juillet-août → « préparation T1 », septembre-décembre → « préparation T2 », janvier-mars → « préparation T3 ». Le versement de septembre porte `intention_label = "préparation T2"`. Cette étiquette n'apparaît dans **aucune** formule (IF-22) : la couverture réelle de Scolarité T2 (21 300 DH) par la provision reste exclusivement déterminée par l'allocation chronologique de RG-090, appliquée à l'ensemble des échéances liées (Scolarité T1/T2/T3, Restauration T1 — Restauration T2 étant `inconnu`, elle n'entre dans aucun calcul de couverture tant qu'elle ne l'est pas, RG-103), quelle que soit l'intention affichée à l'utilisateur.

### 10.6 Simulateur avec incertitude (TEST 7)
Une simulation d'achat dont l'horizon d'analyse couvre le 28 janvier (due_date de Scolarité T2 et de la Restauration T2 encore inconnue) produit :
```
Verdict calculé normalement sur les 62 025 DH de dépenses certaines connues (Restauration T2 exclue des sommes, jamais à 0)
+ avertissement explicite :
  « Selon les dépenses actuellement renseignées, ce résultat est valable, mais le montant de la
     restauration scolaire T2 (Yanis) n'est pas encore connu et pourrait faire évoluer cette projection. »
```

---

## 11. Tests métier minimum ajoutés (V2.2)

| # | Test | Résultat attendu |
|---|---|---|
| 1 | `billing_date` = 12 janvier, `due_date` = 28 janvier (Scolarité T2, §10.1) | Facture attendue le 12 ; paiement exigible au plus tard le 28 ; aucune des deux dates ne déclenche un paiement automatique (RG-100). |
| 2 | Échéance estimée 20 000 → facture réelle 21 300 (§10.2) | `amount_initial_estimated` conservé à 20 000 ; projections recalculées immédiatement sur 21 300 (RG-104, IF-21). |
| 3 | Restauration T2 connue mais montant non communiqué (§10.1) | `amount_status = inconnu`, `amount_current = NULL` ; budget marqué incomplet ; jamais converti en 0 (RG-102/103, IF-24). |
| 4 | Garderie Ines 250 DH/mois, non souscrite (§10.1) | Visible comme option envisagée ; jamais comptée comme engagement ferme dans Montants engagés (RG-106, IF-25). |
| 5 | Assurance continuité Yanis, optionnelle souscrite (§10.1) | Devient un engagement certain, intégré aux Dépenses certaines et à Montants engagés au recalcul suivant (RG-108). |
| 6 | Charge de 40 000 DH concernant deux enfants (§10.4) | Un seul `Payment` réel de 40 000 DH ; ventilation analytique 20 000+20 000 informative uniquement ; aucun double comptage (RG-115/116, IF-26). |
| 7 | Simulateur avec restauration T2 non chiffrée (§10.6) | Verdict calculé sur les données connues, accompagné d'un avertissement explicite d'incomplétude (G.11, G.14, IF-27) — jamais une fausse certitude silencieuse. |
| 8 | Provision mensuelle étiquetée « préparation T2 » (§10.5) | Aucune seconde réservation financière créée par l'étiquette ; la couverture réelle reste exclusivement celle calculée par RG-090 (IF-22). |
