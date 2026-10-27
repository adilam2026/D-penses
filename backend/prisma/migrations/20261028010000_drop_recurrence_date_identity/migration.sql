-- La date n'est plus l'identité logique d'une occurrence récurrente : c'est
-- désormais (recurrence_rule_id, series_version, occurrence_index), déjà
-- unique. L'ancienne unicité sur la date empêcherait de déplacer une
-- occurrence sur place, ou qu'une nouvelle version de série reprenne une
-- date déjà utilisée par l'ancienne. Aucune donnée n'est modifiée ; les
-- lignes sans n° (avant reprise) restent protégées des doublons par le
-- moteur (rattachement via l'ancien calcul de dates).
DROP INDEX "planned_operation_recurrence_rule_id_expected_date_key";
