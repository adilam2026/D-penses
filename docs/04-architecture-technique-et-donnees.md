# 04 — Architecture technique, modèle de données, notifications, offline, sécurité

> Couvre les points **O** (choix techniques), **P** (modèle de données), **Q** (notifications), **R** (offline/sync), **S** (sécurité). S'appuie sur le modèle métier du document 02.

---

## O. Choix techniques recommandés

### O.1 Stack applicative

| Couche | Choix recommandé | Justification |
|---|---|---|
| **Mobile** | React Native (Expo) ou Flutter — un seul langage/UI pour iOS+Android | Équipe réduite probable (couple/petit projet), time-to-market, écosystème mature pour formulaires financiers |
| **Backend** | API applicative (Node.js/NestJS ou équivalent typé) + base relationnelle | Le modèle métier (document 02) est fortement relationnel (FK, contraintes d'intégrité, statuts) — un SGBD relationnel est **structurellement** le bon choix, pas un NoSQL document |
| **Base de données** | PostgreSQL | Contraintes CHECK sur statuts/transitions, transactions ACID indispensables (un paiement + mise à jour de statut doit être atomique), support JSONB pour les champs peu structurés (ex. règles de récurrence RRULE) |
| **Auth** | OAuth2/OIDC ou service managé (ex. Auth via fournisseur tiers) + JWT courte durée + refresh token | §44 sécurité, déconnexion multi-appareils nécessite une table `Session`/`Device` révocable côté serveur, pas de JWT longue durée non révocable |
| **Stockage fichiers** | Object storage (S3-compatible) pour `Attachment` | Photos/PDF de justificatifs, jamais en base |
| **Notifications push** | Service push standard (FCM/APNs via un provider unifié) | Cf. Q |
| **Offline** | Base locale embarquée (SQLite/WatermelonDB ou équivalent) + synchronisation par événements | Cf. R |

### O.2 Pourquoi pas d'IA générative en V1 (confirmation du §46)

Toute la couche "Conseiller" (document 01, REC-05) doit être un **moteur de règles déterministe** exécuté côté serveur sur les formules du document 02 §G. Aucune donnée financière du foyer n'est envoyée à un modèle génératif en V1. Cela garantit : explicabilité de chaque recommandation, reproductibilité, absence de risque de fuite de données sensibles vers un tiers.

### O.3 Architecture logique (vue composants)

```
[App mobile] ──HTTPS/JWT──► [API Gateway]
                                  │
                 ┌────────────────┼─────────────────┐
                 ▼                ▼                  ▼
         [Service Foyer]  [Service Financier]  [Moteur Projection/Alertes]
         (users, roles,    (income, charges,    (job planifié + calcul
          children)         épargne, goals)       à la demande, lit seul)
                 │                │                  │
                 └────────────────┴──────────────────┘
                                  │
                            [PostgreSQL]
                                  │
                        ┌─────────┴─────────┐
                        ▼                   ▼
                 [Object storage]     [Notification service]
                 (justificatifs)      (push + agrégation)
```

Le "Moteur Projection/Alertes" est **read-only** sur les données transactionnelles : il ne modifie jamais une entité financière, il produit des `Alert` (écriture propre, non financière) et sert les calculs du document 02 §G à la demande (dashboard, simulateur) plus un passage planifié (ex. toutes les nuits) pour générer les alertes proactives (retard, oubli, dépassement).

### O.4 Intégrité des calculs : source de vérité unique

Toutes les formules G.1 à G.13 doivent être implémentées **une seule fois**, côté serveur, jamais dupliquées côté client (même approximativement pour un affichage "rapide"). Le client affiche ce que l'API calcule. C'est la garantie contre les incohérences de chiffres entre les deux téléphones du couple (§42).

---

## P. Modèle de données proposé (niveau tables, non exhaustif sur les colonnes techniques standard `id/created_at/updated_at`)

```sql
-- SOCLE
household(id, name, security_margin_amount, currency, created_at)
user(id, email, password_hash, first_name, last_name, avatar_url, created_at)
household_membership(id, household_id, user_id, role ENUM('admin','member','read_only'), joined_at)
child(id, household_id, first_name, last_name, birth_date, sex NULL, school_name NULL,
      school_class NULL, school_year NULL, avatar_url NULL, status ENUM('active','inactive'))
category(id, household_id NULL, name, icon, kind ENUM('income','expense','both'), is_system BOOL)

-- REVENUS
income_source(id, household_id, label, beneficiary_user_id NULL, category_id,
               recurrence_rule NULL /* RRULE ou NULL si ponctuel */, usual_amount,
               is_recurring BOOL, notes NULL, status ENUM('active','archived'))
income_occurrence(id, income_source_id, usual_date, actual_date NULL,
                   planned_amount, actual_amount NULL,
                   status ENUM('prévu','reçu','en_retard','annulé','obsolète'),
                   confirmed_by_user_id NULL, confirmed_at NULL)

-- CHARGES / ÉCHÉANCES / PAIEMENTS
charge_plan(id, household_id, label, category_id, generation_mode ENUM('auto_frequence','calendrier_manuel'),
            recurrence_rule NULL, is_mandatory BOOL, payment_method NULL,
            default_beneficiary_user_id NULL, start_date, end_date NULL, priority_level SMALLINT)
charge_plan_child(charge_plan_id, child_id)          -- rattachement multiple enfants
deadline(id, charge_plan_id, due_date, amount_due, is_estimated BOOL,
         original_estimated_amount NULL,
         status ENUM('planifiée','à_venir','à_payer','partiellement_payée','payée',
                      'en_retard','reportée','annulée'),
         provision_id NULL REFERENCES provision(id))
payment(id, deadline_id, amount, paid_date, payment_method NULL, type ENUM('paiement','régularisation','remboursement'),
        recorded_by_user_id, notes NULL)

-- BUDGETS VARIABLES
variable_budget(id, household_id, category_id, reference_amount, reference_period ENUM('week','month'),
                 start_date, end_date NULL)
budget_expense(id, variable_budget_id, amount, spent_date, category_id, notes NULL, recorded_by_user_id)
budget_expense_member(budget_expense_id, member_ref /* user_id ou child_id + type */)

-- DÉPENSES PONCTUELLES
adhoc_expense(id, household_id, category_id, amount, spent_date, notes NULL, recorded_by_user_id)
adhoc_expense_member(adhoc_expense_id, member_ref)

-- ÉPARGNE / PROVISIONS / OBJECTIFS
savings_pocket(id, household_id, name, owner_user_id NULL, beneficiary_ref NULL,
                is_protected BOOL, target_amount NULL, target_date NULL,
                recurring_amount NULL, recurrence_rule NULL,
                current_amount, holding_mode ENUM('logique','compte_separe'))
provision(id, household_id, name, current_amount, holding_mode ENUM('logique','compte_separe'),
          is_protected BOOL DEFAULT false, is_flexible BOOL DEFAULT true)
pocket_movement(id, pocket_type ENUM('savings_pocket','provision'), pocket_id,
                 planned_date, planned_amount, actual_date NULL, actual_amount NULL,
                 status ENUM('prévu','confirmé','en_retard','annulé'), confirmed_by_user_id NULL)
goal(id, household_id, name, target_price, target_date NULL, priority_level SMALLINT,
     linked_pocket_id NULL, status ENUM('en_cours','atteint','en_pause','abandonné'))
goal_contribution(id, goal_id, planned_date, planned_amount, actual_date NULL, actual_amount NULL,
                   status ENUM('prévu','confirmé'))

-- INTELLIGENCE
simulation_scenario(id, household_id, created_by_user_id, name, payload JSONB, created_at, status ENUM('brouillon','sauvegardé'))
alert(id, household_id, type ENUM('retard','dépassement_budget','anomalie','oubli','tension_tresorerie','prevision'),
      severity ENUM('info','attention','critique'), entity_type NULL, entity_id NULL,
      message, created_at, resolved_at NULL, resolved_by_user_id NULL)

-- TRANSVERSE
attachment(id, entity_type ENUM('deadline','payment','adhoc_expense'), entity_id,
           file_url, file_type, uploaded_by_user_id, uploaded_at)
audit_event(id, household_id, entity_type, entity_id, action ENUM('create','update','status_change','archive'),
            field_name NULL, old_value NULL, new_value NULL, actor_user_id, occurred_at)
notification_preference(id, user_id, alert_type, channel ENUM('push','email','in_app'), threshold_days NULL, enabled BOOL)
notification_instance(id, user_id, alert_id, sent_at, read_at NULL, channel)
device(id, user_id, push_token NULL, platform, last_seen_at, revoked_at NULL)
```

**Notes de conception** :
- Toutes les tables métier portent `household_id` (directement ou via leur parent) → base de l'isolation stricte (§S.2).
- `recurrence_rule` en texte RRULE (iCal) plutôt qu'un enum de fréquences fixes (cf. INC-09) : couvre nativement mensuel/hebdo/trimestriel/annuel/personnalisé.
- Contraintes CHECK PostgreSQL sur les colonnes `status` pour interdire au niveau base les transitions impossibles en complément de la validation applicative (défense en profondeur).
- Aucune colonne "solde calculé" stockée durablement sur `household` : `Trésorerie_déclarée` est la somme d'un relevé déclaré à une date (table `balance_snapshot(household_id, declared_at, amount)` implicite, à ajouter si le foyer veut un historique de ses relevés) — tout le reste (engagée, réservée, disponible, projection) est **calculé à la demande**, jamais stocké de façon durable (évite la dérive de cache, cf. G.13).

---

## Q. Stratégie notifications

### Q.1 Principes (§26, §51)
- Jamais de notification générique/creuse — chaque notification pointe vers une `Alert` ou une `ActionItem` concrète et actionnable.
- **Agrégation par défaut** : plusieurs échéances proches se regroupent en une notification ("3 échéances sous 7 jours, 14 250 DH au total") plutôt que 3 push séparés.
- Plafond quotidien paramétrable par foyer (REC-06) avec file de priorité : retard > dépassement de budget > tension de trésorerie prévue > confirmation de revenu > conseils/objectifs.

### Q.2 Types et déclenchement

| Type | Déclencheur | Seuils par défaut (paramétrables) |
|---|---|---|
| Échéance | J-15 / J-7 / J-3 / jour J / retard | via `notification_preference.threshold_days` |
| Agrégée | ≥ 2 échéances dans les 7 jours | fenêtre 7j |
| Budget | consommé ≥ 80 % du `variable_budget` | 80 % |
| Prévision | `Solde_projeté` (G.5) passe sous marge de sécurité dans les 30j | continu, calcul nocturne |
| Objectif | changement significatif de date d'atteinte estimée (±1 mois) | recalcul mensuel |
| Provision | reste à constituer croissant à l'approche de l'échéance liée | recalcul mensuel + à J-30 |
| Anomalie / oubli | RG-052 / RG-053 | calcul nocturne |

### Q.3 Canaux
Push (par défaut), in-app (`Actions à traiter`, toujours présent même sans push), email (optionnel, résumé hebdomadaire V2). Chaque utilisateur configure ses seuils indépendamment (un couple peut vouloir des sensibilités différentes).

### Q.4 Anti-doublon
`notification_instance` référence l'`Alert` source ; une même alerte non résolue ne redéclenche pas de nouvelle notification avant un délai de repos (défaut 24h), sauf changement d'état (ex. retard qui s'aggrave).

---

## R. Stratégie offline / synchronisation

### R.1 Portée V1
Le cahier des charges autorise à différer la complexité si nécessaire (§43) en gardant l'architecture prête. Recommandation : **consultation offline complète dès la V1** (cache local des données du foyer, lecture), **saisie offline limitée** à la V1 (nouvelles dépenses/échéances/confirmations mises en file d'attente locale), synchronisation bidirectionnelle complète avec résolution de conflits élaborée en **V2**.

### R.2 Mécanisme
- Base locale embarquée sur l'appareil, miroir partiel des données du foyer (fenêtre glissante : période courante + N mois, pas tout l'historique).
- Toute écriture locale est un **événement** horodaté et attribué (`actor_user_id`, `device_id`, `client_timestamp`) mis en file, pas une simple valeur — cohérent avec REC-03 (event sourcing léger) : cela permet de **rejouer** les événements de plusieurs appareils dans l'ordre serveur plutôt que de comparer des snapshots.
- À la reconnexion, la file est poussée au serveur qui rejoue les événements dans l'ordre de réception serveur (pas l'ordre client, pour éviter la triche d'horloge locale) et détecte les conflits réels (cf. R.3).

