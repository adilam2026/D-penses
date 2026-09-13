import { IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

const MONTH_MODE_VALUES = ['calendaire', 'financier', 'personnalise'] as const;

export class CreateVariableBudgetDto {
  @IsUUID()
  categoryId!: string;

  /** Lot 2 — budget scopé à ce CategoryType précis (doit appartenir à categoryId) ;
   *  omis = budget scopé à toute la catégorie (comportement historique). */
  @IsOptional()
  @IsUUID()
  categoryTypeId?: string;

  @IsNumber()
  @IsPositive()
  referenceAmount!: number;

  @IsIn(['semaine', 'mois'])
  referencePeriod!: 'semaine' | 'mois';

  /** 1=lundi..7=dimanche (RG-098). Défaut lundi. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  weekStartDay?: number;

  /** Lot 6 — mode du mois pour referencePeriod='mois' (inerte pour 'semaine').
   *  Défaut 'calendaire' (comportement historique) si omis. */
  @IsOptional()
  @IsIn(MONTH_MODE_VALUES)
  monthMode?: (typeof MONTH_MODE_VALUES)[number];

  /** Requis si monthMode='personnalise' (1-31, clampé au dernier jour réel du
   *  mois si trop court — cf. variable-budget.util.ts). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  customStartDay?: number;

  @IsISO8601()
  startDate!: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  /** Défaut true (Lot 1) — seuls les budgets à true participent au Solde prudent. */
  @IsOptional()
  @IsBoolean()
  includeInPrudentProjection?: boolean;
}
