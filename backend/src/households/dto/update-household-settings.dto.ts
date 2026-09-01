import { IsIn, IsInt, IsNumber, IsOptional, Min } from 'class-validator';

const PROJECTION_MODES = ['contractuel', 'rythme_reel', 'prudent_max'] as const;

/** Coussin de sécurité (§8, HouseholdSettings.security_margin_amount) et autres paramètres foyer. */
export class UpdateHouseholdSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  securityMarginAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  seuilAVenirDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  seuilAPayerDays?: number;

  @IsOptional()
  @IsIn(PROJECTION_MODES)
  variableBudgetProjectionMode?: (typeof PROJECTION_MODES)[number];
}
