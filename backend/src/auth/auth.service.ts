import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OtpPurpose, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { TokenService } from './token.service';
import { MailerService, EmailDeliveryError } from './mailer.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { LoginAttemptsService } from './login-attempts.service';
import { isTrivialPin, PIN_PATTERN } from './pin.util';
import { otpCodes } from './otp-code.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Résultat d'une authentification : jetons + ce que le mobile doit savoir de l'utilisateur. */
export interface AuthResult extends AuthTokens {
  /** true = ancien mot de passe : l'application impose la création du code à 6 chiffres. */
  mustSetPin: boolean;
  user: { id: string; firstName: string };
}

export interface SessionInfo {
  userId: string;
  firstName: string;
  /** Conservé par le mobile pour se reconnecter sans le redemander — jamais affiché en clair. */
  email: string;
  mustSetPin: boolean;
}

export interface SignupPendingVerification {
  requiresEmailVerification: true;
  email: string;
}

const OTP_TTL_MS = 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
/** Délai pour définir le nouveau code après vérification du code de réinitialisation. */
const PIN_RESET_WINDOW_MS = 10 * 60 * 1000;
const BCRYPT_COST = 12;


@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rlsContext: RlsContextService,
    private readonly tokens: TokenService,
    private readonly mailer: MailerService,
    private readonly attempts: LoginAttemptsService,
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
    const email = dto.email;
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing && existing.emailVerifiedAt) {
      throw new ConflictException('Un compte existe déjà avec cet email');
    }

    // Le credential d'inscription est directement le code personnel à 6 chiffres.
    this.assertPinAcceptable(dto.password);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const pinSetAt = new Date();
    let user;
    try {
      user = existing
        ? await this.prisma.user.update({
            where: { id: existing.id },
            data: { passwordHash, pinSetAt, firstName: dto.firstName, lastName: dto.lastName },
          })
        : await this.prisma.user.create({
            data: { email, passwordHash, pinSetAt, firstName: dto.firstName, lastName: dto.lastName },
          });
    } catch (err) {
      // Garde-fou concurrence (§17) : deux inscriptions simultanées avec le même
      // email peuvent toutes deux passer le SELECT ci-dessus avant qu'aucune
      // n'écrive — la contrainte unique tranche alors côté base. Jamais une 500
      // opaque pour ce cas, une réponse métier propre comme le conflit normal.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Un compte existe déjà avec cet email');
      }
      throw err;
    }

    // L'envoi du code de vérification est un effet de bord vers un service tiers
    // (Resend). Correction (point 2, révision) : le compte reste créé en base
    // même si l'envoi échoue réellement (rien à rejouer), mais la réponse HTTP
    // reflète désormais fidèlement cet échec (503 via createAndSendOtp
    // ci-dessous) — jamais un succès trompeur qui laisserait croire à un email
    // envoyé alors qu'il ne l'a pas été.
    await this.createAndSendOtp(user.id, user.email, 'EMAIL_VERIFICATION');

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
  async verifyEmailOtp(email: string, code: string, userAgent?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Aucun compte ne correspond à cet email');

    // Compte déjà confirmé (double-tap, ou tentative de rejouer un OTP consommé) :
    // jamais de nouvelle session à partir d'un code — réponse métier contrôlée,
    // le client doit s'appuyer sur la session déjà obtenue au premier succès.
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
    }

    // Seul un code de CONFIRMATION D'INSCRIPTION est accepté ici (jamais un code de réinitialisation).
    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId: user.id, consumedAt: null, purpose: 'EMAIL_VERIFICATION' },
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

    return this.authResult(user, null, userAgent);
  }

  /**
   * « Renvoyer le code » (§8) — jamais pour un compte déjà confirmé (celui-ci se
   * connecte normalement).
   *
   * Correction (point 2, révision) — un nouveau code est toujours généré/persisté
   * AVANT toute tentative d'envoi (jamais perdu même si l'envoi échoue). Si le
   * mailer échoue réellement (provider configuré mais qui refuse l'envoi),
   * createAndSendOtp() traduit cela en 503 explicite — jamais un 200 trompeur
   * qui ferait croire à un email envoyé alors qu'il ne l'a pas été. Même
   * garantie que signup() (même méthode partagée, jamais dupliquée).
   */
  async resendEmailOtp(email: string): Promise<{ email: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new NotFoundException('Aucun compte ne correspond à cet email');
    if (user.emailVerifiedAt) {
      throw new BadRequestException('Cet email est déjà confirmé — connectez-vous avec votre mot de passe');
    }
    await this.createAndSendOtp(user.id, user.email, 'EMAIL_VERIFICATION');
    return { email: user.email };
  }

  /**
   * Génère et persiste toujours le code OTP (jamais protégé par le try/catch
   * ci-dessous : une vraie panne base de données doit rester une 500 visible,
   * jamais masquée) — le code créé en base est donc TOUJOURS indépendant du
   * succès de l'envoi (distinction explicite demandée : « OTP créé » ≠
   * « email réellement accepté par le provider »).
   *
   * Correction (point 2, révision) — l'ancienne version avalait TOUTE panne
   * mailer, y compris un vrai refus du provider (Resend : domaine non
   * vérifié, clé invalide, service indisponible), et renvoyait malgré tout un
   * succès HTTP : l'utilisateur croyait le code envoyé alors qu'il ne l'était
   * pas, sans aucun moyen de le savoir. Seul le cas RESEND_API_KEY absent
   * (dev local/CI/tests, cf. MailerService) reste un no-op silencieux — un
   * EmailDeliveryError (provider réellement configuré mais qui refuse
   * l'envoi) est désormais traduit en erreur HTTP contrôlée et compréhensible
   * (503), jamais masquée comme un faux succès. Le code reste néanmoins
   * consultable/réessayable via "Renvoyer le code" (rien n'est perdu).
   */
  private async createAndSendOtp(userId: string, email: string, purpose: OtpPurpose): Promise<void> {
    // Une seule ligne "vivante" à la fois PAR USAGE : un nouveau code invalide
    // silencieusement les précédents du même usage.
    await this.prisma.emailOtp.updateMany({ where: { userId, purpose, consumedAt: null }, data: { consumedAt: new Date() } });

    const code = otpCodes.generate();
    const codeHash = await bcrypt.hash(code, 10);
    await this.prisma.emailOtp.create({
      data: { userId, purpose, codeHash, expiresAt: new Date(Date.now() + OTP_TTL_MS) },
    });

    try {
      await this.mailer.sendOtpEmail(email, code, purpose);
    } catch (err) {
      if (err instanceof EmailDeliveryError) {
        this.logger.error(
          `Échec RÉEL de l'envoi du code (${purpose}) à ${email} (code créé en base, consultable via "Renvoyer le code")`,
          err.stack,
        );
        if (purpose === 'PIN_RESET') {
          throw new ServiceUnavailableException("L'email de réinitialisation n'a pas pu être envoyé pour le moment. Réessayez dans quelques instants.");
        }
        throw new ServiceUnavailableException(
          "Votre compte est créé, mais l'email de vérification n'a pas pu être envoyé pour le moment (service d'emailing indisponible). Réessayez dans quelques instants avec « Renvoyer le code ».",
        );
      }
      throw err;
    }
  }

  /**
   * Connexion avec le code à 6 chiffres — ou, tant que la transition n'est
   * pas faite (pin_set_at NULL), avec l'ancien mot de passe : mustSetPin=true
   * et tout le reste de l'API répond 403 PIN_SETUP_REQUIRED jusqu'à la
   * création du code. Blocage par compte vérifié AVANT toute comparaison.
   */
  async login(dto: LoginDto, userAgent?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    this.attempts.assertNotLocked(user);
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      await this.attempts.recordFailure(user.id);
      throw new UnauthorizedException('Identifiants invalides');
    }
    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException('Adresse email non confirmée — saisissez le code reçu par email');
    }
    await this.attempts.recordSuccess(user.id);

    return this.authResult(user, await this.activeHouseholdId(user.id), userAgent);
  }

  /**
   * Déverrouillage de l'application : vérifie le code de l'utilisateur DE
   * CETTE SESSION côté serveur (jamais un code local), puis fait tourner le
   * refresh token. Même blocage par compte que login.
   */
  async unlock(refreshToken: string, pin: string, userAgent?: string): Promise<AuthResult> {
    const session = await this.findLiveSession(refreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
    this.attempts.assertNotLocked(user);
    const valid = await bcrypt.compare(pin, user.passwordHash);
    if (!valid) {
      await this.attempts.recordFailure(user.id);
      throw new UnauthorizedException({ message: 'Code incorrect', code: 'INVALID_PIN' });
    }
    await this.attempts.recordSuccess(user.id);
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.authResult(user, await this.activeHouseholdId(user.id), userAgent ?? session.userAgent ?? undefined);
  }

  /** Identité de la session courante — accessible même avant la création du code. */
  async sessionInfo(userId: string): Promise<SessionInfo> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { userId: user.id, firstName: user.firstName, email: user.email, mustSetPin: !user.pinSetAt };
  }

  /**
   * Définit (transition depuis l'ancien mot de passe) ou change le code à 6
   * chiffres. Le credential actuel est TOUJOURS revérifié, avec le blocage
   * par compte. Le nouveau code remplace password_hash (bcrypt) ; toutes les
   * sessions sont révoquées et une nouvelle est émise pour cet appareil.
   */
  async setPin(userId: string, currentCredential: string, newPin: string, userAgent?: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    this.attempts.assertNotLocked(user);
    const valid = await bcrypt.compare(currentCredential, user.passwordHash);
    if (!valid) {
      await this.attempts.recordFailure(user.id);
      throw new UnauthorizedException({ message: 'Code ou mot de passe actuel incorrect', code: 'INVALID_CREDENTIAL' });
    }
    this.assertPinAcceptable(newPin);
    if (user.pinSetAt && newPin === currentCredential) {
      throw new BadRequestException('Choisissez un code différent du code actuel');
    }
    const passwordHash = await bcrypt.hash(newPin, BCRYPT_COST);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, pinSetAt: new Date(), failedLoginCount: 0, lockLevel: 0, lockedUntil: null },
      }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return this.authResult({ ...user, pinSetAt: new Date() }, await this.activeHouseholdId(user.id), userAgent);
  }

  /**
   * « Code oublié ? » — étape 1. Réponse identique que le compte existe ou
   * non (aucune énumération des emails) ; un code PIN_RESET n'est envoyé qu'à
   * un compte existant et confirmé.
   */
  async requestPinReset(email: string): Promise<{ sent: true }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.emailVerifiedAt) {
      await this.createAndSendOtp(user.id, user.email, 'PIN_RESET');
    }
    return { sent: true };
  }

  /**
   * Étape 2 : vérifie le code reçu par email (usage PIN_RESET uniquement,
   * 5 essais, 15 min) et remet un jeton à usage unique valable 10 minutes
   * pour définir le nouveau code.
   */
  async verifyPinReset(email: string, code: string): Promise<{ resetToken: string }> {
    const invalid = () => new BadRequestException('Ce code est invalide ou a expiré');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw invalid();
    const otp = await this.prisma.emailOtp.findFirst({
      where: { userId: user.id, purpose: 'PIN_RESET', consumedAt: null, verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt.getTime() < Date.now()) throw invalid();
    if (otp.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Trop de tentatives — demandez un nouveau code');
    }
    const valid = await bcrypt.compare(code, otp.codeHash);
    if (!valid) {
      await this.prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw invalid();
    }
    const { token: resetToken, hash } = this.tokens.generateRefreshToken();
    const marked = await this.prisma.emailOtp.updateMany({
      where: { id: otp.id, consumedAt: null, verifiedAt: null },
      data: { verifiedAt: new Date(), resetTokenHash: hash },
    });
    if (marked.count === 0) throw invalid();
    return { resetToken };
  }

  /**
   * Étape 3 : définit le nouveau code. Le jeton est consommé atomiquement
   * (usage unique), le blocage de tentatives est levé (possession de l'email
   * prouvée), TOUTES les sessions sont révoquées et une nouvelle est émise.
   */
  async completePinReset(resetToken: string, newPin: string, userAgent?: string): Promise<AuthResult> {
    const expired = () => new BadRequestException('Demande expirée — recommencez « Code oublié ? »');
    const otp = await this.prisma.emailOtp.findUnique({ where: { resetTokenHash: this.tokens.hashRefreshToken(resetToken) } });
    if (!otp || otp.purpose !== 'PIN_RESET' || otp.consumedAt || !otp.verifiedAt) throw expired();
    if (Date.now() - otp.verifiedAt.getTime() > PIN_RESET_WINDOW_MS) throw expired();
    this.assertPinAcceptable(newPin);
    const passwordHash = await bcrypt.hash(newPin, BCRYPT_COST);
    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.emailOtp.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: now } });
      if (consumed.count === 0) return false;
      await tx.user.update({
        where: { id: otp.userId },
        data: { passwordHash, pinSetAt: now, failedLoginCount: 0, lockLevel: 0, lockedUntil: null },
      });
      await tx.session.updateMany({ where: { userId: otp.userId, revokedAt: null }, data: { revokedAt: now } });
      return true;
    });
    if (!done) throw expired();
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: otp.userId } });
    return this.authResult(user, await this.activeHouseholdId(user.id), userAgent);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.findLiveSession(refreshToken);

    // Rotation : l'ancien refresh token est révoqué, un nouveau est émis.
    await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });

    return this.issueTokens(session.userId, await this.activeHouseholdId(session.userId), session.userAgent ?? undefined);
  }

  private async findLiveSession(refreshToken: string) {
    const hash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findFirst({ where: { refreshTokenHash: hash } });
    if (!session || session.revokedAt) {
      throw new UnauthorizedException({ message: 'Session invalide ou révoquée', code: 'SESSION_INVALID' });
    }
    const expired = Date.now() - session.createdAt.getTime() > this.tokens.refreshTtlMs();
    if (expired) {
      throw new UnauthorizedException({ message: 'Session expirée', code: 'SESSION_INVALID' });
    }
    return session;
  }

  private assertPinAcceptable(pin: string): void {
    if (!PIN_PATTERN.test(pin)) {
      throw new BadRequestException('Le code doit contenir exactement 6 chiffres');
    }
    if (isTrivialPin(pin)) {
      throw new BadRequestException('Ce code est trop simple — évitez les chiffres identiques ou qui se suivent');
    }
  }

  private async authResult(
    user: { id: string; firstName: string; pinSetAt: Date | null },
    householdId: string | null,
    userAgent?: string,
  ): Promise<AuthResult> {
    const tokens = await this.issueTokens(user.id, householdId, userAgent);
    return { ...tokens, mustSetPin: !user.pinSetAt, user: { id: user.id, firstName: user.firstName } };
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
  // Corrections consolidées §16 — priorité à User.activeHouseholdId (persisté
  // explicitement par HouseholdsService.join() lors d'un changement de foyer),
  // UNIQUEMENT si un membership valide existe encore pour ce foyer (jamais un
  // foyer fantôme si la ligne a été retirée entre-temps) ; repli sur le
  // membership le plus ancien — comportement historique inchangé pour tout
  // utilisateur qui n'a jamais changé de foyer actif.
  private async activeHouseholdId(userId: string): Promise<string | null> {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const user = await tx.user.findUnique({ where: { id: userId }, select: { activeHouseholdId: true } });
      if (user?.activeHouseholdId) {
        const activeMembership = await tx.householdMembership.findUnique({
          where: { householdId_userId: { householdId: user.activeHouseholdId, userId } },
        });
        if (activeMembership) return user.activeHouseholdId;
      }
      const membership = await tx.householdMembership.findFirst({
        where: { userId },
        orderBy: { joinedAt: 'asc' },
      });
      return membership?.householdId ?? null;
    });
  }

  private async issueTokens(userId: string, householdId: string | null, userAgent?: string): Promise<AuthTokens> {
    // pinRequired relu en base à chaque émission (login, refresh, changement de foyer).
    const { pinSetAt } = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { pinSetAt: true } });
    const accessToken = this.tokens.signAccessToken({ sub: userId, householdId, pinRequired: !pinSetAt });
    const { token: refreshToken, hash } = this.tokens.generateRefreshToken();
    await this.prisma.session.create({
      data: { userId, refreshTokenHash: hash, userAgent },
    });
    return { accessToken, refreshToken };
  }
}