### R.3 Résolution de conflits
- Conflit **sans recouvrement métier réel** (deux dépenses différentes créées offline par les deux membres) : aucun conflit, simple fusion.
- Conflit **sur la même entité** (H-01, ex. deux confirmations de la même `Deadline`) : la première écriture reçue par le serveur gagne ; la seconde est rejetée avec un message explicite au client concerné (jamais un écrasement silencieux, cf. §42).
- Conflit de **modification de champ non exclusif** (ex. deux modifications de note sur la même échéance) : dernière écriture par horodatage serveur gagne, mais les deux versions restent visibles dans `audit_event`.

### R.4 Indicateurs UX
Un badge "en attente de synchronisation" sur toute opération créée offline, retiré dès confirmation serveur ; en cas de rejet de conflit, l'opération repasse dans "Actions à traiter" pour arbitrage manuel plutôt que d'être perdue silencieusement.

---

## S. Stratégie de sécurité

### S.1 Authentification
- Email + mot de passe (hash Argon2id), + PIN local ou biométrie (Face ID/empreinte) comme second facteur de **déverrouillage rapide de l'app** (pas un remplacement de l'auth serveur, cf. §44).
- Sessions server-side révocables (`device` table) : l'écran Sécurité permet "déconnecter tous les appareils" (§44) = révocation de tous les refresh tokens du user.
- Verrouillage automatique de l'app après une période d'inactivité configurable, avec ré-authentification PIN/biométrie.

