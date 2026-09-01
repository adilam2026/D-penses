import { IsBoolean, IsIn, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

const ALLOCATION_MODE_VALUES = ['virtual_allocation', 'backed_by_account'] as const;

/**
 * RG-072 : linkedAccountId requis et exclusif si allocationMode = backed_by_account
 * (vérifié côté service, cf. PocketsService.create). RG-047 : hasRecurringContribution
 * n'est lu qu'à la création pour déterminer isProtected par défaut — jamais recalculé
 * automatiquement ensuite (une action explicite ultérieure peut le changer, PATCH).
 */
export class CreateSavingsPocketDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsUUID()
  ownerUserId?: string;

  @IsOptional()
  @IsUUID()
  beneficiaryChildId?: string;

  @IsIn(ALLOCATION_MODE_VALUES)
  allocationMode!: (typeof ALLOCATION_MODE_VALUES)[number];

  @IsOptional()
  @IsUUID()
  linkedAccountId?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @IsISO8601()
  targetDate?: string;

  /** RG-047 : déclare un versement récurrent pour cet enfant — déclenche is_protected=true par défaut. */
  @IsOptional()
  @IsBoolean()
  hasRecurringContribution?: boolean;

  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;
}
