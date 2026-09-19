import { BadRequestException, Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { computeProjection, ProjectionResult } from '../common/ledger/projection.util';
import { computeMonthlyProjection, MonthlyProjectionResult } from '../common/ledger/monthly-projection.util';
import { addDaysUTC } from '../common/ledger/variable-budget.util';
import { computeVariableBudgetCommitments } from '../common/ledger/treasury.util';
import { round2 } from '../common/ledger/ledger.util';
import { ensureChargeDeadlinesUntil, ensureIncomeOccurrencesUntil, ensureRecurringTransfersUntil } from '../common/ledger/occurrence-generation.util';
import { DEFAULT_CLOSING_DAY, getFinancialPeriodBounds, getFinancialPeriodOf, shiftFinancialPeriod } from '../common/ledger/financial-period.util';
import { schoolProjectionMonthlyItems, SchoolProjectionMonthlyItem } from '../common/ledger/school-projection.util';

type TxClient = ReturnType<RlsContextService['getClient']>;

const DEFAULT_HORIZON_DAYS = 30;

const ALLOWED_HORIZON_MONTHS = [3, 6, 12, 24, 36, 60] as const;
const DEFAULT_HORIZON_MONTHS = 12;

export interface MonthlyMoveRequest {
  deadlineId: string;
  newDate: string;
}

/**
 * GET /projection (§31 Lot 7) — moteur unique (docs/02 G.6, RG-051). `at`/`horizon`/`to`
 * toujours injectables — jamais `new Date()` implicite dans le domaine (cf. Lots 5/6).
 */
@Injectable()
export class ProjectionService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async get(userId: string, householdId: string, at: string | undefined, horizonDays: number | undefined, to: string | undefined) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = to ? new Date(to) : addDaysUTC(referenceDate, horizonDays ?? DEFAULT_HORIZON_DAYS);
      // Lot 11 (§1/§3) : génération AVANT lecture, avec l'horizon EXACT demandé par
      // cet appel — jamais une constante séparée, l'appelant fournit déjà tout.
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
      await ensureRecurringTransfersUntil(tx, householdId, horizonEnd);
      const [projection, prudent] = await Promise.all([
        computeProjection(tx, householdId, referenceDate, horizonEnd),
        this.prudentImpact(tx, householdId, referenceDate, horizonEnd),
      ]);
      return this.toApi(projection, prudent);
    });
  }

  /** Réutilisable sur une transaction déjà ouverte (DashboardService) — jamais un second rlsContext.run() imbriqué. */
  async getOnTx(tx: TxClient, householdId: string, referenceDate: Date, horizonDays: number) {
    const horizonEnd = addDaysUTC(referenceDate, horizonDays);
    // Générée séparément ici aussi : DashboardService appelle getOnTx() directement,
    // sans passer par get() — l'horizon 30 jours est déjà couvert par la génération
    // faite en tête de DashboardService.getSummary(), createMany/skipDuplicates rend
    // ce second passage un no-op sûr, jamais un doublon (idempotence, §1).
    await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
    await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
    const [projection, prudent] = await Promise.all([
      computeProjection(tx, householdId, referenceDate, horizonEnd),
      this.prudentImpact(tx, householdId, referenceDate, horizonEnd),
    ]);
    return this.toApi(projection, prudent);
  }

  /**
   * TXT réf. §M4 — "Fin de période prudente" = engagements connus − restant des
   * budgets includeInPrudentProjection=true (formule contractuelle, jamais le
   * rythme). Réutilise EXCLUSIVEMENT computeVariableBudgetCommitments
   * (treasury.util.ts, déjà la bonne formule/le bon filtre pour "Solde actuel") :
   * jamais un second calcul de restant budgétaire. Un seul appel par requête
   * réelle (jamais dans la boucle chaude de computeProjection/Simulateur, cf. Lot 9).
   */
  private async prudentImpact(tx: TxClient, householdId: string, referenceDate: Date, horizonEnd: Date): Promise<number> {
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    const closingDay = settings?.closingDay ?? DEFAULT_CLOSING_DAY;
    const commitments = await computeVariableBudgetCommitments(tx, householdId, referenceDate, horizonEnd, 'contractuel', closingDay);
    return commitments.total;
  }

  /**
   * GET /projection/monthly (Round 4, §2/§3/§4/§19) — moteur mensuel consolidé,
   * réutilise EXCLUSIVEMENT computeProjection (via monthly-projection.util.ts) :
   * jamais un second calcul indépendant des revenus/dépenses. La génération de
   * récurrences couvre TOUT l'horizon demandé, jusqu'à 60 mois (§3/§18).
   */
  async getMonthly(
    userId: string,
    householdId: string,
    horizonMonths: number | undefined,
    at: string | undefined,
    incomeAccountIds: string[] | null | undefined,
    expenseAccountIds: string[] | null | undefined,
  ) {
    const months = this.validateHorizonMonths(horizonMonths);
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = await this.monthsHorizonEnd(tx, householdId, referenceDate, months);
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
      await ensureRecurringTransfersUntil(tx, householdId, horizonEnd);
      const result = await computeMonthlyProjection(tx, householdId, referenceDate, months, { incomeAccountIds, expenseAccountIds });
      // M9B §1 — hypothèses "Projeté" (SchoolProjection actives), purement additives :
      // computeMonthlyProjection ci-dessus reste totalement inchangé, aucune donnée
      // scolaire projetée n'entre dans son calcul (§8, jamais dans committed_amount/
      // free_available/engagements connus).
      const schoolItems = await schoolProjectionMonthlyItems(tx, householdId, referenceDate, new Date(result.horizonEnd), await this.closingDayOf(tx, householdId));
      return this.toMonthlyApi(result, schoolItems);
    });
  }

  /**
   * POST /projection/monthly/simulate (§12/§13) — baseline ET scénario dans le MÊME
   * appel, pour la comparaison avant/après (§13). AUCUNE écriture réelle (IF-10) :
   * `moves` n'existe qu'en mémoire, sous forme de `dateOverrides` passé à
   * computeProjection — jamais lu/écrit en base ici.
   */
  async simulateMonthly(
    userId: string,
    householdId: string,
    horizonMonths: number | undefined,
    at: string | undefined,
    incomeAccountIds: string[] | null | undefined,
    expenseAccountIds: string[] | null | undefined,
    moves: MonthlyMoveRequest[],
  ) {
    const months = this.validateHorizonMonths(horizonMonths);
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const referenceDate = at ? new Date(at) : new Date();
      const horizonEnd = await this.monthsHorizonEnd(tx, householdId, referenceDate, months);
      await ensureIncomeOccurrencesUntil(tx, householdId, horizonEnd);
      await ensureChargeDeadlinesUntil(tx, householdId, horizonEnd);
      await ensureRecurringTransfersUntil(tx, householdId, horizonEnd);

      const options = { incomeAccountIds, expenseAccountIds };
      const baseline = await computeMonthlyProjection(tx, householdId, referenceDate, months, options);
      // Identiques baseline/scénario : `moves` ne déplace que des Deadline réelles,
      // jamais une SchoolProjection (hors périmètre de la simulation IF-10).
      const schoolItems = await schoolProjectionMonthlyItems(tx, householdId, referenceDate, horizonEnd, await this.closingDayOf(tx, householdId));

      if (moves.length === 0) {
        const only = this.toMonthlyApi(baseline, schoolItems);
        return { baseline: only, scenario: only };
      }

      const dateOverrides = new Map<string, Date>();
      for (const move of moves) {
        if (!move.deadlineId || !move.newDate) {
          throw new BadRequestException('Chaque déplacement simulé requiert deadlineId et newDate');
        }
        dateOverrides.set(move.deadlineId, new Date(move.newDate));
      }
      const scenario = await computeMonthlyProjection(tx, householdId, referenceDate, months, { ...options, dateOverrides });

      return { baseline: this.toMonthlyApi(baseline, schoolItems), scenario: this.toMonthlyApi(scenario, schoolItems) };
    });
  }

  private validateHorizonMonths(horizonMonths: number | undefined): number {
    const months = horizonMonths ?? DEFAULT_HORIZON_MONTHS;
    if (!ALLOWED_HORIZON_MONTHS.includes(months as (typeof ALLOWED_HORIZON_MONTHS)[number])) {
      throw new BadRequestException(`horizon_months doit être l'une des valeurs suivantes : ${ALLOWED_HORIZON_MONTHS.join(', ')}`);
    }
    return months;
  }

  /**
   * R6.3 (points A/C) — borne de génération des occurrences récurrentes, alignée sur
   * le MÊME moteur de période financière que computeMonthlyProjection (jamais un
   * second calcul divergent) : sans ceci, un jour de clôture < fin de mois civil peut
   * faire pointer la dernière période financière demandée APRÈS ce qu'un calcul
   * purement calendaire aurait généré, laissant le dernier mois de l'horizon
   * silencieusement incomplet (échéances/occurrences non générées).
   */
  private async monthsHorizonEnd(tx: TxClient, householdId: string, referenceDate: Date, horizonMonths: number): Promise<Date> {
    const ref = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    const closingDay = settings?.closingDay ?? DEFAULT_CLOSING_DAY;
    const refPeriod = getFinancialPeriodOf(ref, closingDay);
    const targetPeriod = shiftFinancialPeriod(refPeriod, horizonMonths - 1);
    return getFinancialPeriodBounds(targetPeriod.year, targetPeriod.monthIndex0, closingDay).end;
  }

  /** M9B §1 — closingDay du foyer, même repli DEFAULT_CLOSING_DAY que monthsHorizonEnd. */
  private async closingDayOf(tx: TxClient, householdId: string): Promise<number> {
    const settings = await tx.householdSettings.findUnique({ where: { householdId } });
    return settings?.closingDay ?? DEFAULT_CLOSING_DAY;
  }

  /** Contrat API en snake_case explicite (§31 Lot 7), étendu Round 4 pour la vue mensuelle. */
  private toMonthlyApi(result: MonthlyProjectionResult, schoolItemsByMonth: Map<string, SchoolProjectionMonthlyItem[]> = new Map()) {
    // M9B §1 (correction) — les SchoolProjection actives doivent réellement IMPACTER
    // la projection longue durée, pas seulement s'y afficher (TXT). Piste cumulée
    // DÉDIÉE, même mécanique que cashRunningPrudent (monthly-projection.util.ts) mais
    // calculée ici, séparément : part du même solde de trésorerie initial, ajoute
    // balance+transferts pilotés comme projected_cash_balance, PLUS retranche, période
    // par période, le total des prévisions scolaires actives (status=projete) dont la
    // targetDate tombe dans cette période — cumulé (une fois retranchée, reste
    // retranchée les mois suivants). Autre nature que le budget prudent (§M4 intact,
    // jamais mélangée à cashRunningPrudent/projectedCashBalancePrudent) : une
    // SchoolProjection remplacée ne revient JAMAIS ici (schoolProjectionMonthlyItems
    // ne lit que status=projete, cf. school-projection.util.ts) — la vraie Deadline qui
    // l'a remplacée est déjà comptée normalement dans projected_cash_balance, jamais
    // les deux à la fois. Toujours additif : committed_amount/free_available/paiements/
    // provisions/engagements certains restent calculés exactement comme avant M9.
    let cashRunningWithForecasts = result.summary.openingCashBalance;
    const months = result.months.map((m) => {
      const schoolItems = schoolItemsByMonth.get(m.month) ?? [];
      const schoolProjectionImpact = round2(-schoolItems.reduce((sum, it) => sum + it.amount, 0));
      cashRunningWithForecasts = round2(cashRunningWithForecasts + m.balance + m.plannedTransferNetTreasuryImpact + schoolProjectionImpact);
      return {
        month: m.month,
        label: m.label,
        total_income: m.totalIncome,
        total_expense: m.totalExpense,
        balance: m.balance,
        cumulative_balance: m.cumulativeBalance,
        projected_cash_balance: m.projectedCashBalance,
        // TXT réf. §M4/§5 — par période : "Situation projetée — engagements connus"
        // (projected_cash_balance, déjà budget-free) / "Situation prudente — budgets
        // inclus" / écart = "X DH de budgets encore disponibles sur la période".
        projected_cash_balance_prudent: m.projectedCashBalancePrudent,
        prudent_budget_remaining: m.prudentBudgetRemaining,
        // Corrections consolidées §10 — détail listant les budgets réellement
        // comptés dans prudent_budget_remaining ci-dessus (Σ amount === prudent_budget_remaining).
        budget_items: m.budgetItems.map((b) => ({ budget_id: b.budgetId, label: b.label, amount: b.amount })),
        planned_transfer_net_treasury_impact: m.plannedTransferNetTreasuryImpact,
        // R6.4 (§9) — jamais rangé dans income_items/expense_items : un transfert reste
        // identifiable comme TRANSFERT, son impact appartient uniquement à la trésorerie pilotée.
        planned_transfer_items: m.plannedTransferItems,
        income_items: m.incomeItems,
        expense_items: m.expenseItems,
        // M9B §1 — hypothèses futures "Projeté" (SchoolProjection actives) : jamais
        // dans income_items/expense_items, jamais sommées dans total_income/
        // total_expense/balance/cumulative_balance/projected_cash_balance — une
        // prévision reste une prévision, jamais un engagement connu.
        school_projection_items: schoolItems,
        // M9B §1 (correction) — impact signé de CETTE période (négatif = prévision
        // scolaire future) et solde cumulé qui en tient compte réellement : "prévisions
        // long terme" et "solde projeté incluant ces prévisions", distincts de
        // projected_cash_balance ("engagements connus" seul, inchangé ci-dessus).
        school_projection_impact: schoolProjectionImpact,
        projected_cash_balance_with_forecasts: cashRunningWithForecasts,
        movable_expense_total: m.movableExpenseTotal,
        is_complete: m.isComplete,
        unknown_count: m.unknownCount,
        unknown_labels: m.unknownLabels,
        contains_estimates: m.containsEstimates,
        excluded_by_filter_count: m.excludedByFilterCount,
        excluded_by_filter_total: m.excludedByFilterTotal,
      };
    });
    return {
      reference_date: result.referenceDate,
      horizon_end: result.horizonEnd,
      horizon_months: result.horizonMonths,
      months,
      summary: {
        total_income: result.summary.totalIncome,
        total_expense: result.summary.totalExpense,
        total_balance: result.summary.totalBalance,
        deficit_months_count: result.summary.deficitMonthsCount,
        worst_month: result.summary.worstMonth,
        max_monthly_deficit: result.summary.maxMonthlyDeficit,
        opening_cash_balance: result.summary.openingCashBalance,
        cash_low_point: result.summary.cashLowPoint,
        max_financing_need: result.summary.maxFinancingNeed,
        first_positive_cash_balance_month: result.summary.firstPositiveCashBalanceMonth,
        treasury_account_ids: result.summary.treasuryAccountIds,
        is_complete: result.summary.isComplete,
        incomplete_months_count: result.summary.incompleteMonthsCount,
      },
      account_filters: result.accountFilters,
    };
  }

  /**
   * Contrat API en snake_case explicite (§31), même convention que la correction Lot 5 §5.
   * TXT réf. §M4 — `closing_physical_treasury` reste EXPOSÉ tel quel (alias de compatibilité,
   * cf. instruction §6) mais désigne désormais "Fin de période — engagements connus" (zéro
   * budget, cf. computeProjection). `fin_periode_prudente`/`ecart_prudentiel` sont nouveaux :
   * jamais de `lowPointPrudente*` daté exposé ici (pas d'indicateur métier à date fictive).
   */
  private toApi(result: ProjectionResult, prudentBudgetImpact: number) {
    const finPeriodePrudente = round2(result.closingPhysicalTreasury - prudentBudgetImpact);
    return {
      reference_date: result.referenceDate,
      horizon_end: result.horizonEnd,

      opening_physical_treasury: result.openingPhysicalTreasury,
      closing_physical_treasury: result.closingPhysicalTreasury,
      fin_periode_engagements_connus: result.closingPhysicalTreasury,
      fin_periode_prudente: finPeriodePrudente,
      ecart_prudentiel: round2(prudentBudgetImpact),
      physical_low_point: result.physicalLowPoint,
      physical_low_point_date: result.physicalLowPointDate,

      opening_free_capacity: result.openingFreeCapacity,
      closing_free_capacity: result.closingFreeCapacity,
      free_capacity_low_point: result.freeCapacityLowPoint,
      free_capacity_low_point_date: result.freeCapacityLowPointDate,

      first_negative_date: result.firstNegativeDate,
      deficit_at_first_negative: result.deficitAtFirstNegative,

      contains_estimates: result.containsEstimates,
      unknown_events_count: result.unknownEventsCount,
      is_complete: result.isComplete,
      envisaged_events_total: result.envisagedEventsTotal,
      status: result.status,

      timeline: result.timeline,
    };
  }
}
