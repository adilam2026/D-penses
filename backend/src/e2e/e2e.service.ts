import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { HouseholdsService } from '../households/households.service';
import { seedBaselineHouseholdData } from './e2e-seed-data.util';

/** Doit rester identique à backend/prisma/seed.ts (même foyer de démonstration, réutilisé comme foyer E2E). */
const DEFAULT_E2E_EMAIL = 'demo@finance-maison.local';

/**
 * Réinitialisation des données E2E (recette Maestro, staging uniquement) —
 * jamais activée en PROD :
 * - `E2E_TEST_MODE` doit valoir exactement "true" (sinon 404, comme si la
 *   route n'existait pas — jamais un simple 403 qui révélerait son existence) ;
 * - le header `x-e2e-token` doit correspondre exactement à `E2E_RESET_TOKEN`.
 *
 * Réutilise HouseholdsService.reset() tel quel (déjà borné aux données
 * financières du foyer, jamais User/Session/Household/HouseholdMembership) —
 * aucune nouvelle règle métier, uniquement une orchestration : reset + reseed
 * du même jeu de données que prisma/seed.ts, pour repartir d'un état connu à
 * chaque campagne.
 */
@Injectable()
export class E2eService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rlsContext: RlsContextService,
    private readonly households: HouseholdsService,
  ) {}

  async reset(providedToken: string | undefined): Promise<{ householdId: string; email: string }> {
    if (process.env.E2E_TEST_MODE !== 'true') {
      throw new NotFoundException();
    }
    const expectedToken = process.env.E2E_RESET_TOKEN;
    if (!expectedToken || !providedToken || providedToken !== expectedToken) {
      throw new ForbiddenException('Jeton E2E invalide');
    }

    const email = process.env.E2E_TEST_EMAIL || DEFAULT_E2E_EMAIL;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException(`Utilisateur E2E introuvable (${email}) — le seed doit avoir déjà tourné`);
    }

    // Même résolution que AuthService.activeHouseholdId() (docs/04 §S.16) :
    // User.activeHouseholdId en priorité si le membership existe encore,
    // sinon le membership le plus ancien — jamais une hypothèse que la
    // colonne est forcément posée (HouseholdsService.create() ne la pose
    // pas elle-même, seul prisma/seed.ts le fait explicitement).
    const householdId = await this.rlsContext.run(user.id, null, async () => {
      const tx = this.rlsContext.getClient();
      if (user.activeHouseholdId) {
        const activeMembership = await tx.householdMembership.findUnique({
          where: { householdId_userId: { householdId: user.activeHouseholdId, userId: user.id } },
        });
        if (activeMembership) return user.activeHouseholdId;
      }
      const membership = await tx.householdMembership.findFirst({ where: { userId: user.id }, orderBy: { joinedAt: 'asc' } });
      return membership?.householdId ?? null;
    });
    if (!householdId) {
      throw new NotFoundException(`Utilisateur E2E sans foyer (${email}) — le seed doit avoir déjà tourné`);
    }

    // HouseholdsService.reset() vérifie déjà que l'appelant est admin de ce
    // foyer — vrai ici puisque ce même utilisateur en est le créateur (seed.ts).
    await this.households.reset(user.id, householdId);

    await this.rlsContext.run(user.id, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await seedBaselineHouseholdData(tx, { householdId, userId: user.id });
    });

    return { householdId, email };
  }
}
