import { IsUUID } from 'class-validator';

/** Corrections consolidées §17 — cible un membership EXISTANT, jamais un code d'invitation. */
export class SwitchActiveHouseholdDto {
  @IsUUID()
  householdId!: string;
}
