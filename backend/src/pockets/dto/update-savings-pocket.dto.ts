import { IsBoolean, IsISO8601, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

/** §22 : is_protected reste modifiable par une action utilisateur explicite (suspendre/réaffecter). */
export class UpdateSavingsPocketDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  targetAmount?: number;

  @IsOptional()
  @IsISO8601()
  targetDate?: string;

  @IsOptional()
  @IsBoolean()
  isProtected?: boolean;
}
