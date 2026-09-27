import { IsDateString, IsOptional, IsString } from 'class-validator';

/** Objectif simple (§16) — sur un compte bancaire OU un sous-compte, jamais les deux (contrôlé au service). */
export class CreateGoalDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  subaccountId?: string;

  @IsString()
  targetAmount!: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  @IsOptional()
  @IsString()
  label?: string;
}
