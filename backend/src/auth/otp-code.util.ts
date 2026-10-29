import * as crypto from 'node:crypto';

/** Génération des codes email à 6 chiffres (objet pour pouvoir la rendre prévisible en test). */
export const otpCodes = {
  generate(): string {
    return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  },
};
