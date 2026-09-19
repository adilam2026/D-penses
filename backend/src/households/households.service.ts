import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { UpdateHouseholdSettingsDto } from './dto/update-household-settings.dto';
import { SkipOnboardingStepDto } from './dto/skip-onboarding-step.dto';
import { ResetFinancialDataDto } from './dto/reset-financial-data.dto';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

@Injectable()
export class HouseholdsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  /**
   * Création d'un foyer. RG-002 : le créateur devient admin. Un HouseholdSettings
   * par défaut est créé dans la même transaction (document 02 §C.1).
   */
  async create(userId: string, name: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const householdId = crypto.randomUUID();
      // Le foyer n'existe pas encore : on connaît son id (généré côté application) avant
      // l'écriture, ce qui permet de fixer le contexte RLS avant l'INSERT plutôt qu'après
      // (la clause RETURNING de Prisma exige une policy SELECT satisfaite, cf. RlsContextService).
      await this.rlsContext.setHouseholdContext(householdId);
      const household = await tx.household.create({ data: { id: householdId, name } });
      await tx.householdMembership.create({
        data: { householdId: household.id, userId, role: 'admin' },
      });
      await tx.householdSettings.create({ data: { householdId: household.id } });
      return household;
    });
  }

  async getMine(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const household = await tx.household.findUnique({
        where: { id: householdId },
        include: {
          memberships: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true, color: true } } } },
          settings: true,
          children: true,
        },
      });
      if (!household) throw new NotFoundException('Foyer introuvable');
      return household;
    });
  }

  /** RG-002 : seul un admin peut inviter (droit non financier mais structurant). */
  async createInvite(userId: string, householdId: string, role: 'admin' | 'member' | 'read_only' = 'admin') {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const membership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId, userId } },
      });
      if (!membership || membership.role !== 'admin') {
        throw new ForbiddenException("Seul un administrateur du foyer peut créer une invitation");
      }
      const code = crypto.randomBytes(6).toString('base64url'); // court, facile à partager
      const invite = await tx.householdInvite.create({
        data: {
          householdId,
          code,
          role,
          createdById: userId,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
      return invite;
    });
  }

  /**
   * Rejoindre un foyer via un code d'invitation — ajoute un NOUVEAU membership.
   * RG-001 : un seul foyer ACTIF à la fois (jamais deux contextes RLS
   * simultanés) — cette contrainte reste intacte. Corrections consolidées §16 :
   * un utilisateur déjà rattaché à un foyer peut désormais en rejoindre un
   * AUTRE (changement de foyer actif), au lieu d'être bloqué en permanence sur
   * son tout premier foyer. L'ancien membership n'est JAMAIS supprimé ni son
   * foyer touché — seul le foyer ACTIF (User.activeHouseholdId) change,
   * données jamais mélangées (RLS reste scopée à un seul householdId par
   * requête, celui du token).
   * Corrections consolidées §17 : PAS de garde « unique membre » ici — un
   * ancien garde-fou reposait sur la prémisse erronée que rejoindre un autre
   * foyer équivaudrait à « quitter » le foyer actuel ; or le membership
   * existant n'est jamais supprimé, l'utilisateur reste administrateur de son
   * foyer d'origine et peut y revenir à tout moment via switchActive() —
   * aucune donnée ni aucun accès n'est jamais perdu, donc rien à bloquer.
   * "Rejoindre" (ce endpoint) crée un NOUVEAU membership via invitation ;
   * "Changer de foyer" (switchActive ci-dessous) choisit parmi les memberships
   * EXISTANTS, sans invitation — les deux concepts ne sont jamais mélangés.
   */
  async join(userId: string, code: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();

      const invite = await tx.householdInvite.findFirst({
        where: { code, usedAt: null, expiresAt: { gt: new Date() } },
      });
      if (!invite) {
        throw new NotFoundException('Invitation invalide, déjà utilisée ou expirée');
      }

      const existingMembership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId: invite.householdId, userId } },
      });
      if (existingMembership) {
        throw new ConflictException('Vous êtes déjà membre de ce foyer');
      }

      // Marquage atomique anti-course : n'affecte une ligne que si l'invitation
      // est toujours disponible au moment de l'écriture.
      const claimed = await tx.householdInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date(), usedById: userId },
      });
      if (claimed.count === 0) {
        throw new ConflictException('Invitation déjà utilisée entre-temps');
      }

      await tx.householdMembership.create({
        data: { householdId: invite.householdId, userId, role: invite.role },
      });

      // §16 — persiste le NOUVEAU foyer comme actif : sans ceci, le prochain
      // /auth/refresh (activeHouseholdId, rotation automatique côté mobile)
      // retomberait silencieusement sur le membership le plus ancien.
      await tx.user.update({ where: { id: userId }, data: { activeHouseholdId: invite.householdId } });

      return tx.household.findUniqueOrThrow({ where: { id: invite.householdId } });
    });
  }

  /**
   * Corrections consolidées §17 — liste tous les foyers dont l'utilisateur est
   * déjà membre (memberships EXISTANTS, jamais une invitation), avec le foyer
   * actif marqué — alimente un sélecteur « Changer de foyer » côté mobile.
   * Contexte RLS null : hm_self_visibility expose déjà toutes MES lignes de
   * membership, quel que soit le foyer actif de la requête.
   */
  async listMemberships(userId: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const [user, memberships] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: userId }, select: { activeHouseholdId: true } }),
        tx.householdMembership.findMany({
          where: { userId },
          include: { household: { select: { id: true, name: true } } },
          orderBy: { joinedAt: 'asc' },
        }),
      ]);
      return memberships.map((m) => ({
        householdId: m.householdId,
        name: m.household.name,
        role: m.role,
        isActive: m.householdId === user.activeHouseholdId,
      }));
    });
  }

  /**
   * Corrections consolidées §17 — « Changer de foyer actif » : choisit parmi
   * les memberships EXISTANTS de l'utilisateur, JAMAIS via un code
   * d'invitation — concept distinct de join() (qui crée un nouveau
   * membership). Aucune donnée déplacée ni supprimée : seul le pointeur
   * User.activeHouseholdId change, persisté pour survivre au prochain
   * /auth/refresh (cf. AuthService#activeHouseholdId).
   */
  async switchActive(userId: string, householdId: string) {
    return this.rlsContext.run(userId, null, async () => {
      const tx = this.rlsContext.getClient();
      const membership = await tx.householdMembership.findUnique({
        where: { householdId_userId: { householdId, userId } },
      });
      if (!membership) {
        throw new NotFoundException("Vous n'êtes pas membre de ce foyer");
      }
      await tx.user.update({ where: { id: userId }, data: { activeHouseholdId: householdId } });
      return tx.household.findUniqueOrThrow({ where: { id: householdId } });
    });
  }

  /** §8 — coussin de sécurité et autres paramètres foyer (HouseholdSettings, doc04 §P). */
  async updateSettings(userId: string, householdId: string, dto: UpdateHouseholdSettingsDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const current = await tx.householdSettings.findUniqueOrThrow({ where: { householdId } });

      // Lot 6 — changement RÉEL de closingDay (jamais un simple envoi de la même
      // valeur) : avant de l'appliquer, fige l'ancien closingDay dans un nouveau
      // segment pour chaque budget mensuel FINANCIAL du foyer, afin que la
      // garantie de non-rétroactivité Lot 4 tienne aussi pour ce champ externe
      // (cf. resolveFinancialClosingDay — jamais de repli implicite vers le live).
      if (dto.closingDay !== undefined && dto.closingDay !== current.closingDay) {
        // Un seul timestamp `now`, réutilisé pour TOUS les segments créés dans
        // cette transaction — même frontière temporelle pour tous les budgets
        // impactés (jamais un `new Date()` distinct par itération de la boucle).
        const now = new Date();
        const budgets = await tx.variableBudget.findMany({
          where: { householdId, referencePeriod: 'mois', monthMode: 'financier' },
        });
        for (const budget of budgets) {
          const lastVersion = await tx.variableBudgetVersion.findFirst({
            where: { variableBudgetId: budget.id },
            orderBy: { validTo: 'desc' },
          });
          const validFrom = lastVersion?.validTo ?? budget.createdAt;
          await tx.variableBudgetVersion.create({
            data: {
              variableBudgetId: budget.id,
              referenceAmount: budget.referenceAmount,
              referencePeriod: budget.referencePeriod,
              categoryId: budget.categoryId,
              categoryTypeId: budget.categoryTypeId,
              weekStartDay: budget.weekStartDay,
              monthMode: budget.monthMode,
              customStartDay: budget.customStartDay,
              financialClosingDaySnapshot: current.closingDay, // l'ancien, sur le point d'être remplacé
              includeInPrudentProjection: budget.includeInPrudentProjection,
              endDate: budget.endDate,
              validFrom,
              validTo: now,
            },
          });
        }
      }

      return tx.householdSettings.update({
        where: { householdId },
        data: {
          securityMarginAmount: dto.securityMarginAmount,
          seuilAVenirDays: dto.seuilAVenirDays,
          seuilAPayerDays: dto.seuilAPayerDays,
          variableBudgetProjectionMode: dto.variableBudgetProjectionMode,
          homeBannerDismissed: dto.homeBannerDismissed,
          closingDay: dto.closingDay,
          weekStartDay: dto.weekStartDay,
        },
      });
    });
  }

  /**
   * Vague 3 §25/§28 — marque une étape d'onboarding comme volontairement ignorée
   * ("non applicable" / "plus tard"), partagée entre tous les adultes du foyer.
   * Idempotent (push seulement si absente) — jamais de doublon dans le tableau.
   */
  async skipOnboardingStep(userId: string, householdId: string, dto: SkipOnboardingStepDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const settings = await tx.householdSettings.findUniqueOrThrow({ where: { householdId } });
      if (settings.onboardingSkippedSteps.includes(dto.step)) return settings;
      return tx.householdSettings.update({
        where: { householdId },
        data: { onboardingSkippedSteps: { push: dto.step } },
      });
    });
  }

  /**
   * §24 — Réinitialiser mes données financières. Action sensible : réservée à un
   * administrateur du foyer (même garde que createInvite, seul précédent existant —
   * aucun rôle inventé), exige le mot de passe du compte + confirmation explicite.
   * Toute l'opération tourne dans la transaction ouverte par rlsContext.run() :
   * un rejet (mauvais mot de passe, rôle insuffisant) annule tout, sans exception.
   *
   * Conservé : compte utilisateur, foyer, membres, enfants, invitations, catégories
   * (système et personnalisées) + types/sous-types, paramètres du foyer, sessions.
   * Supprimé : tout ce qui est financier. Ordre de suppression respectant les
   * contraintes RESTRICT existantes (adhoc_expense/budget_expense/income_source/
   * payment → financial_account) — chaque table restrictive est vidée par cascade
   * AVANT le compte, jamais l'inverse.
   */
  async resetFinancialData(userId: string, householdId: string, dto: ResetFinancialDataDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      const membership = await tx.householdMembership.findUnique({ where: { householdId_userId: { householdId, userId } } });
      if (!membership || membership.role !== 'admin') {
        throw new ForbiddenException('Seul un administrateur du foyer peut réinitialiser les données financières');
      }
      if (dto.confirm !== true) {
        throw new ForbiddenException('Confirmation explicite requise');
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
      if (!validPassword) {
        throw new UnauthorizedException('Mot de passe incorrect');
      }

      await tx.accountTransfer.deleteMany({ where: { householdId } });
      await tx.adHocExpense.deleteMany({ where: { householdId } });
      await tx.goal.deleteMany({ where: { householdId } });
      await tx.financialPlan.deleteMany({ where: { householdId } }); // cascade → financial_plan_beneficiary
      await tx.chargePlan.deleteMany({ where: { householdId } }); // cascade → deadline → payment/charge_plan_child/deadline_child_allocation
      await tx.variableBudget.deleteMany({ where: { householdId } }); // cascade → budget_expense
      await tx.incomeSource.deleteMany({ where: { householdId } }); // cascade → income_occurrence
      await tx.savingsPocket.deleteMany({ where: { householdId } }); // cascade → pocket_movement
      await tx.provision.deleteMany({ where: { householdId } }); // cascade → pocket_movement
      await tx.financialAccount.deleteMany({ where: { householdId } }); // cascade → account_balance_snapshot/reconciliation/adjustment

      return { success: true };
    });
  }
}
