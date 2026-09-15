import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const MONTH_MODE_VALUES = ['calendaire', 'financier', 'personnalise'] as const;

export class CreateVariableBudgetDto {
  /** M3 — libellé libre (ex. "Courses", "Loisirs"), distinct des catégories/types
   *  suivis ci-dessous. Champ vivant, jamais versionné. Omis = category.name
   *  par défaut (service) — jamais un champ obligatoire côté API : la fiche
   *  WEB-V4.4A en standby crée des budgets sans le fournir, comportement
   *  historique préservé à l'identique. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label?: string;

  @IsUUID()
  categoryId!: string;

  /** Lot 2 — conservé pour compatibilité ascendante : équivalent à
   *  categoryTypeIds=[valeur]. Omis (avec categoryTypeIds également omis) =
   *  budget scopé à toute la catégorie (comportement historique). */
  @IsOptional()
  @IsUUID()
  categoryTypeId?: string;

  /** M3 — un budget peut suivre PLUSIEURS CategoryType (doivent tous appartenir
   *  à categoryId). Liste vide ou omise = toute la catégorie. Prioritaire sur
   *  categoryTypeId si les deux sont fournis. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  categoryTypeIds?: string[];

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
