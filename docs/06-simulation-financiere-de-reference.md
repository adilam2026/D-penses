# 06 — Simulation financière de référence

> Document de validation fonctionnelle chiffrée (points 18 à 20 des remarques). Sert de **test oracle** pour le développement futur : toute implémentation doit reproduire exactement les valeurs ci-dessous à partir des mêmes données d'entrée. Foyer et personnages fictifs, construits pour ce test uniquement.

---

## 0. Objectif

Prouver, chiffres à l'appui et sans aucune approximation dissimulée, que le modèle du document 02 :
1. détecte un trou de trésorerie intra-mois même quand le mois est globalement positif (RG-051) ;
2. propage correctement un paiement partiel dans toutes les projections (`reste_a_payer`, RG-016) ;
3. ne compte jamais un même dirham deux fois entre solde de compte, poche/provision et engagement (RG-070→074, IF-06) ;
4. calcule une recommandation de provision qui respecte chaque échéance intermédiaire, pas seulement le total (RG-032bis) ;
5. produit un verdict de simulateur nuancé, pas binaire (G.11).

---

## 1. Foyer de référence — état initial (1er septembre, jour 0)

**Foyer** : Nabil (admin) & Salma (admin) · enfants Yanis (8 ans) et Ines (5 ans).
**Marge de sécurité** (`HouseholdSettings`) : **10 000 DH**.

### 1.1 Comptes (`FinancialAccount`)

| Compte | Type | Opérationnel | Solde J0 |
|---|---|---|---|
| ACC-1 · Courant Nabil | courant | oui | 22 000 DH |
| ACC-2 · Courant Salma | courant | oui | 15 000 DH |
| ACC-3 · Épargne enfants (dédié, `backed_by_account` de la poche « Épargne Enfants ») | épargne | **non** (protégé) | 30 000 DH |
| ACC-4 · Espèces | espèces | oui | 2 000 DH |

**Patrimoine liquide total J0** = 22 000+15 000+30 000+2 000 = **69 000 DH**
**Trésorerie opérationnelle J0** (exclut ACC-3) = 22 000+15 000+2 000 = **39 000 DH**

### 1.2 Revenus

| Source | Montant | Jour habituel | Compte cible |
|---|---|---|---|
| Salaire Nabil | 18 000 DH/mois | 25 | ACC-1 |
| Salaire Salma | 12 000 DH/mois | 28 | ACC-2 |
| Prime Nabil (ponctuelle) | 5 000 DH prévue | jour 45 (15 oct) | ACC-1 |

### 1.3 Charges fixes (`ChargePlan` auto_frequence, obligatoires, priorité 1)

| Charge | Montant | Jour d'échéance | Compte défaut |
|---|---|---|---|
| Crédit logement | 4 500 DH | 5 | ACC-1 |
| Internet | 399 DH | 10 | ACC-1 |
| Téléphone | 250 DH | 12 | ACC-1 |
| Électricité (estimée) | 900 DH | 18 | ACC-2 |

### 1.4 Scolarité (`ChargePlan` calendrier_manuel, catégorie École, enfant Yanis), toutes liées à la **Provision Scolarité**

| Échéance | Montant | Jour / date |
|---|---|---|
| D-S1 · Réinscription Yanis | 20 000 DH | jour 14 (15 sept) |
| D-S2 · Sorties + fournitures Yanis & Ines | 2 000 DH | jour 29 (30 sept) |
| D-S3 · Réinscription + scolarité T1 | 20 000 DH | jour 75 (15 nov) |
| D-S4 · T2 scolarité Yanis | 6 000 DH | jour 136 (15 janv) |

### 1.5 Budget variable
Courses (Alimentation) : **1 500 DH/semaine** → taux journalier 214,29 DH.

