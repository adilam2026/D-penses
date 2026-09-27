import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export type RecurrenceRuleApplyFrom = 'THIS_OCCURRENCE' | 'THIS_AND_FOLLOWING';

/**
 * Modifier une règle récurrente (§19) : jamais silencieux sur l'historique.
 * applyFrom pilote la portée — THIS_OCCURRENCE ne touche que l'occurrence
 * pivot (déjà éditable seule via PlannedOperationsService#update de toute
 * façon), THIS_AND_FOLLOWING met à jour le gabarit de la règle ET toutes les
 * occurrences futures encore PENDING à partir de fromDate (jamais le passé,
 * jamais les occurrences déjà REALIZED/CANCELLED).
 */
export class UpdateRecurrenceRuleDto {
  @IsIn(['THIS_OCCURRENCE', 'THIS_AND_FOLLOWING'])
  applyFrom!: RecurrenceRuleApplyFrom;

  @IsString()
  fromDate!: string;

  @IsOptional()
  @IsString()
  expectedAmount?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  sourceAccountId?: string;

  @IsOptional()
  @IsString()
  sourceSubaccountId?: string;

  @IsOptional()
  @IsString()
  destinationAccountId?: string;

  @IsOptional()
  @IsString()
  destinationSubaccountId?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
