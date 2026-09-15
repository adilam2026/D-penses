import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, MinLength, ValidateNested } from 'class-validator';

/**
 * Une ligne de budget voyage (§39/40 cadrage V1) : Transport, Hôtel, Alimentation,
 * Activités, Imprévus... Même convention que SchoolWizardItemDto — null/absent =
 * « je ne connais pas encore le montant » → amount_status = inconnu (jamais 0).
 */
export class TravelWizardItemDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsNumber()
  amount?: number | null;

  @IsISO8601()
  dueDate!: string;
}

export class TravelWizardDto {
  @IsString()
  @MinLength(1)
  label!: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsISO8601()
  periodStart!: string;

  @IsISO8601()
  periodEnd!: string;

  /** Enveloppe (Provision) à lier au plan dès sa création — facultatif, RG-112 (informatif). */
  @IsOptional()
  @IsUUID()
  linkedProvisionId?: string;

  /** M7+M8 (guard-rail §13) — participants du voyage : réutilise FinancialPlanBeneficiary existant, aucun nouveau modèle. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participantUserIds?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  participantChildIds?: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TravelWizardItemDto)
  items!: TravelWizardItemDto[];
}