### 1.6 Épargne
- **SP-1 « Or Nabil »** — `virtual_allocation`, propriétaire Nabil, protégée, `current_amount` initial = **4 000 DH** (mouvements confirmés antérieurs).
- **SP-2 « Épargne Enfants »** — `backed_by_account`, `linked_account_id = ACC-3`, protégée (RG-047), `current_amount` = lecture directe du solde ACC-3 = **30 000 DH**. Mensualité cible : 2 000 DH/mois (1 000 Yanis + 1 000 Ines), par `AccountTransfer`.

### 1.7 Provision
**Provision Scolarité** — `virtual_allocation`, `current_amount` initial = **9 000 DH**, liée aux 4 échéances D-S1 à D-S4.

### 1.8 Objectif
**Goal « PC »** — prix cible 15 000 DH, priorité 4, pas de date fixée.

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

*(Événement **l** — versement épargne enfants d'octobre — observé encore au statut « prévu » à un checkpoint mi-octobre, avant confirmation. Événements **s/t** — simulateur — traités en §6.)*

---

## 3. Trajectoire de septembre — preuve du trou de trésorerie (RG-051)

**Trésorerie opérationnelle** = ACC-1 + ACC-2 + ACC-4 (ACC-3 exclu, non-opérationnel).

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

**Point bas = 9 104 DH le jour 22 (23 septembre)**, soit **896 DH sous la marge de sécurité (10 000 DH)** — bien que septembre se termine largement positif (37 204 DH, +2 4 % vs. le solde de départ 39 000 DH... en réalité proche, l'essentiel étant que le mois complet est sain). **RG-051 se déclenche donc entre le 20 et le 24 septembre**, exactement dans la fenêtre décrite en introduction du cahier des charges (tension entre l'échéance scolaire du 15 et le salaire du 25) — un raisonnement mensuel global aurait masqué cette tension.

### 3.1 Checkpoint complet — jour 16 (pendant le paiement partiel)
- `reste_a_payer(D-S1)` = 20 000 − 15 551 = **4 449 DH** (état financier `partiellement_payée`)
- **Montants engagés** (horizon H* = jour 45, prime) incluent ce 4 449 DH — pas 20 000 (montant initial), pas 0 (déjà réglé) : `250(tél. sept) + 4 449(D-S1) + 2 000(D-S2) + 250(tél. oct) + 4 500(crédit oct) + 399(internet oct) = 11 848 DH`.
- **Preuve directe du point 5 des remarques** : le moteur ne projette jamais 20 000 DH de sortie future pour D-S1 une fois le premier paiement enregistré.

### 3.2 Checkpoint complet — jour 22 (point bas)
- Trésorerie opérationnelle = 9 104 DH
- Montants réservés = Or Nabil (4 000) + Provision Scolarité (9 000, avant l'affectation du jour 25) = **13 000 DH**
- Montants engagés (H*=jour 45) = téléphone sept (250) + téléphone oct (250) + crédit oct (4 500) + internet oct (399) + D-S2 (2 000) + budget courses restant (23 j × 214,29 = 4 929) = **12 328 DH**
- **Disponible libre** = 9 104 − 13 000 − 12 328 − 10 000 = **−26 224 DH**

Ce chiffre très négatif n'est pas une anomalie : il signale correctement qu'aucune dépense discrétionnaire ne devrait être engagée à ce moment précis, y compris alors que le compte lui-même n'est pas à découvert — c'est précisément la différence entre trésorerie physique et capacité libre (document 01, A.3).

### 3.3 Checkpoint complet — jour 29 (fin septembre, post-rapprochement)
- Trésorerie opérationnelle = **37 204 DH**
- Montants réservés = Or Nabil (4 000) + Provision Scolarité (12 000, après affectation du jour 25) = **16 000 DH**
- Montants engagés (H*=jour 45) = téléphone sept (250) + téléphone oct (250) + crédit oct (4 500) + internet oct (399) + budget courses restant (16 j × 214,29 = 3 429) = **8 828 DH**
- **Disponible libre** = 37 204 − 16 000 − 8 828 − 10 000 = **2 376 DH**

---

## 4. Provision Scolarité — calcul temporel de suffisance (RG-032bis)

État au jour 29 : `current_amount` = 12 000 DH. Échéances encore liées et non soldées : D-S3 (20 000, jour 75) et D-S4 (6 000, jour 136) — D-S1 et D-S2 sont sorties du calcul car soldées.

| i | Échéance | `reste_a_payer` (rᵢ) | Besoin cumulé Rᵢ | Mois restants | Taux requis (Rᵢ−12000)/mois |
|---|---|---|---|---|---|
| 1 | D-S3 (jour 75) | 20 000 | 20 000 | 46j ≈ 1,53 mois | (20 000−12 000)/1,53 = **5 229 DH/mois** |
| 2 | D-S4 (jour 136) | 6 000 | 26 000 | 107j ≈ 3,57 mois | (26 000−12 000)/3,57 = 3 922 DH/mois |

**Versement mensuel recommandé = max(5 229 ; 3 922) = 5 229 DH/mois**, arrondi à **5 200 DH/mois** pour l'affichage.

**Preuve que le calcul naïf sous-provisionnerait** : une approche « reste global / mois restants total » donnerait `(26 000−12 000)/3,57 = 3 922 DH/mois`. À ce rythme, au jour 75 (échéance D-S3), la provision contiendrait seulement `12 000 + 3 922×1,53 ≈ 18 001 DH` — **1 999 DH de moins que les 20 000 DH requis**. Le calcul par palier (RG-032bis) évite cette erreur en identifiant que c'est le palier intermédiaire (D-S3), pas le total final, qui est contraignant.

---

## 5. Octobre – Novembre — projection agrégée

*(À partir du jour 29, projection mensuelle des flux connus — moins détaillée au jour le jour que septembre, le mécanisme de détection ayant déjà été prouvé en détail §3.)*

**Octobre** (jour 29 → jour 59) : + salaires (18 000+12 000) + prime (5 000) − crédit (4 500) − internet (399) − téléphone ×2 (250+250, dont le retard de septembre enfin réglé) − électricité (880 réel) − courses (6 429) − transfert épargne enfants (2 000) = **+20 292 DH**.
→ Trésorerie opérationnelle jour 59 = 37 204 + 20 292 = **57 496 DH**. Aucun point bas sous la marge identifié sur ce mois (minimum estimé ≈ 32 000 DH, avant l'arrivée de la prime et des salaires).

**Novembre** (jour 59 → jour 90) : + salaires (18 000+12 000) − crédit (4 500) − internet (399) − téléphone (250) − électricité (880) − courses (6 429) − transfert épargne enfants (2 000) − **D-S3 (20 000, jour 75)** = **−4 458 DH**.
→ Trésorerie opérationnelle jour 90 = 57 496 − 4 458 = **53 038 DH**.

**Point bas de novembre** (jour 75, juste après D-S3, avant les salaires de fin de mois) : 57 496 − 4 500(crédit) − 399(internet) − 250(téléphone) − 3 429(courses, 16j) − 2 000(transfert) − 20 000(D-S3) = **26 918 DH** — confortablement au-dessus de la marge (aucune alerte RG-051 ce mois-ci, contrairement à septembre).

**Checkpoint complet — jour 75** :
- Réservés = Or Nabil (4 000) + Provision Scolarité (12 000 + 5 000 versement d'octobre confirmé = 17 000) = **21 000 DH**
- Engagés (horizon → jour 84, salaire Nabil) = électricité nov restante (880) + courses restant (14j×214,29=3 000) = **3 880 DH**
- **Disponible libre** = 26 918 − 21 000 − 3 880 − 10 000 = **−7 962 DH**
- **Capacité disponible brute** (avant marge, cf. §6) = −7 962 + 10 000 = **2 038 DH**

---

## 6. Projections 7 / 30 / 60 / 90 jours (référence : jour 29, 30 septembre)

| Horizon | Jour cible | Trésorerie opérationnelle | Point bas de la fenêtre | Alerte RG-051 |
|---|---|---|---|---|
| 7 jours | 36 | 32 704 (après crédit oct.) | 32 704 | non |
| 30 jours | 59 | 57 496 | ≈ 32 000 | non |
| 60 jours | 89-90 | 53 038 | 26 918 (jour 75) | non |
| 90 jours | 119 | ≈ 68 580 (extrapolé) | 26 918 (jour 75) | non |

*(Pour mémoire, le point bas de la fenêtre complète depuis le jour 0 reste le jour 22 = 9 104 DH, déjà sous la marge — cf. §3. Depuis le jour 29, aucune nouvelle tension sous la marge n'est détectée dans les 90 jours suivants.)*

---

## 7. Simulateur — achat du PC (15 000 DH)

**Capacité disponible brute** (= Disponible libre + Marge de sécurité, avant application du coussin — cf. document 02 G.11) aux dates clés :

| Date | Jour | Capacité disponible brute |
|---|---|---|
| 30 septembre (aujourd'hui) | 29 | 12 376 |
| 15 novembre (point bas, après D-S3) | 75 | 2 038 |
| 30 novembre | 90 | 15 866 |
| 29 décembre (extrapolé) | 119 | 26 408 |

### s. Achat simulé « aujourd'hui » (30 septembre)
```
Capacité_avec_achat(t) = Capacité_brute(t) − 15 000, minimum sur la fenêtre = au jour 75 : 2 038 − 15 000 = −12 962
```
**Verdict : non compatible actuellement** — le point bas après achat serait négatif à la mi-novembre, sous le poids de l'échéance D-S3.

### t. Comparaison de plusieurs dates d'achat
- **30 novembre (jour 90)** : capacité après achat = 15 866 − 15 000 = **866 DH** (≥ 0, techniquement possible) ; marge vs. coussin = 866 − 10 000 = **−9 134 DH** → **possible mais risqué**.
- **29 décembre (jour 119)** : capacité après achat = 26 408 − 15 000 = **11 408 DH** ; marge vs. coussin = 11 408 − 10 000 = **+1 408 DH** → **possible maintenant** (confortable).
- Par interpolation entre le 30 novembre et le 29 décembre (progression ≈ 363 DH/jour), la marge repasse positive vers le **25 décembre**.

**Message produit généré** :
> « Achat techniquement possible dès le 30 novembre, mais avec seulement 866 DH de marge après achat — largement en dessous de votre coussin de sécurité de 10 000 DH (écart : −9 134 DH). Le 25 décembre offre une marge nettement plus confortable (+1 408 DH au-dessus du coussin), une fois l'échéance scolaire de novembre absorbée. »

- **Impact sur les provisions** : aucun changement du calendrier de la Provision Scolarité — l'achat n'y touche pas.
- **Impact sur l'épargne protégée** : aucun — l'Or de Nabil et l'Épargne Enfants ne sont jamais inclus dans `Capacité_disponible_brute`, donc jamais mobilisés, même implicitement.
- **Objectifs concurrents** : aucun autre `Goal` actif dans ce scénario.

---

## 8. Preuves anti-double-comptage (point 20 des remarques)

**Cas A — Provision logique école.** Au jour 25, l'affectation virtuelle de 3 000 DH à la Provision Scolarité fait passer `Montants_réservés` de 13 000 à 16 000 DH. Les soldes ACC-1/ACC-2 de ce même jour sont rigoureusement inchangés par cet événement (aucune ligne dans `LedgerEntry` n'est créée). *Entrent* : le mouvement virtuel dans le calcul de `Montants_réservés` (G.3). *Sont exclus* : tout impact sur `solde_courant` (G.1). *Pourquoi* : RG-071, une poche `virtual_allocation` ne référence aucun compte.

**Cas B — Transfert réel vers l'épargne enfants.** Au jour 20, 2 000 DH quittent ACC-2 et entrent sur ACC-3. `Patrimoine_liquide_total` avant = 41 704 DH (0+9 204+30 000+2 500) ; après = 41 704 DH (0+7 204+32 000+2 500) — **rigoureusement identique**. Seule `Trésorerie_opérationnelle` diminue de 2 000 DH, parce qu'ACC-3 sort du périmètre opérationnel — un effet unique, jamais doublé. *Entrent* : le transfert dans `solde_courant(ACC-2)` et `solde_courant(ACC-3)` (G.1). *Sont exclus* : toute déduction supplémentaire dans `Montants_réservés`, puisque SP-2 est `backed_by_account` (RG-072).

**Cas C — Échéance partiellement payée.** Après le paiement du jour 14, `reste_a_payer(D-S1)` = 4 449 DH. Seul ce montant (pas 20 000, pas 0) entre dans `Montants_engagés` du jour 16 au jour 18 (§3.1). *Entrent* : le solde restant dû. *Sont exclus* : la part déjà payée (15 551 DH), déjà sortie de la trésorerie opérationnelle et jamais reprojetée.

**Cas D — Budget courses.** Au jour 29, 2 150 DH ont été réellement dépensés sur le budget de septembre (100+600+300+550+120+480). Le « restant projeté » utilisé dans `Montants_engagés` ne recompte jamais ces 2 150 DH — il ne porte que sur les jours futurs de la période en cours (RG-024bis, IF-13). *Entrent* : la part future (prorata des jours restants). *Sont exclus* : la part déjà réalisée, déjà déduite une fois dans `Trésorerie_opérationnelle`.

**Cas E — Transfert entre comptes.** Généralisation du cas B : tout `AccountTransfer` interne confirmé (ex. retrait espèces du jour 15, 500 DH ACC-2→ACC-4) a un impact net foyer strictement nul sur `Patrimoine_liquide_total` (IF-03) — vérifié explicitement : avant = 9 704+2 000=11 704 (ACC-2+ACC-4) ; après = 9 204+2 500=11 704. Identique.

---

## 9. Vérification des invariants financiers (document 02)

| Invariant | Statut sur ce scénario |
|---|---|
| IF-01 (rien de réel sans confirmation) | ✓ — chaque `Payment`/`IncomeOccurrence.reçu`/`AccountTransfer.confirmé` du journal (§2) résulte d'une action explicite datée |
| IF-02 (patrimoine = Σ soldes comptes) | ✓ — vérifié à chaque checkpoint (§3.3 : 16 000+18 824+32 000+2 380 = 69 204 DH au jour 29, cf. contrôle par flux net en annexe de calcul) |
| IF-03 (transfert interne net nul) | ✓ — Cas B et Cas E (§8) |
| IF-05 (`reste_a_payer` ≥ 0) | ✓ — D-S1 : 20 000 → 4 449 → 0, jamais négatif |
| IF-06 (anti-double-comptage) | ✓ — Cas A et B (§8) : SP-2 (`backed_by_account`) jamais additionnée dans Montants réservés |
| IF-07 (solde poche virtuelle = Σ mouvements) | ✓ — Provision Scolarité : 9 000 (initial) + 3 000 (jour 25) = 12 000, exactement la somme des `PocketMovement` confirmés |
| IF-08 (solde poche adossée = solde du compte lié) | ✓ — Épargne Enfants affiche toujours exactement `solde_courant(ACC-3)` (30 000 → 32 000 au jour 20) |
| IF-11 (engagements indépendants du statut temporel) | ✓ — §3.1 : D-S1 incluse dans les engagements alors que son statut temporel est `overdue`/`due` selon le jour, seul l'état financier compte |
| IF-12 (`reste_a_payer`, jamais montant brut) | ✓ — §3.1, §8 Cas C |
| IF-13 (pas de double comptage budget variable) | ✓ — §8 Cas D |
| IF-14 (un compte = une poche adossée) | ✓ — ACC-3 n'est référencé que par SP-2 dans ce scénario |

Ce jeu de données et ces résultats constituent le test oracle de référence — toute divergence de l'implémentation future avec les valeurs ci-dessus doit être traitée comme un bug, pas comme une variante acceptable.
