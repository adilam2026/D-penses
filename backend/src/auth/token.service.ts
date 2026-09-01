import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';

export interface AccessTokenPayload {
  sub: string;
  householdId: string | null;
}

/** Parse une durée simple "15m" | "30d" | "1h" en millisecondes. */
export function parseDurationMs(input: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(input.trim());
  if (!match) throw new Error(`Durée invalide: ${input}`);
  const value = Number(match[1]);
  const unit = match[2];
  const factor = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * factor;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL', '15m'),
    });
  }

  /**
   * Retourne le refresh token en clair (à renvoyer une seule fois au client) + son hash
   * (à stocker, recherchable). L'entropie vient du token lui-même (48 octets aléatoires) —
   * un hash déterministe (SHA-256) suffit et permet une recherche directe en base,
   * contrairement à un hash de mot de passe salé.
   */
  generateRefreshToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(48).toString('hex');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  refreshTtlMs(): number {
    return parseDurationMs(this.config.get('JWT_REFRESH_TTL', '30d'));
  }
}
