import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const WINDOW_MS = 60_000;

/**
 * Protection complémentaire PAR ADRESSE IP des routes qui vérifient un code
 * (login, déverrouillage, changement/réinitialisation du code, OTP) : au plus
 * AUTH_IP_RATE_LIMIT requêtes par minute et par IP (20 par défaut). Mémoire
 * du processus : suffisant pour une instance unique ; la protection
 * principale reste le blocage par compte, persisté en base.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;

  constructor(config: ConfigService) {
    this.limit = Number(config.get('AUTH_IP_RATE_LIMIT', '20'));
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = request.ip ?? 'unknown';
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      throw new HttpException(
        { message: 'Trop de tentatives depuis cet appareil. Réessayez dans une minute.', code: 'TOO_MANY_REQUESTS' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) this.hits.delete(key);
    }
  }
}
