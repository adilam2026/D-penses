import { SetMetadata } from '@nestjs/common';

export const ALLOW_PIN_SETUP_KEY = 'allowPinSetup';

/**
 * Route accessible à un utilisateur authentifié qui n'a pas encore défini son
 * code à 6 chiffres (toutes les autres répondent 403 PIN_SETUP_REQUIRED).
 */
export const AllowPinSetup = () => SetMetadata(ALLOW_PIN_SETUP_KEY, true);
