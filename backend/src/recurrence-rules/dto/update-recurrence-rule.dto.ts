import { IsBoolean, IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { RecurrenceFrequency } from '@prisma/client';

export type RecurrenceRuleApplyFrom = 'THIS_OCCURRENCE' | 'THIS_AND_FOLLOWING';

const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = ['WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY', 'ONCE'];

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

  /**
   * Périodicité/jour de référence — THIS_AND_FOLLOWING uniquement (§ modifier
   * la périodicité). Fournir l'un ou l'autre réaligne la série à partir de
   * fromDate : les occurrences déjà générées sous l'ANCIENNE cadence à partir
   * de fromDate sont régénérées sous la nouvelle (jamais l'historique avant
   * fromDate, jamais REALIZED/CANCELLED). anchorDate, si fourni, est la
   * NOUVELLE date de l'occurrence pivot elle-même (ex. jour d'échéance 15 -> 20).
   */
  @IsOptional()
  @IsIn(RECURRENCE_FREQUENCIES)
  frequency?: RecurrenceFrequency;

  @IsOptional()
  @IsDateString()
  anchorDate?: string;
}
