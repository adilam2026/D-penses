import { IsISO8601, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class ConfirmMovementDto {
  @IsOptional()
  @IsISO8601()
  actualDate?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  actualAmount?: number;
}
