import { IsInt, Max, Min } from 'class-validator';

/** Début du mois financier (§ Paramètres) — 1 à 28 : jamais 29/30/31, qui n'existent pas dans tous les mois (février). */
export class UpdateHouseholdSettingsDto {
  @IsInt()
  @Min(1)
  @Max(28)
  monthStartDay!: number;
}
