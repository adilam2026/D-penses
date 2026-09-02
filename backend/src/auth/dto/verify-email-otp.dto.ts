import { IsEmail, Matches } from 'class-validator';

export class VerifyEmailOtpDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres' })
  code!: string;
}
