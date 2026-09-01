import { IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

/**
 * Saisie rapide « + Dépense » (§2/§8). Une dépense réelle ordinaire (courses,
 * essence, restaurant...) ne crée jamais de ChargePlan/Deadline — seulement
 * une BudgetExpense (si un budget actif correspond) ou une AdHocExpense.
 */
export class CreateExpenseDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsISO8601()
  spentDate?: string;

  /** Désambiguïsation explicite si plusieurs VariableBudget actifs correspondent (§8). */
  @IsOptional()
  @IsUUID()
  variableBudgetId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
