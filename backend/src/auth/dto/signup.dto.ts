import { IsEmail, IsString, Matches, MinLength } from 'class-validator';
import { PIN_PATTERN } from '../pin.util';

// Corrections UI/UX finales §17 — messages explicites en français pour
// chaque cas de validation (jamais le message par défaut class-validator en
// anglais) : le mobile affiche `data.message` tel quel sur un 400.
export class SignupDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email!: string;

  /** Code personnel : exactement 6 chiffres (plus de mot de passe à l'inscription). */
  @Matches(PIN_PATTERN, { message: 'Le code doit contenir exactement 6 chiffres' })
  password!: string;

  @IsString({ message: 'Le prénom est obligatoire' })
  @MinLength(1, { message: 'Le prénom est obligatoire' })
  firstName!: string;

  @IsString({ message: 'Le nom est obligatoire' })
  @MinLength(1, { message: 'Le nom est obligatoire' })
  lastName!: string;
}
