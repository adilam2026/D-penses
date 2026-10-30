# Dette de test

## Isolation entre foyers (RLS) — à recréer

Supprimé le 2026-10-30 avec `.github/workflows/railway-smoke-test.yml`
(obsolète : ciblait PROD via `DATABASE_URL_PROD`, écrivait directement en
base, appelait des routes supprimées au reset Finance Maison).

Ce workflow contenait le seul contrôle explicite « le foyer B ne peut pas
utiliser l'identifiant d'un compte / d'une catégorie du foyer A » (tentatives
de substitution d'identifiant), déjà non fonctionnel avant sa suppression.

Couverture actuelle partielle (ex. `finance-maison-member-color.e2e-spec.ts` :
un admin ne peut pas modifier un membre d'un autre foyer).

À recréer proprement :
- côté backend (suite e2e) : pour chaque ressource (comptes, sous-comptes,
  catégories, opérations, échéances, règles de récurrence, plans, objectifs),
  un utilisateur du foyer B qui fournit l'identifiant d'une ressource du
  foyer A reçoit 404/400 et rien n'est lu ni modifié ;
- côté STAGING (`railway-verify.yml`) : un contrôle équivalent sur deux
  foyers jetables, sans jamais toucher PROD ni écrire directement en base.
