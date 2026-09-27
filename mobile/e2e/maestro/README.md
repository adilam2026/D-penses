# Recette E2E Android — Finance Maison (Maestro)

Suite de tests UI automatisés pilotant l'APK Android **réellement installé**
sur un émulateur, avec [Maestro](https://maestro.mobile.dev/) (`tapOn`,
`inputText`, `scroll`, `longPressOn`, `assertVisible`, etc. — jamais de
simples tests React/Jest). Préparée pour être lancée, relancée et analysée
par un autre agent sans intervention humaine.

## Portée et garde-fous

- **Backend de test : staging uniquement.**
  `https://finance-maison-backend-production.up.railway.app`. Aucun flow,
  aucun script de ce dossier ne doit jamais pointer vers un backend PROD.
- **Branche : `claude/finance-maison-v1` uniquement.** Jamais `main`/`master`.
- **Base de données : jamais touchée directement.** Toute réinitialisation
  passe exclusivement par l'endpoint applicatif `POST /e2e/reset` (voir
  ci-dessous) — jamais de `DROP DATABASE`, jamais d'accès SQL direct.

## Organisation des flows (`flows/`)

Un fichier `.yaml` par parcours (`appId: com.depenses.mobile`), numérotés
dans l'ordre du cahier des charges de la recette :

| Fichier | Parcours |
|---|---|
| `01-login.yaml` | Connexion |
| `02-accueil.yaml` | Accueil (comptes/sous-comptes du foyer de démo) |
| `03-creation-compte.yaml` | Création d'un compte |
| `04-creation-sous-compte.yaml` | Création d'un sous-compte |
| `05-creation-depense.yaml` | Création d'une dépense réalisée |
| `06-modification-transaction.yaml` | Modification d'une transaction — **échec attendu**, voir plus bas |
| `07-annulation-reversal.yaml` | Annulation / reversal d'une transaction — **échec attendu**, même gap |
| `08-revenu.yaml` | Revenu |
| `09-transfert.yaml` | Transfert entre comptes |
| `10-versement.yaml` | Versement (contribution vers un sous-compte) |
| `11-planning.yaml` | Planning — vue d'ensemble, horizon 3/6/9/12 mois |
| `12-planning-tap-realiser.yaml` | Planning — tap simple pour réaliser un paiement prévu |
| `13-planning-appui-long.yaml` | Planning — appui long pour ajuster avant paiement |
| `14-recurrence.yaml` | Récurrence (règle de revenu récurrent) |
| `15-epargne.yaml` | Épargne — vue d'ensemble |
| `16-sante.yaml` | Santé / Mutuelle — onglets Dépenses/Remboursements |
| `17-sante-remboursement-partiel.yaml` | Santé — remboursement partiel d'un dossier |
| `18-plans-financiers.yaml` | Plans financiers — création + ajout d'un poste |
| `19-objectifs.yaml` | Objectifs (défini depuis une carte Épargne) |
| `20-drawer-navigation.yaml` | Menu ☰ / navigation |
| `21-logout-login.yaml` | Déconnexion puis reconnexion |

`flows/common/login.yaml` est un sous-flow réutilisable (appelé via
`runFlow` par chaque flow ci-dessus) : `launchApp: clearState: true` puis
connexion avec `${E2E_EMAIL}` / `${E2E_PASSWORD}` (fournis en variables
d'environnement Maestro par le workflow CI — voir plus bas). `clearState`
garantit que chaque flow repart d'une app fraîchement installée, donc reste
rejouable isolément (pas de dépendance entre flows).

### Sélecteurs utilisés

Chaque flow cible des éléments par `id:` (testID/accessibilityLabel posés
dans le code — jamais de coordonnées écran), sauf quand le texte visible est
strictement plus fiable (ex. nom de compte, libellé de catégorie fixe du
jeu de données de démonstration). Les testID ajoutés spécifiquement pour
cette recette (aucun impact visuel, aucune modification de design) :

- `login-email` / `login-password` / `login-submit` / `login-signup-link`
- `menu-row-<slug>` (une entrée par ligne du menu ☰, ex. `menu-row-comptes`,
  `menu-row-deconnexion`) et `menu-close`
- `transaction-row-<slug(libellé)>` sur les lignes d'historique de compte et
  de sous-compte (ex. `transaction-row-test-transaction`)
- `planning-cell-<slug(libellé de ligne)>-<mois>` sur chaque case du tableau
  Planning (ex. `planning-cell-voyage-2026-12`) — remplace un `testID`
  auparavant identique sur toutes les cases, qui rendait impossible de
  cibler une case précise depuis l'extérieur du composant.

`<slug(...)>` est calculé par `mobile/src/ui/testIdSlug.ts` (accents/casse/
ponctuation normalisés, ex. "Test transaction" → `test-transaction`).

### Gap produit documenté : parcours 6 et 7 (échec attendu)

Le cahier des charges de cette recette impose explicitement : *"Si
l'utilisateur n'a aucun moyen naturel de modifier une transaction, le test
doit échouer."* Au 2026-09-27, la ligne d'historique d'une transaction
(`AccountDetailScreen.tsx` / `SubaccountDetailScreen.tsx`) est une `<View>`
sans `onPress` : aucun écran de détail de transaction n'existe, donc aucune
action "Modifier" ni "Annuler" n'est accessible pour une transaction déjà
enregistrée (à distinguer du mécanisme "Annuler le paiement" du Planning,
qui lui existe et fonctionne — couvert par `12-planning-tap-realiser.yaml`
et `13-planning-appui-long.yaml`, un objet métier différent : une occurrence
planifiée, pas une transaction déjà réalisée).

`06-modification-transaction.yaml` et `07-annulation-reversal.yaml` créent
donc une transaction réelle, la retrouvent dans l'historique du compte,
puis échouent **intentionnellement** à l'étape "vérifier qu'une action
Modifier/Annuler existe". Ce n'est pas un défaut des flows ou de
l'infrastructure : c'est le rapport honnête d'une fonctionnalité manquante,
conformément à l'instruction. Aucun contournement (aucune fausse action,
aucun testID ajouté artificiellement pour faire passer ce test) n'a été mis
en place.

