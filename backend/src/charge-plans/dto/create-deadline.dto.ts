import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

const AMOUNT_STATUS_VALUES = ['inconnu', 'estime', 'confirme'] as const;

export class CreateDeadlineDto {
  @IsISO8601()
  dueDate!: string;

  @IsOptional()
  @IsISO8601()
  expectedBillingDate?: string;

  @IsOptional()
  @IsISO8601()
  billingDate?: string;

  /** Obligatoire sauf si amountStatus = inconnu (RG-102/103). */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amountCurrent?: number;

  @IsOptional()
  @IsIn(AMOUNT_STATUS_VALUES)
  amountStatus?: (typeof AMOUNT_STATUS_VALUES)[number];
}
