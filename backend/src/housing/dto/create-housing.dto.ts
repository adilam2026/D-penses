import { IsString, MinLength } from 'class-validator';

/** M8 (guard-rail §2) — ULTRA SIMPLE : uniquement le nom, jamais de fiche détaillée. */
export class CreateHousingDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