## Mécanisme de reset des données E2E

Endpoint applicatif : `POST /e2e/reset` (`backend/src/e2e/e2e.controller.ts`
→ `backend/src/e2e/e2e.service.ts`), appelé par le workflow CI avant chaque
campagne Maestro.

**Fonctionnement exact :**

1. Si la variable d'environnement serveur `E2E_TEST_MODE` n'est pas
   exactement `"true"`, l'endpoint répond **404** (comme s'il n'existait
   pas — jamais un 403 qui révélerait son existence). Sur un backend PROD où
   `E2E_TEST_MODE` n'est jamais positionnée, cette route est donc
   totalement inerte.
2. Sinon, le header `x-e2e-token` de la requête est comparé strictement à
   la variable d'environnement serveur `E2E_RESET_TOKEN`. Absent, vide ou
   différent → **403**.
3. Si les deux contrôles passent : résolution du foyer de démonstration
   (utilisateur `demo@finance-maison.local`, ou `E2E_TEST_EMAIL` si défini
   côté serveur), puis appel de `HouseholdsService.reset()` — **le même
   mécanisme, inchangé, que le bouton "Réinitialiser les données" exposé
   dans l'app mobile** (`ResetDataScreen.tsx`) : remise à zéro strictement
   bornée aux données financières du foyer (comptes, sous-comptes,
   catégories, opérations, dossiers santé, plans financiers…) — **jamais**
   `User`, `Session`, `Household` ou `HouseholdMembership`. Aucun
   `DROP DATABASE`, aucune requête SQL brute : uniquement des opérations
   Prisma déjà auditées et testées par ailleurs
   (`backend/test/*.e2e-spec.ts`).
4. Le jeu de données de démonstration est ensuite rejoué à l'identique via
   `seedBaselineHouseholdData()` (`backend/src/e2e/e2e-seed-data.util.ts`,
   **même fonction, partagée sans duplication**, que celle utilisée par
   `backend/prisma/seed.ts` à la création initiale du foyer de démo) :
   6 comptes, 5 sous-comptes, 8 catégories, une dizaine d'opérations
   réalisées, 2 opérations planifiées (`Voyage Été` 8000 DH échéance
   2026-12-15, `Prime annuelle` 3000 DH échéance 2026-12-01 — dates fixes,
   ciblées par les testID `planning-cell-*` des flows 12/13).

Testé par `backend/test/e2e-reset.e2e-spec.ts` (4 scénarios : mode inactif →
404 quel que soit le jeton ; jeton incorrect → 403 ; jeton correct → reset +
reseed effectifs ; jeu de données reconstruit identique au baseline).

**Jamais activé en PROD** : `E2E_TEST_MODE` et `E2E_RESET_TOKEN` ne doivent
être positionnées QUE sur le service Railway staging
(`finance-maison-backend-production`), jamais sur un service PROD. C'est une
action manuelle côté Railway (hors de portée de cette session) — voir
"Secrets à créer manuellement" ci-dessous.

## Workflow CI (`.github/workflows/android-e2e.yml`)

Déclenché manuellement (`workflow_dispatch`) et automatiquement sur chaque
push vers `claude/finance-maison-v1`. Étapes : checkout → install → typecheck
mobile → build APK Release (`EXPO_PUBLIC_API_URL` = staging, jamais
paramétrable autrement) → émulateur Android (API 34, x86_64, profil
`pixel_6`, portrait) → installation de l'APK → `POST /e2e/reset` sur
staging → `maestro test mobile/e2e/maestro/flows` (rapport JUnit + captures
de debug) → upload des artifacts (`e2e-apk-utilise`,
`e2e-rapport-maestro`, `e2e-logs-maestro`, `e2e-debug-captures-echecs`).

L'échec attendu des parcours 6/7 ne bloque jamais l'upload des artifacts
(`if: always()`).

## Secrets GitHub à créer manuellement

- **`E2E_RESET_TOKEN`** (Settings → Secrets and variables → Actions) : doit
  être **strictement identique** à la variable d'environnement
  `E2E_RESET_TOKEN` positionnée sur le service Railway staging
  `finance-maison-backend-production`.
- Sur ce même service Railway staging (action manuelle, hors de portée de
  cette session — aucun accès Railway direct ici), positionner :
  - `E2E_TEST_MODE=true`
  - `E2E_RESET_TOKEN=<même valeur que le secret GitHub ci-dessus>`
  - **Ne jamais positionner ces deux variables sur un service PROD.**

## Relancer une campagne

```bash
# Manuellement, depuis GitHub Actions → Android E2E (Maestro — recette staging) → Run workflow
# ou en local, avec un émulateur déjà démarré :
maestro test mobile/e2e/maestro/flows -e E2E_EMAIL=demo@finance-maison.local -e E2E_PASSWORD=DemoFinanceMaison2026!
```
