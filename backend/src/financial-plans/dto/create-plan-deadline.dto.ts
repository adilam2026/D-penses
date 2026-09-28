import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreatePlanDeadlineDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsDateString()
  dueDate!: string;

  /** Montant à payer pour cette échéance — additif aux postes éventuellement rattachés, jamais un remplaçant (cf. FinancialPlanDeadline). */
  @IsString()
  amount!: string;
}
