import { IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

const TYPE_VALUES = ['paiement', 'remboursement', 'ajustement'] as const;
const DIRECTION_VALUES = ['augmente_paye', 'diminue_paye'] as const;
const FUNDING_SOURCE_VALUES = ['compte', 'provision'] as const;

/** RG-015 : amount toujours strictement positif — le signe comptable est déduit du type par le moteur. */
export class CreatePaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsISO8601()
  paidDate?: string;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsIn(TYPE_VALUES)
  type?: (typeof TYPE_VALUES)[number];

  /** Requis uniquement si type = ajustement (RG-015). */
  @IsOptional()
  @IsIn(DIRECTION_VALUES)
  direction?: (typeof DIRECTION_VALUES)[number];

  /** Lot 2 : seul "compte" est implémenté ("provision" = Lot 6). */
  @IsOptional()
  @IsIn(FUNDING_SOURCE_VALUES)
  fundingSource?: (typeof FUNDING_SOURCE_VALUES)[number];

  @IsOptional()
  @IsString()
  notes?: string;
}
