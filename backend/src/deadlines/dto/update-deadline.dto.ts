import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

const AMOUNT_STATUS_VALUES = ['inconnu', 'estime', 'confirme'] as const;

/**
 * Révision d'une Deadline (§11) : report de due_date (RG-020bis, jamais un
 * changement de statut) et/ou révision du montant (RG-104) — reste_a_payer se
 * recalcule automatiquement sur le nouveau montant, jamais sur l'ancien,
 * puisqu'il n'est jamais stocké (vue deadline_with_balance).
 */
export class UpdateDeadlineDto {
  @IsOptional()
  @IsISO8601()
  dueDate?: string;

  @IsOptional()
  @IsISO8601()
  expectedBillingDate?: string;

  @IsOptional()
  @IsISO8601()
  billingDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountCurrent?: number;

  @IsOptional()
  @IsIn(AMOUNT_STATUS_VALUES)
  amountStatus?: (typeof AMOUNT_STATUS_VALUES)[number];
}
