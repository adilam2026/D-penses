import { IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const OBLIGATION_VALUES = ['obligatoire', 'optionnelle_envisagee', 'optionnelle_souscrite', 'optionnelle_refusee'] as const;
const GENERATION_MODE_VALUES = ['auto_frequence', 'calendrier_manuel'] as const;

export class CreateChargePlanDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  // Lot 4 : calendrier_manuel s'ajoute à auto_frequence (Lot 2) — les deux modes
  // partagent le même mécanisme de création explicite de Deadline (§2).
  @IsOptional()
  @IsIn(GENERATION_MODE_VALUES)
  generationMode?: (typeof GENERATION_MODE_VALUES)[number];

  @IsOptional()
  @IsIn(RECURRENCE_VALUES)
  recurrenceRule?: (typeof RECURRENCE_VALUES)[number];

  @IsOptional()
  @IsUUID()
  defaultAccountId?: string;

  @IsOptional()
  @IsIn(OBLIGATION_VALUES)
  obligationStatus?: (typeof OBLIGATION_VALUES)[number];

  /** RG-110 : rattachement à 0 ou 1 FinancialPlan (§9) — jamais un conteneur universel obligatoire. */
  @IsOptional()
  @IsUUID()
  financialPlanId?: string;

  /** Enfants concernés par la charge (§10) — 0, 1 ou n (charge_plan_child). */
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  childIds?: string[];

  @IsISO8601()
  startDate!: string;

  /**
   * R6.2 (§1) : ancre de récurrence — remplace la notion de "jour du mois"/
   * anchorDay jamais demandée à part : l'utilisateur saisit une date complète
   * de "prochaine échéance", jamais un jour isolé. Absent = ensureChargeDeadlinesUntil
   * retombe sur startDate (comportement historique). Miroir exact de
   * IncomeSource.recurrenceAnchorDate.
   */
  @IsOptional()
  @IsISO8601()
  recurrenceAnchorDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  priorityLevel?: number;
}
