import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  async create(userId: string, householdId: string, dto: CreateVariableBudgetDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const category = await tx.category.findFirst({ where: { id: dto.categoryId, OR: [{ householdId: null }, { householdId }] } });
      if (!category) throw new NotFoundException('Catégorie introuvable');

      return tx.variableBudget.create({
        data: {
          householdId,
          categoryId: dto.categoryId,
          referenceAmount: dto.referenceAmount,
          referencePeriod: dto.referencePeriod,
          weekStartDay: dto.weekStartDay ?? 1,
          startDate: new Date(dto.startDate),
          endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        },
      });
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

  /** §14 : révision en cours de période — l'historique des BudgetExpense n'est jamais réécrit. */
  async update(userId: string, householdId: string, id: string, dto: UpdateVariableBudgetDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const budget = await tx.variableBudget.findFirst({ where: { id, householdId } });
      if (!budget) throw new NotFoundException('Budget introuvable');

      await tx.variableBudget.update({
        where: { id },
        data: {
          referenceAmount: dto.referenceAmount,
          endDate: dto.endDate !== undefined ? new Date(dto.endDate) : undefined,
        },
      });
      return this.detailOnTx(tx, householdId, id);
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

  private findActiveBudgetsRaw(tx: TxClient, householdId: string, categoryId: string, at: Date) {
    return tx.variableBudget.findMany({
      where: {
        householdId,
        categoryId,
        startDate: { lte: at },
        OR: [{ endDate: null }, { endDate: { gte: at } }],
      },
    });
  }
}
