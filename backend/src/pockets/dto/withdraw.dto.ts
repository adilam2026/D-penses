import { IsISO8601, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';

export class WithdrawDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsString()
  intentionLabel?: string;
}
