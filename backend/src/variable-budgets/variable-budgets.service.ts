import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import {
  addDaysUTC,
  BudgetLike,
  budgetHealthStatus,
  computeBudgetPeriodStatus,
  getCurrentPeriodWindow,
  periodEndExclusive,
  ProjectionMode,
  ReferencePeriod,
  resolveEffectiveConfig,
  VersionedSnapshot,
} from '../common/ledger/variable-budget.util';
import { CreateVariableBudgetDto } from './dto/create-variable-budget.dto';
import { UpdateVariableBudgetDto } from './dto/update-variable-budget.dto';

type TxClient = ReturnType<RlsContextService['getClient']>;

/** Les 7 champs suivis par l'historique Lot 4 — sans validFrom/validTo (qui
 *  n'existent que pour un segment CLOS, jamais pour la ligne vivante). */
type BudgetConfigFields = Omit<VersionedSnapshot, 'validFrom' | 'validTo'>;

const TRACKED_FIELDS = [
  'referenceAmount',
  'referencePeriod',
  'categoryId',
  'categoryTypeId',
  'weekStartDay',
  'includeInPrudentProjection',
  'endDate',
] as const satisfies readonly (keyof BudgetConfigFields)[];

export interface BudgetAmendmentEntry {
  budgetId: string;
  field: (typeof TRACKED_FIELDS)[number];
  oldValue: unknown;
  newValue: unknown;
  changedAt: Date;
  effectiveFrom: Date;
}

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

  private async consommeADate(tx: TxClient, variableBudgetId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const result = await tx.budgetExpense.aggregate({
      where: { variableBudgetId, spentDate: { gte: periodStart, lt: periodEndExclusive(periodEnd) } },
      _sum: { amount: true },
    });
    return toNumber(result._sum.amount);
  }

  private toConfigFields(row: {
    referenceAmount: unknown;
    referencePeriod: ReferencePeriod;
    categoryId: string;
    categoryTypeId: string | null;
    weekStartDay: number;
    includeInPrudentProjection: boolean;
    endDate: Date | null;
  }): BudgetConfigFields {
    return {
      referenceAmount: toNumber(row.referenceAmount),
      referencePeriod: row.referencePeriod,
      categoryId: row.categoryId,
      categoryTypeId: row.categoryTypeId,
      weekStartDay: row.weekStartDay,
      includeInPrudentProjection: row.includeInPrudentProjection,
      endDate: row.endDate,
    };
  }

  /**
   * Lot 4 — tous les segments CLOS déjà connus pour ce budget, ordre chronologique.
   * Peu de lignes par budget (une par modification réelle) : un fetch unique
   * suffit à toutes les résolutions ponctuelles d'une même requête (at/periodStart/
   * dernier instant de période), plutôt que 3 requêtes WHERE indexées séparées.
   */
  private async fetchVersionsOnTx(tx: TxClient, budgetId: string): Promise<VersionedSnapshot[]> {
    const rows = await tx.variableBudgetVersion.findMany({ where: { variableBudgetId: budgetId }, orderBy: { validFrom: 'asc' } });
    return rows.map((row) => ({ ...this.toConfigFields(row), validFrom: row.validFrom, validTo: row.validTo }));
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
   * Détail complet (statut + historique + navigation de période) sur une
   * transaction déjà ouverte — jamais imbriquer un second rlsContext.run()
   * dans une transaction en cours (cf. getBudgetStatusOnTx).
   *
   * Lot 4 — algorithme de résolution à une date `at` (voir aussi la convention
   * temporelle documentée dans variable-budget.util.ts) :
   *  A/B. configAt = configuration effective à `at` (segment clos qui le couvre,
   *       sinon la ligne vivante).
   *  C.   periodStart/periodEnd = fenêtre calculée par le moteur EXISTANT
   *       (getCurrentPeriodWindow), avec CETTE configuration — jamais l'inverse
   *       (éviterait la circularité : on ne connaît periodEnd qu'après avoir
   *       choisi la bonne configuration, pas avant).
   *  D.   une fois periodStart/periodEnd connus : configInitial = configuration
   *       effective à periodStart (borne d'entrée, incluse) ; configFinal =
   *       configuration effective au DERNIER instant réellement inclus dans la
   *       période (periodEndExclusive - 1ms, jamais periodEnd/periodEndExclusive
   *       eux-mêmes — un changement pile à la borne de sortie appartient à la
   *       période SUIVANTE). configFinal sert au plafond/restant affichés ;
   *       configInitial sert uniquement à l'affichage "valeur initiale" si elle
   *       diffère de configFinal.
   *  Pour la période encore ouverte (celle contenant "maintenant"), configFinal
   *  se résout systématiquement sur la ligne vivante (aucun segment clos ne peut
   *  couvrir un instant futur) — comportement strictement identique à avant ce
   *  lot quand `at` est omis.
   */
  private async detailOnTx(tx: TxClient, householdId: string, id: string, at: Date = new Date()) {
    const budget = await tx.variableBudget.findFirst({ where: { id, householdId }, include: { category: true } });
    if (!budget) throw new NotFoundException('Budget introuvable');
    const mode = await this.projectionMode(tx, householdId);

    const liveConfig = this.toConfigFields(budget);
    const versions = await this.fetchVersionsOnTx(tx, id);
    const resolveAt = (instant: Date) => resolveEffectiveConfig(versions, liveConfig, instant);

    const configAt = resolveAt(at);
    const budgetLikeAt: BudgetLike = { referenceAmount: configAt.referenceAmount, referencePeriod: configAt.referencePeriod, weekStartDay: configAt.weekStartDay, startDate: budget.startDate, endDate: configAt.endDate };
    const { start: periodStart, end: periodEnd } = getCurrentPeriodWindow(budgetLikeAt, at);
    const periodEndExcl = periodEndExclusive(periodEnd);

    const configInitial = resolveAt(periodStart);
    const configFinal = resolveAt(new Date(periodEndExcl.getTime() - 1));
    const budgetLikeFinal: BudgetLike = { referenceAmount: configFinal.referenceAmount, referencePeriod: configFinal.referencePeriod, weekStartDay: configFinal.weekStartDay, startDate: budget.startDate, endDate: configFinal.endDate };

    const now = new Date();
    // Période déjà close (periodEnd < maintenant) : figée à sa clôture (jours_écoulés
    // = totalité) — période encore ouverte : progression en temps réel comme avant ce lot.
    const todayForStatus = periodEnd.getTime() < now.getTime() ? periodEnd : now;

    const consomme = await this.consommeADate(tx, id, periodStart, periodEnd);
    const periodStatus = computeBudgetPeriodStatus(budgetLikeFinal, todayForStatus, consomme, mode);
    const status = { ...periodStatus, healthStatus: budgetHealthStatus(periodStatus.consommeADate, periodStatus.budgetPeriode) };

    const history = await tx.budgetExpense.findMany({
      where: { variableBudgetId: id, spentDate: { gte: periodStart, lt: periodEndExcl } },
      orderBy: { spentDate: 'desc' },
    });

    const changedDuringPeriod = TRACKED_FIELDS.some((field) => {
      if (field === 'endDate') return (configInitial.endDate?.getTime() ?? null) !== (configFinal.endDate?.getTime() ?? null);
      return configInitial[field] !== configFinal[field];
    });

    const isCurrentPeriod = periodStart.getTime() <= now.getTime() && now.getTime() < periodEndExcl.getTime();

    return {
      ...budget,
      status,
      history,
      periodNavigation: {
        at,
        periodStart,
        periodEnd,
        isCurrentPeriod,
        previousPeriodAt: addDaysUTC(periodStart, -1),
        nextPeriodAt: isCurrentPeriod ? null : periodEndExcl,
      },
      // Informatif uniquement — null si rien n'a changé pendant cette période
      // (jamais affiché dans ce cas, cf. §4 de la demande).
      initialValues: changedDuringPeriod ? configInitial : null,
      adjustedValues: changedDuringPeriod ? configFinal : null,
    };
  }

  async findOne(userId: string, householdId: string, id: string, atIso?: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.detailOnTx(this.rlsContext.getClient(), householdId, id, atIso ? new Date(atIso) : new Date()),
    );
  }

  /**
   * Lot 4 — journal des modifications dérivé par diff de segments consécutifs
   * (jamais stocké séparément — un instantané complet suffit, cf. schéma).
   * changedAt = effectiveFrom dans ce lot (aucune date d'effet distincte
   * saisissable) : les deux valent le validTo du segment qui vient de se clore.
   */
  async getHistory(userId: string, householdId: string, id: string): Promise<BudgetAmendmentEntry[]> {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const budget = await tx.variableBudget.findFirst({ where: { id, householdId } });
      if (!budget) throw new NotFoundException('Budget introuvable');

      const versions = await this.fetchVersionsOnTx(tx, id); // déjà triés par validFrom croissant
      const liveConfig = this.toConfigFields(budget);
      const timeline: BudgetConfigFields[] = [...versions, liveConfig];

      const entries: BudgetAmendmentEntry[] = [];
      for (let i = 0; i < versions.length; i++) {
        const before = versions[i];
        const after = timeline[i + 1];
        const changedAt = before.validTo;
        for (const field of TRACKED_FIELDS) {
          const oldValue = before[field];
          const newValue = after[field];
          const differ = field === 'endDate'
            ? ((oldValue as Date | null)?.getTime() ?? null) !== ((newValue as Date | null)?.getTime() ?? null)
            : oldValue !== newValue;
          if (differ) entries.push({ budgetId: id, field, oldValue, newValue, changedAt, effectiveFrom: changedAt });
        }
      }
      return entries;
    });
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

      // Lot 4 — capture l'état AVANT modification comme segment d'historique clos,
      // uniquement si au moins un des 7 champs suivis change réellement (jamais de
      // segment vide pour un update no-op ni pour une propriété hors périmètre,
      // ex. status). Toujours dans la même transaction que l'écriture ci-dessous
      // (rlsContext.run englobe déjà tout dans prisma.$transaction).
      const oldEndTime = budget.endDate?.getTime() ?? null;
      const newEndTime = effectiveEndDate?.getTime() ?? null;
      const tracked7FieldsChanged =
        (dto.referenceAmount !== undefined && toNumber(dto.referenceAmount) !== toNumber(budget.referenceAmount)) ||
        (dto.referencePeriod !== undefined && dto.referencePeriod !== budget.referencePeriod) ||
        (dto.categoryId !== undefined && dto.categoryId !== budget.categoryId) ||
        (dto.categoryTypeId !== undefined && dto.categoryTypeId !== budget.categoryTypeId) ||
        (dto.weekStartDay !== undefined && dto.weekStartDay !== budget.weekStartDay) ||
        (dto.includeInPrudentProjection !== undefined && dto.includeInPrudentProjection !== budget.includeInPrudentProjection) ||
        (dto.endDate !== undefined && oldEndTime !== newEndTime);

      if (tracked7FieldsChanged) {
        // validFrom du tout premier segment = createdAt (origine TECHNIQUE du
        // versionnement, jamais startDate qui reste la date d'application
        // FINANCIÈRE — évite un intervalle invalide si le budget est modifié
        // avant sa startDate). Segments suivants : chaînés sur le validTo précédent.
        const lastVersion = await tx.variableBudgetVersion.findFirst({ where: { variableBudgetId: id }, orderBy: { validTo: 'desc' } });
        const validFrom = lastVersion?.validTo ?? budget.createdAt;
        await tx.variableBudgetVersion.create({
          data: {
            variableBudgetId: id,
            referenceAmount: budget.referenceAmount,
            referencePeriod: budget.referencePeriod,
            categoryId: budget.categoryId,
            categoryTypeId: budget.categoryTypeId,
            weekStartDay: budget.weekStartDay,
            includeInPrudentProjection: budget.includeInPrudentProjection,
            endDate: budget.endDate,
            validFrom,
            validTo: new Date(), // = changedAt = effectiveFrom du nouvel état (ce lot n'a pas de date d'effet distincte saisissable)
          },
        });
      }

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