### S.2 Isolation stricte entre foyers
- Toute requête serveur est scopée par `household_id` dérivé du token de session, jamais transmis en paramètre libre par le client (empêche l'énumération/accès croisé).
- Contrôle d'accès au niveau service **et** au niveau base (Row-Level Security PostgreSQL en défense en profondeur) sur `household_id`.

### S.3 Chiffrement
- Chiffrement au repos de la base (chiffrement disque managé) et du stockage objet (justificatifs).
- TLS en transit pour tout appel API.
- Pas de stockage de données de paiement bancaire réelles (l'app ne fait pas de connexion bancaire en V1, §46) — le champ "moyen de paiement" est déclaratif (libellé libre : "carte", "virement"…), aucune donnée de carte n'est jamais capturée.

### S.4 Journalisation
- `audit_event` couvre les modifications de données financières (§29/§S ci-dessus).
- Journal d'accès séparé (connexions, changements de mot de passe, révocations d'appareil) pour la sécurité du compte, distinct de l'audit métier.

### S.5 Droits et confidentialité intra-foyer
- Même si le couple partage l'essentiel, une `SavingsPocket` peut être marquée `owner_user_id` sans visibilité en modification pour l'autre admin en V2 (le cahier des charges V1 dit "tout admin peut tout consulter" — cf. K, la confidentialité fine des poches personnelles est documentée comme piste V2, pas promise en V1 pour ne pas complexifier les droits dès le départ, cf. §46 anti-surcharge).

### S.6 Suppression de compte / foyer (§45)
- Suppression de compte utilisateur : anonymisation des références d'auteur dans `audit_event`/`payment` (`recorded_by_user_id → utilisateur supprimé`), le foyer et les données financières communes ne sont pas affectées si d'autres membres restent.
- Suppression de foyer : action réservée aux admins, double confirmation explicite (saisie du nom du foyer pour confirmer, pattern standard), purge différée (ex. 30 jours de grâce avant purge définitive) plutôt qu'une suppression immédiate irréversible — réduit le risque d'erreur humaine sur des données financières familiales.
