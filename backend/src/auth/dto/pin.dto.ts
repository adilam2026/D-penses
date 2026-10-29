import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { PIN_PATTERN } from '../pin.util';

const PIN_MESSAGE = { message: 'Le code doit contenir exactement 6 chiffres' };

export class UnlockDto {
  @IsString()
  refreshToken!: string;

  @IsString()
  @MaxLength(128)
  pin!: string;
}

export class SetPinDto {
  /** Code actuel, ou ancien mot de passe pour la transition. */
  @IsString()
  @MaxLength(128)
  currentCredential!: string;

  @Matches(PIN_PATTERN, PIN_MESSAGE)
  newPin!: string;
}

export class PinResetRequestDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email!: string;
}

export class PinResetVerifyDto {
  @IsEmail({}, { message: 'Adresse email invalide' })
  email!: string;

  @Matches(/^\d{6}$/, { message: 'Le code contient 6 chiffres' })
  code!: string;
}

export class PinResetCompleteDto {
  @IsString()
  @MaxLength(256)
  resetToken!: string;

  @Matches(PIN_PATTERN, PIN_MESSAGE)
  newPin!: string;
}
