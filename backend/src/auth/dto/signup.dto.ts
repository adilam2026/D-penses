import { IsEmail, IsString, MinLength } from 'class-validator';

// Corrections UI/UX finales §17 — messages explicites en français pour
// chaque cas de validation (jamais le message par défaut class-validator en
// anglais) : le mobile affiche `data.message` tel quel sur un 400.
export class SignupDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email!: string;

  @IsString({ message: 'Le mot de passe doit contenir au moins 8 caractères' })
  @MinLength(8, { message: 'Le mot de passe doit contenir au moins 8 caractères' })
  password!: string;

  @IsString({ message: 'Le prénom est obligatoire' })
  @MinLength(1, { message: 'Le prénom est obligatoire' })
  firstName!: string;

  @IsString({ message: 'Le nom est obligatoire' })
  @MinLength(1, { message: 'Le nom est obligatoire' })
  lastName!: string;
}
