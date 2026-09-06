import { IsBoolean, IsString, MinLength } from 'class-validator';

/** §24 — action sensible : mot de passe + confirmation explicite exigés. */
export class ResetFinancialDataDto {
  @IsString()
  @MinLength(1)
  password!: string;

  @IsBoolean()
  confirm!: boolean;
}
