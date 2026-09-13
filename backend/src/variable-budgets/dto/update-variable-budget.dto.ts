import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

const REFERENCE_PERIOD_VALUES = ['semaine', 'mois'] as const;
const MONTH_MODE_VALUES = ['calendaire', 'financier', 'personnalise'] as const;

/**
 * §14 : modification en cours de période — les BudgetExpense déjà enregistrées
 * ne sont jamais réécrites ; seul le restant se recalcule avec la nouvelle
 * référence. R6.4 (§1) : référencePeriod/weekStartDay/categoryId deviennent
 * également modifiables (déjà de simples colonnes, aucune contrainte
 * d'historique dessus contrairement à referenceAmount déjà géré) — seule la
 * fenêtre de période COURANTE en avant change, l'historique (BudgetExpense)
 * reste daté tel quel.
 */
export class UpdateVariableBudgetDto {
  @IsOptional()
  @IsNumber()
  @IsPositive()
  referenceAmount?: number;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsIn(REFERENCE_PERIOD_VALUES)
  referencePeriod?: (typeof REFERENCE_PERIOD_VALUES)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekStartDay?: number;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Lot 6 — mode du mois pour referencePeriod='mois' (inerte pour 'semaine'). */
  @IsOptional()
  @IsIn(MONTH_MODE_VALUES)
  monthMode?: (typeof MONTH_MODE_VALUES)[number];

  /** Requis si le mode effectif final est 'personnalise' (celui fourni ici ou,
   *  à défaut, celui déjà en base) — toujours forcé à null en service sinon. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  customStartDay?: number;

  /** Lot 2 — rescope vers ce CategoryType précis (doit appartenir à categoryId,
   *  celui déjà en base si categoryId n'est pas fourni dans le même appel).
   *  `null` explicite = repasse le budget au scope catégorie entière (symétrique
   *  du passage catégorie→type) ; absent (undefined) = valeur actuelle conservée. */
  @IsOptional()
  @IsUUID()
  categoryTypeId?: string | null;

  /** Lot 1 — bascule Oui/Non de la participation au Solde prudent. */
  @IsOptional()
  @IsBoolean()
  includeInPrudentProjection?: boolean;
}
