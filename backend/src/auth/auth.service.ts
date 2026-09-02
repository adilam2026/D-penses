import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { TokenService } from './token.service';
import { MailerService } from './mailer.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface SignupPendingVerification {
  requiresEmailVerification: true;
  email: string;
}

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

function generateOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rlsContext: RlsContextService,
    private readonly tokens: TokenService,
    private readonly mailer: MailerService,
  ) {}

  /**
   * Crée le compte (mot de passe conservé — cette application n'est pas
   * passwordless) mais n'émet AUCUN token : email_verified_at reste NULL tant
   * que le code OTP à 6 chiffres n'est pas validé (verifyEmailOtp). Ni session
   * ni foyer ne peuvent donc jamais être créés avant confirmation réelle de
   * l'adresse email — aucune fenêtre où un état partiel serait exploitable.
   *
   * Un email déjà inscrit mais jamais confirmé n'est PAS un conflit : c'est le
   * même parcours d'inscription repris (mot de passe/nom mis à jour, nouveau
   * code envoyé) — seul un email déjà confirmé déclenche ConflictException.
   */
  async signup(dto: SignupDto): Promise<SignupPendingVerification> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing && existing.emailVerifiedAt) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          data: { passwordHash, firstName: dto.firstName, lastName: dto.lastName },
        })
      : await this.prisma.user.create({
          data: { email: dto.email, passwordHash, firstName: dto.firstName, lastName: dto.lastName },
        });

    await this.createAndSendOtp(user.id, user.email);
    return { requiresEmailVerification: true, email: user.email };
  }

  /**
   * Seul point d'entrée qui fait apparaître une session réelle pour un compte
   * fraîchement inscrit — après ce succès uniquement : email_verified_at posé,
   * OTP consommé, tokens émis (§4 : jamais de matching fragile sur un message
   * texte, toujours le code stocké/haché comparé explicitement). Un OTP est
   * strictement à usage unique : une fois consommé, AUCUN appel ultérieur —
   * même avec le même code, même pour ce même compte — ne peut plus réémettre
   * de session à partir de lui (correctif sécurité : l'ancienne version
   * réémettait une session pour tout compte déjà confirmé sans même vérifier
   * le code fourni).
   */
  async verifyEmailOtp(email: string, code: string, userAgent?: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Aucun compte ne correspond à cet email');

    // Compte déjà confirmé (double-tap, ou tentative de rejouer un OTP consommé) :
    // jamais de nouvelle session à partir d'un code — réponse métier contrôlée,
    // le client doit s'appuyer sur la session déjà obtenue au premier succès.
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
    }

    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId: user.id, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) {
      throw new BadRequestException('Aucun code en attente — demandez un nouveau code');
    }
    if (otp.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Ce code est invalide ou a expiré');
    }
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Trop de tentatives — demandez un nouveau code');
    }

    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) {
      await this.prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Ce code est invalide ou a expiré');
    }

    // Consommation atomique : l'UPDATE porte la condition consumedAt=NULL dans son
    // propre WHERE (jamais un SELECT puis UPDATE séparés) — sous Postgres, deux
    // requêtes concurrentes qui ciblent la même ligne se sérialisent au niveau ligne ;
    // la seconde ne voit plus consumedAt=NULL une fois la première validée et échoue
    // avec count=0. Un seul appel peut donc jamais gagner la course, quel que soit le
    // nombre de requêtes simultanées avec le même code.
    const verified = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailOtp.updateMany({
        where: { id: otp.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count === 0) return false;
      await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      return true;
    });
    if (!verified) {
      throw new BadRequestException('Ce code est invalide ou a expiré');
    }

    return this.issueTokens(user.id, null, userAgent);
  }

  /** « Renvoyer le code » (§8) — jamais pour un compte déjà confirmé (celui-ci se connecte normalement). */
  async resendEmailOtp(email: string): Promise<{ email: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Aucun compte ne correspond à cet email');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
    }
    await this.createAndSendOtp(user.id, user.email);
    return { email: user.email };
  }

  private async createAndSendOtp(userId: string, email: string): Promise<void> {
    // Une seule ligne "vivante" à la fois : un nouveau code invalide silencieusement
    // les précédents plutôt que de laisser plusieurs codes simultanément valides.
    await this.prisma.emailOtp.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });

    const code = generateOtpCode();
    const codeHash = await bcrypt.hash(code, 10);
    await this.prisma.emailOtp.create({
      data: { userId, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });
    await this.mailer.sendOtpEmail(email, code);
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
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Adresse email non confirmée — saisissez le code reçu par email');
    }

    return this.issueTokens(user.id, await this.activeHouseholdId(user.id), userAgent);
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

    return this.issueTokens(session.userId, await this.activeHouseholdId(session.userId), session.userAgent ?? undefined);
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

  // Recherche du foyer actif de l'utilisateur — nécessite le contexte RLS
  // (policy hm_self_visibility, cf. migration Lot 0) même sans household_id connu.
  private async activeHouseholdId(userId: string): Promise<string | null> {
    return this.rlsContext.run(userId, null, async () => {
      const membership = await this.rlsContext.getClient().householdMembership.findFirst({
        where: { userId },
        orderBy: { joinedAt: 'asc' },
      });
      return membership?.householdId ?? null;
    });
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
