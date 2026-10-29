import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/** Échecs consécutifs avant blocage. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Durée du 1er, 2e, 3e puis de chaque blocage suivant (plafond 30 min). */
export const LOCK_DURATIONS_MS = [1, 5, 15, 30].map((minutes) => minutes * 60_000);

export interface LockState {
  lockedUntil: Date | null;
}

/**
 * Limitation des tentatives PAR COMPTE, persistée en base (jamais
 * contournable en fermant/réinstallant l'application) et partagée par
 * toutes les vérifications du code personnel : login, déverrouillage,
 * changement de code. 5 échecs -> blocage 1 min, la série suivante 5 min,
 * puis 15 min, puis 30 min maximum ; un succès remet tout à zéro.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bloque AVANT toute comparaison : même le bon code est refusé pendant un blocage. */
  assertNotLocked(user: LockState, now = new Date()): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > now.getTime()) {
      const retryAfterSeconds = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000);
      const minutes = Math.ceil(retryAfterSeconds / 60);
      throw new HttpException(
        {
          message: `Trop de tentatives. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`,
          code: 'TOO_MANY_ATTEMPTS',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(userId: string, now = new Date()): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true, lockLevel: true },
    });
    if (updated.failedLoginCount < MAX_FAILED_ATTEMPTS) return;
    const duration = LOCK_DURATIONS_MS[Math.min(updated.lockLevel, LOCK_DURATIONS_MS.length - 1)];
    // Condition dans le WHERE : deux échecs simultanés ne déclenchent jamais
    // deux blocages (le second ne voit plus failed_login_count >= 5).
    await this.prisma.user.updateMany({
      where: { id: userId, failedLoginCount: { gte: MAX_FAILED_ATTEMPTS } },
      data: { failedLoginCount: 0, lockLevel: { increment: 1 }, lockedUntil: new Date(now.getTime() + duration) },
    });
  }

  async recordSuccess(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockLevel: 0, lockedUntil: null },
    });
  }
}
