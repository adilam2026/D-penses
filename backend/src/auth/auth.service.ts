import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { TokenService } from './token.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rlsContext: RlsContextService,
    private readonly tokens: TokenService,
  ) {}

  async signup(dto: SignupDto, userAgent?: string): Promise<AuthTokens> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });
    // Un utilisateur qui vient de s'inscrire n'a encore aucun foyer (RG-001).
    return this.issueTokens(user.id, null, userAgent);
  }

  async login(dto: LoginDto, userAgent?: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    // Recherche du foyer actif de l'utilisateur — nécessite le contexte RLS
    // (policy hm_self_visibility, cf. migration Lot 0) même sans household_id connu.
    const householdId = await this.rlsContext.run(user.id, null, async () => {
      const membership = await this.rlsContext.getClient().householdMembership.findFirst({
        where: { userId: user.id },
        orderBy: { joinedAt: 'asc' },
      });
      return membership?.householdId ?? null;
    });

    return this.issueTokens(user.id, householdId, userAgent);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({ where: { refreshTokenHash: hash } });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Session invalide ou révoquée');
    }
    const expired = Date.now() - session.createdAt.getTime() > this.tokens.refreshTtlMs();
    if (expired) {
      throw new UnauthorizedException('Session expirée');
    }

    // Rotation : l'ancien refresh token est révoqué, un nouveau est émis.
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    const householdId = await this.rlsContext.run(session.userId, null, async () => {
      const membership = await this.rlsContext.getClient().householdMembership.findFirst({
        where: { userId: session.userId },
        orderBy: { joinedAt: 'asc' },
      });
      return membership?.householdId ?? null;
    });

    return this.issueTokens(session.userId, householdId, session.userAgent ?? undefined);
  }

  /** Déconnexion — révoque uniquement la session courante (un seul appareil). */
  async logout(refreshToken: string): Promise<void> {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Déconnexion de tous les appareils (document 04 §S.1). */
  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Ré-émet un access token avec le foyer actif à jour, sans repasser par le mot de passe. */
  async reissueForHousehold(userId: string, householdId: string | null, userAgent?: string): Promise<AuthTokens> {
    return this.issueTokens(userId, householdId, userAgent);
  }

  private async issueTokens(userId: string, householdId: string | null, userAgent?: string): Promise<AuthTokens> {
    const accessToken = this.tokens.signAccessToken({ sub: userId, householdId });
    const { token: refreshToken, hash } = this.tokens.generateRefreshToken();
    await this.prisma.session.create({
      data: { userId, refreshTokenHash: hash, userAgent },
    });
    return { accessToken, refreshToken };
  }
}
