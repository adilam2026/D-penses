import { IsEmail, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  /** Code à 6 chiffres, ou ancien mot de passe tant que la transition n'est pas faite. */
  @IsString()
  @MaxLength(128)
  password!: string;
}
