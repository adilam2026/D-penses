import { IsIn, ValidateIf } from 'class-validator';
import { PERSON_COLOR_KEYS, PersonColorKey } from '../person-colors';

/** Couleur d'une personne (User.color) : une clé de la palette, ou null pour revenir au neutre. */
export class UpdateMemberColorDto {
  @ValidateIf((_, value) => value !== null)
  @IsIn(PERSON_COLOR_KEYS)
  color!: PersonColorKey | null;
}
