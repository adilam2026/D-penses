import { IsBoolean, IsISO8601, IsInt, IsNumber, IsOptional, IsPositive, IsUUID, Max, Min } from 'class-validator';

export class SimulatePurchaseDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsISO8601()
  date!: string;

  @IsUUID()
  accountId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  horizonDays?: number;

  @IsOptional()
  @IsBoolean()
  includeEnvisagedOptions?: boolean;
}
