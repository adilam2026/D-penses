import { IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

/**
 * Refonte maquette V6B §11 — clôture d'un dossier mutuelle : formulaire minimal
 * (montant reçu / date / compte bénéficiaire / affectation optionnelle).
 */
export class CloseMedicalClaimDto {
  @IsNumber()
  @IsPositive()
  amountReceived!: number;

  @IsOptional()
  @IsISO8601()
  reimbursementDate?: string;

  @IsUUID()
  reimbursementAccountId!: string;

  @IsOptional()
  @IsUUID()
  allocatedSavingsPocketId?: string;
}
