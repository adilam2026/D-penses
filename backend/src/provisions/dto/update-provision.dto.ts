import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class UpdateProvisionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isFlexible?: boolean;

  /** Lot 11 (§4) : corrige la localisation déclarée (informative en virtual_allocation, réelle en backed_by_account). */
  @IsOptional()
  @IsUUID()
  linkedAccountId?: string;
}
