import { IsNumber, IsPositive } from 'class-validator';

/** R5 clôture §1 — montant réellement dépensé (le service calcule le delta signé). */
export class CorrectExpenseDto {
  @IsNumber()
  @IsPositive()
  correctedAmount!: number;
}
