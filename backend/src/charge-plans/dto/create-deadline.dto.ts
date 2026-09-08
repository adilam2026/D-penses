import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsUUID, ValidateNested } from 'class-validator';

const AMOUNT_STATUS_VALUES = ['inconnu', 'estime', 'confirme'] as const;

/**
 * R6.2 (§4-9) : "échéance déjà payée" — une dépense réglée AVANT d'être
 * saisie dans l'app. accountId reste facultatif (CAS A : compte connu, débite
 * l'historique normalement ; CAS B : compte inconnu, aucun débit artificiel
 * du solde actuel — cf. already-paid.util.ts).
 */
export class AlreadyPaidDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsISO8601()
  paidDate!: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

export class CreateDeadlineDto {
  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsISO8601()
  expectedBillingDate?: string;

  @IsOptional()
  @IsISO8601()
  billingDate?: string;

  /** Obligatoire sauf si amountStatus = inconnu (RG-102/103), ou si alreadyPaid est fourni. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountCurrent?: number;

  @IsOptional()
  @IsIn(AMOUNT_STATUS_VALUES)
  amountStatus?: (typeof AMOUNT_STATUS_VALUES)[number];

  /**
   * R6.2 (§4-9) : si fourni, crée directement une échéance soldée + son
   * Payment historique (jamais une échéance ouverte) — amountCurrent/
   * amountStatus sont alors ignorés (le montant réellement payé fait foi).
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => AlreadyPaidDto)
  alreadyPaid?: AlreadyPaidDto;
}
