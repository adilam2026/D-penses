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
          memberships: { include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } } },
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
   * Rejoindre un foyer via un code d'invitation. RG-001 : un utilisateur n'a
   * qu'un seul foyer actif en V1 — refuse si l'utilisateur en a déjà un.
   */
  async join(userId: string, currentHouseholdId: string | null, code: string) {
    if (currentHouseholdId) {
      throw new ConflictException('Ce compte est déjà rattaché à un foyer (un seul foyer actif en V1)');
    }
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

      return tx.household.findUniqueOrThrow({ where: { id: invite.householdId } });
    });
  }

  /** §8 — coussin de sécurité et autres paramètres foyer (HouseholdSettings, doc04 §P). */
  async updateSettings(userId: string, householdId: string, dto: UpdateHouseholdSettingsDto) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().householdSettings.update({
        where: { householdId },
        data: {
          securityMarginAmount: dto.securityMarginAmount,
          seuilAVenirDays: dto.seuilAVenirDays,
          seuilAPayerDays: dto.seuilAPayerDays,
          variableBudgetProjectionMode: dto.variableBudgetProjectionMode,
          homeBannerDismissed: dto.homeBannerDismissed,
        },
      }),
    );
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
