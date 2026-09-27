import { IsDateString, IsOptional, IsString } from 'class-validator';

export class CreateReimbursementDto {
  @IsString()
  amount!: string;

  @IsDateString()
  date!: string;

  @IsString()
  destinationAccountId!: string;

  /** "Que faire de cet argent ?" → affecter à une enveloppe (sous-compte) plutôt que laisser disponible. */
  @IsOptional()
  @IsString()
  allocationSubaccountId?: string;
}
