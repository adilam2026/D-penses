import { IsString, MinLength } from 'class-validator';

/** M7 (guard-rail §1) — ULTRA SIMPLE : uniquement le nom, jamais de fiche technique. */
export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  name!: string;
}
