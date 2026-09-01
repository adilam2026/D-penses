import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

const ALLOCATION_MODE_VALUES = ['virtual_allocation', 'backed_by_account'] as const;

export class CreateProvisionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(ALLOCATION_MODE_VALUES)
  allocationMode!: (typeof ALLOCATION_MODE_VALUES)[number];

  @IsOptional()
  @IsUUID()
  linkedAccountId?: string;

  @IsOptional()
  @IsBoolean()
  isFlexible?: boolean;
}
