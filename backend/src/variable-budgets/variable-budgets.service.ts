import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import {
  BudgetLike,
  budgetHealthStatus,
  computeBudgetPeriodStatus,
  getCurrentPeriodWindow,
  ProjectionMode,
} from '../common/ledger/variable-budget.util';
import { CreateVariableBudgetDto } from './dto/create-variable-budget.dto';
import { UpdateVariableBudgetDto } from './dto/update-variable-budget.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

/**
 * VariableBudget (docs/02-modele-metier.md §E.4, G.7/G.8). Le "consommé_à_date"
 * est toujours lu depuis BudgetExpense — jamais depuis LedgerEntry, qui reste
 * une simple vue de lecture (§9).
 */
@Injectable()
export class VariableBudgetsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  private toBudgetLike(budget: { referenceAmount: unknown; referencePeriod: 'semaine' | 'mois'; weekStartDay: number; startDate: Date; endDate: Date | null }): BudgetLike {
    return {
      referenceAmount: toNumber(budget.referenceAmount),
      referencePeriod: budget.referencePeriod,
      weekStartDay: budget.weekStartDay,
      startDate: budget.startDate,
      endDate: budget.endDate,
    };
  }

  /** `periodEnd` est minuit UTC du dernier jour — borne exclusive au jour suivant pour
   *  inclure toute dépense de ce dernier jour, quelle que soit son heure d'enregistrement. */
  private exclusiveEnd(periodEnd: Date): Date {
    return new Date(periodEnd.getTime() + 86400000);
  }

  private async consommeADate(tx: TxClient, variableBudgetId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const result = await tx.budgetExpense.aggregate({
      where: { variableBudgetId, spentDate: { gte: periodStart, lt: this.exclusiveEnd(periodEnd) } },
      _sum: { amount: true },
    });
    return toNumber(result._sum.amount);
  }

  /**
   * Variante réutilisable sur une transaction déjà ouverte (ExpensesService) —
   * jamais imbriquer un second rlsContext.run() dans une transaction en cours,
   * ce qui masquerait les écritures pas encore committées de la transaction
   * appelante (RG-000, cohérence transactionnelle).
   */
  async getBudgetStatusOnTx(tx: TxClient, householdId: string, budgetId: string, today: Date = new Date()) {
    const budget = await tx.variableBudget.findFirst({ where: { id: budgetId, householdId } });
    if (!budget) return null;
    const mode = await this.projectionMode(tx, householdId);
    return this.statusFor(tx, budget, mode, today);
  }

  async findActiveBudgetsOnTx(tx: TxClient, householdId: string, categoryId: string, at: Date = new Date()) {
    return this.findActiveBudgetsRaw(tx, householdId, categoryId, at);
  }

  /**
   * Lot 2 — recherche par scope EXACT, utilisée par ExpensesService pour la
   * priorité explicite > type précis > catégorie parente > aucun.
   * categoryTypeId=null cible exclusivement les budgets scopés à toute la
   * catégorie (jamais un budget scopé à un type précis) ; categoryTypeId=<id>
   * cible exclusivement ce type précis (jamais la catégorie parente).
   */
  async findActiveBudgetsForScopeOnTx(
    tx: TxClient,
    householdId: string,
    categoryId: string,
    categoryTypeId: string | null,
    at: Date = new Date(),
  ) {
    return tx.variableBudget.findMany({
      where: {
        householdId,
        categoryId,
        categoryTypeId,
        status: 'actif',
        startDate: { lte: at },
        OR: [{ endDate: null }, { endDate: { gte: at } }],
      },
    });
  }

  /** Vérifie que categoryTypeId (si fourni) appartient bien à categoryId, dans ce foyer ou système. */
  private async validateCategoryTypeScope(tx: TxClient, householdId: string, categoryId: string, categoryTypeId: string) {
    const type = await tx.categoryType.findFirst({
      where: { id: categoryTypeId, categoryId, OR: [{ householdId: null }, { householdId }] },
    });
    if (!type) throw new NotFoundException("Type introuvable pour cette catégorie");
  }

  /**
   * Chevauchement de scope (§ "un budget principal actif par type") — avertissement
   * NON BLOQUANT uniquement, jamais un refus de création/modification (RG-000).
   * `excludeId` évite qu'un budget existant se signale lui-même lors d'un update.
   */
  private async findOverlappingBudgets(
    tx: TxClient,
    householdId: string,
    categoryId: string,
    categoryTypeId: string | null,
    startDate: Date,
    endDate: Date | null,
    excludeId?: string,
  ) {
    return tx.variableBudget.findMany({
      where: {
        householdId,
        categoryId,
        categoryTypeId,
        status: 'actif',
        id: excludeId ? { not: excludeId } : undefined,
        startDate: endDate ? { lte: endDate } : undefined,
        OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      },
    });
  }

  private async statusFor(tx: TxClient, budgetRow: any, mode: ProjectionMode, today: Date) {
    const budget = this.toBudgetLike(budgetRow);
    const window = getCurrentPeriodWindow(budget, today);
    const consomme = await this.consommeADate(tx, budgetRow.id, window.start, window.end);
    const status = computeBudgetPeriodStatus(budget, today, consomme, mode);
    return {
      ...status,
      healthStatus: budgetHealthStatus(status.consommeADate, status.budgetPeriode),
    };
  }

  private async projectionMode(tx: TxClient, householdId: string): Promise<ProjectionMode> {
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    return (settings?.variableBudgetProjectionMode ?? 'prudent_max') as ProjectionMode;
  }

  /**
   * Mini-lot weekStartDay foyer — défaut du jour de début de semaine pour un
   * budget hebdomadaire quand non fourni explicitement à la création
   * (HouseholdSettings.weekStartDay) ; jamais rétroactif (n'affecte que la
   * création — update() reste 100% explicite) ; fallback ultime lundi (1).
   */
  private async householdWeekStartDayOnTx(tx: TxClient, householdId: string): Promise<number> {
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    return settings?.weekStartDay ?? 1;
  }

  async create(userId: string, householdId: string, dto: CreateVariableBudgetDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id: dto.categoryId, OR: [{ householdId: null }, { householdId }] } });
      if (!category) throw new NotFoundException('Catégorie introuvable');
      if (dto.categoryTypeId) {
        await this.validateCategoryTypeScope(tx, householdId, dto.categoryId, dto.categoryTypeId);
      }

      const startDate = new Date(dto.startDate);
      const endDate = dto.endDate ? new Date(dto.endDate) : null;
      const overlapping = await this.findOverlappingBudgets(tx, householdId, dto.categoryId, dto.categoryTypeId ?? null, startDate, endDate);

      // Mini-lot weekStartDay foyer : valeur explicite > réglage foyer (pertinent
      // uniquement pour un budget hebdomadaire — inerte pour un budget mensuel,
      // cf. nominalPeriod qui ignore weekStartDay quand referencePeriod='mois') > lundi (1).
      const weekStartDay =
        dto.weekStartDay ?? (dto.referencePeriod === 'semaine' ? await this.householdWeekStartDayOnTx(tx, householdId) : 1);

      const budget = await tx.variableBudget.create({
        data: {
          householdId,
          categoryId: dto.categoryId,
          categoryTypeId: dto.categoryTypeId,
          referenceAmount: dto.referenceAmount,
          referencePeriod: dto.referencePeriod,
          weekStartDay,
          startDate,
          endDate: endDate ?? undefined,
          includeInPrudentProjection: dto.includeInPrudentProjection ?? true,
        },
      });
      // Avertissement NON bloquant (RG-000) : "en principe un budget principal actif
      // par type" — jamais un refus, jamais une désambiguïsation forcée à la création.
      return { ...budget, overlapWarning: overlapping.length > 0 ? overlapping.map((b) => b.id) : null };
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const mode = await this.projectionMode(tx, householdId);
      const budgets = await tx.variableBudget.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' }, include: { category: true } });
      const today = new Date();
      return Promise.all(budgets.map(async (b) => ({ ...b, status: await this.statusFor(tx, b, mode, today) })));
    });
  }

  /**
   * Détail complet (statut + historique de la période courante) sur une
   * transaction déjà ouverte — jamais imbriquer un second rlsContext.run()
   * dans une transaction en cours (cf. getBudgetStatusOnTx).
   */
  private async detailOnTx(tx: TxClient, householdId: string, id: string) {
    const budget = await tx.variableBudget.findFirst({ where: { id, householdId }, include: { category: true } });
    if (!budget) throw new NotFoundException('Budget introuvable');
    const mode = await this.projectionMode(tx, householdId);
    const today = new Date();
    const status = await this.statusFor(tx, budget, mode, today);
    const history = await tx.budgetExpense.findMany({
      where: { variableBudgetId: id, spentDate: { gte: status.periodStart, lt: this.exclusiveEnd(status.periodEnd) } },
      orderBy: { spentDate: 'desc' },
    });
    return { ...budget, status, history };
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, () => this.detailOnTx(this.rlsContext.getClient(), householdId, id));
  }

  /**
   * §14 : révision en cours de période — l'historique des BudgetExpense n'est
   * jamais réécrit, seule la fenêtre de période COURANTE en avant change.
   * R6.4 (§1) : referencePeriod/weekStartDay/categoryId sont maintenant
   * modifiables au même titre — aucune contrainte d'historique dessus,
   * contrairement à referenceAmount déjà géré ci-dessus.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateVariableBudgetDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const budget = await tx.variableBudget.findFirst({ where: { id, householdId } });
      if (!budget) throw new NotFoundException('Budget introuvable');

      const effectiveCategoryId = dto.categoryId ?? budget.categoryId;
      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, OR: [{ householdId: null }, { householdId }] } });
        if (!category) throw new NotFoundException('Catégorie introuvable');
      }
      if (dto.categoryTypeId) {
        await this.validateCategoryTypeScope(tx, householdId, effectiveCategoryId, dto.categoryTypeId);
      }

      // `null` explicite (≠ undefined) : repasse le budget au scope catégorie
      // entière — ne jamais utiliser `??` ici, qui traiterait null comme absent.
      const effectiveCategoryTypeId = dto.categoryTypeId !== undefined ? dto.categoryTypeId : budget.categoryTypeId;
      const effectiveStartDate = budget.startDate; // startDate n'est jamais modifiable (§14, hors périmètre)
      const effectiveEndDate = dto.endDate !== undefined ? new Date(dto.endDate) : budget.endDate;
      const overlapping = await this.findOverlappingBudgets(
        tx,
        householdId,
        effectiveCategoryId,
        effectiveCategoryTypeId,
        effectiveStartDate,
        effectiveEndDate,
        id,
      );

      await tx.variableBudget.update({
        where: { id },
        data: {
          referenceAmount: dto.referenceAmount,
          endDate: dto.endDate !== undefined ? new Date(dto.endDate) : undefined,
          referencePeriod: dto.referencePeriod,
          weekStartDay: dto.weekStartDay,
          categoryId: dto.categoryId,
          categoryTypeId: dto.categoryTypeId,
          includeInPrudentProjection: dto.includeInPrudentProjection,
        },
      });
      const detail = await this.detailOnTx(tx, householdId, id);
      return { ...detail, overlapWarning: overlapping.length > 0 ? overlapping.map((b) => b.id) : null };
    });
  }

  /**
   * R6.4 (§1) : suppression physique bloquée dès qu'une BudgetExpense existe déjà
   * (historique réel) — même RG implicite que ChargePlansService.remove, jamais
   * silencieuse. Sans historique, suppression réelle ; sinon archivage (status=inactif),
   * exclu de findActiveForCategory (pré-remplissage) mais consultable en détail.
   */
  async remove(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const budget = await tx.variableBudget.findFirst({ where: { id, householdId } });
      if (!budget) throw new NotFoundException('Budget introuvable');

      const expenseCount = await tx.budgetExpense.count({ where: { variableBudgetId: id } });
      if (expenseCount > 0) {
        if (budget.status === 'inactif') throw new ConflictException('Ce budget est déjà archivé');
        await tx.variableBudget.update({ where: { id }, data: { status: 'inactif' } });
        return { deleted: false, archived: true };
      }

      await tx.variableBudget.delete({ where: { id } });
      return { deleted: true, archived: false };
    });
  }

  /**
   * §8 : budget(s) actif(s) pour une catégorie à une date donnée — utilisé pour
   * le pré-remplissage silencieux (1 seul résultat) ou pour demander explicitement
   * à l'utilisateur lequel utiliser (plusieurs résultats), jamais deviné.
   */
  async findActiveForCategory(userId: string, householdId: string, categoryId: string, atIso?: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const at = atIso ? new Date(atIso) : new Date();
      const mode = await this.projectionMode(tx, householdId);
      const budgets = await this.findActiveBudgetsRaw(tx, householdId, categoryId, at);
      return Promise.all(budgets.map(async (b) => ({ ...b, status: await this.statusFor(tx, b, mode, at) })));
    });
  }

  // R6.4 (§1) : un budget archivé (status=inactif) reste dans findAll (badge, consultable)
  // mais n'est plus jamais proposé au pré-remplissage/à la suggestion d'une dépense —
  // même convention que les comptes archivés exclus des sélecteurs (Round3 PartB §15).
  private findActiveBudgetsRaw(tx: TxClient, householdId: string, categoryId: string, at: Date) {
    return tx.variableBudget.findMany({
      where: {
        householdId,
        categoryId,
        status: 'actif',
        startDate: { lte: at },
        OR: [{ endDate: null }, { endDate: { gte: at } }],
      },
    });
  }
}
