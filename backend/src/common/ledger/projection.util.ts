import { Prisma } from '@prisma/client';
import { getDeadlineBalance, round2, toNumber } from './ledger.util';
import { computeTreasurySummary } from './treasury.util';
import { computePocketCurrentAmount } from './provision.util';
import {
  BudgetLike,
  ProjectionMode,
  addDaysUTC,
  budgetAmountForWindow,
  computeBudgetPeriodStatus,
  getCurrentPeriodWindow,
  nominalPeriod,
} from './variable-budget.util';

type TxClient = Prisma.TransactionClient;

/**
 * Moteur de projection (docs/02-modele-metier.md G.6, RG-051, Lot 7). Deux courbes
 * TOUJOURS distinctes (§2 de la demande) :
 *  - physique  : vrais flux d'argent uniquement (G.6a) ;
 *  - capacité_libre : ce qui reste réellement mobilisable (G.6b), recalculée à
 *    CHAQUE date à partir des réserves/engagements PROJETÉS, jamais une simple
 *    translation constante du Disponible_libre d'aujourd'hui (§8).
 *
 * Aucun Payment/PocketMovement/AccountTransfer réel n'est jamais créé ici — la
 * projection lit exclusivement des événements PRÉVUS (RG-000, §4/§9/§10/§12).
 *
 * Seuils (§17/§18/§26, précisent RG-051 pour ce nouveau moteur) : un point bas
 * physique < 0 est un vrai trou de trésorerie (DEFICIT_PHYSIQUE) ; un point bas
 * de capacité libre < 0 alors que le physique reste ≥ 0 est une TENSION — la
 * marge de sécurité est déjà nette dans la formule de capacité libre (G.6b), donc
 * "< 0" y équivaut exactement à "point bas < marge_sécurité" (RG-051).
 */

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dateKey(d: Date): string {
  return toUtcMidnight(d).toISOString().slice(0, 10);
}

// ---------- Construction des événements (§4/§5/§6/§7/§9/§10/§11/§12/§13/§23/§25) ----------

type EventKind = 'income' | 'pocket_movement' | 'deadline' | 'transfer' | 'variable_budget';

// Ordre intrajournalier déterministe (§14) : les entrées et réservations arrivent
// avant les sorties du même jour — hypothèse prudente et stable, jamais ambiguë.
const KIND_PRIORITY: Record<EventKind, number> = { income: 0, pocket_movement: 1, deadline: 2, transfer: 3, variable_budget: 4 };

interface RawEvent {
  date: Date;
  kind: EventKind;
  label: string;
  sortKey: string; // départage stable à priorité égale (§14)
  // physicalImpact/reserveImpact sont résolus lors du traitement séquentiel (deadline
  // a besoin du solde de provision COURANT au moment où on l'atteint, RG-090).
  physicalImpact?: number;
  reserveImpact?: number;
  amountStatus?: 'estime' | 'confirme';
  // deadline uniquement : nécessaire pour la fenêtre "engagé" du jour (§8).
  deadlineId?: string;
  engagementNonCouvert?: number;
}

export interface ProjectionEventSummary {
  label: string;
  amount: number; // signé : + entrée, - sortie
  kind: EventKind;
}

export interface TimelinePoint {
  date: string;
  physicalTreasury: number;
  reservedAmount: number;
  engagedAmount: number;
  freeCapacity: number;
  events: ProjectionEventSummary[];
}

export interface ProjectionResult {
  referenceDate: Date;
  horizonEnd: Date;
  openingPhysicalTreasury: number;
  closingPhysicalTreasury: number;
  physicalLowPoint: number;
  physicalLowPointDate: Date;
  openingFreeCapacity: number;
  closingFreeCapacity: number;
  freeCapacityLowPoint: number;
  freeCapacityLowPointDate: Date;
  firstNegativeDate: Date | null;
  deficitAtFirstNegative: number | null;
  containsEstimates: boolean;
  unknownEventsCount: number;
  isComplete: boolean;
  envisagedEventsTotal: number;
  status: 'OK' | 'TENSION' | 'DEFICIT_PHYSIQUE' | 'INCOMPLETE';
  timeline: TimelinePoint[];
}

function toBudgetLike(budget: {
  referenceAmount: unknown;
  referencePeriod: 'semaine' | 'mois';
  weekStartDay: number;
  startDate: Date;
  endDate: Date | null;
}): BudgetLike {
  return {
    referenceAmount: toNumber(budget.referenceAmount),
    referencePeriod: budget.referencePeriod,
    weekStartDay: budget.weekStartDay,
    startDate: budget.startDate,
    endDate: budget.endDate,
  };
}

async function consommeSurFenetre(tx: TxClient, variableBudgetId: string, start: Date, end: Date): Promise<number> {
  const result = await tx.budgetExpense.aggregate({
    where: { variableBudgetId, spentDate: { gte: start, lt: addDaysUTC(end, 1) } },
    _sum: { amount: true },
  });
  return toNumber(result._sum.amount);
}

/**
 * Événements VariableBudget (§13) — réutilise EXCLUSIVEMENT le moteur Lot 3
 * (semaines/mois calendaires réels, prorata uniquement aux frontières, RG-098) :
 * un événement par frontière de période (jamais une moyenne journalière). La
 * période courante (déjà nette du réalisé, G.8) est bookée à sa fin réelle ;
 * chaque période future entière ou partielle est bookée à sa propre fin, jusqu'à
 * l'horizon — IF-13 : le réalisé (BudgetExpense passées) n'est jamais reprojeté.
 */
async function variableBudgetEvents(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  horizonEnd: Date,
  mode: ProjectionMode,
): Promise<RawEvent[]> {
  const ref = toUtcMidnight(referenceDate);
  const budgets = await tx.variableBudget.findMany({
    where: { householdId, startDate: { lte: horizonEnd }, OR: [{ endDate: null }, { endDate: { gte: ref } }] },
    include: { category: true },
  });

  const events: RawEvent[] = [];
  for (const row of budgets) {
    const budget = toBudgetLike(row);
    const currentWindow = getCurrentPeriodWindow(budget, ref);
    const consommeCourant = await consommeSurFenetre(tx, row.id, currentWindow.start, currentWindow.end);
    const status = computeBudgetPeriodStatus(budget, ref, consommeCourant, mode);
    const currentEventDate = currentWindow.end.getTime() > horizonEnd.getTime() ? horizonEnd : currentWindow.end;
    if (status.projectionPrudenteRestante > 0) {
      events.push({
        date: currentEventDate,
        kind: 'variable_budget',
        label: `${row.category.name} (période courante)`,
        sortKey: row.id,
        physicalImpact: -round2(status.projectionPrudenteRestante),
        reserveImpact: 0,
        amountStatus: 'estime',
      });
    }

    // Périodes futures entières ou partielles jusqu'à l'horizon — un événement par
    // frontière de période réelle (jamais une seule ligne moyennée sur toute la fenêtre).
    let cursor = addDaysUTC(currentWindow.end, 1);
    while (cursor.getTime() <= horizonEnd.getTime()) {
      const period = nominalPeriod(budget.referencePeriod, budget.weekStartDay, cursor);
      const periodEventDate = period.end.getTime() > horizonEnd.getTime() ? horizonEnd : period.end;
      const amount = budgetAmountForWindow(budget, cursor, periodEventDate);
      if (amount > 0) {
        events.push({
          date: periodEventDate,
          kind: 'variable_budget',
          label: `${row.category.name} (période à venir)`,
          sortKey: `${row.id}-${dateKey(period.start)}`,
          physicalImpact: -round2(amount),
          reserveImpact: 0,
          amountStatus: 'estime',
        });
      }
      cursor = addDaysUTC(period.end, 1);
    }
  }
  return events;
}

interface DeadlineCandidate {
  id: string;
  dueDate: Date;
  chargePlanLabel: string;
  resteAPayer: number;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  provisionId: string | null;
}

async function deadlineCandidates(tx: TxClient, householdId: string, referenceDate: Date, horizonEnd: Date): Promise<DeadlineCandidate[]> {
  // Portée certaine uniquement (RG-106) — optionnelle_envisagée traitée séparément (§22).
  const plans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: { in: ['obligatoire', 'optionnelle_souscrite'] } },
    include: { deadlines: true },
  });
  const result: DeadlineCandidate[] = [];
  for (const cp of plans) {
    for (const d of cp.deadlines) {
      if (d.financialStatus === 'annulee' || d.financialStatus === 'soldee') continue;
      if (d.dueDate > horizonEnd) continue; // hors de l'horizon demandé — invisible à cet appel
      if (d.amountStatus === 'inconnu') {
        result.push({ id: d.id, dueDate: d.dueDate, chargePlanLabel: cp.label, resteAPayer: 0, amountStatus: 'inconnu', provisionId: d.provisionId });
        continue;
      }
      const balance = await getDeadlineBalance(tx, d.id);
      result.push({
        id: d.id,
        dueDate: d.dueDate,
        chargePlanLabel: cp.label,
        resteAPayer: round2(balance?.resteAPayer ?? 0),
        amountStatus: d.amountStatus,
        provisionId: d.provisionId,
      });
    }
  }
  return result;
}

/**
 * Moteur principal (§1/§31). `referenceDate`/`horizonEnd` toujours injectés — jamais
 * `new Date()` implicite dans le domaine (cohérent avec les Lots 5/6).
 */
export async function computeProjection(tx: TxClient, householdId: string, referenceDate: Date, horizonEnd: Date): Promise<ProjectionResult> {
  const ref = toUtcMidnight(referenceDate);
  const end = toUtcMidnight(horizonEnd);

  // ---------- G.6a point de départ (§3) : trésorerie opérationnelle RÉELLE actuelle ----------
  const treasury = await computeTreasurySummary(tx, householdId);
  const openingPhysicalTreasury = treasury.tresorerieOperationnelle;

  const settings = await tx.householdSettings.findUnique({ where: { householdId } });
  const coussin = settings ? toNumber(settings.securityMarginAmount) : 0;
  const mode = (settings?.variableBudgetProjectionMode ?? 'prudent_max') as ProjectionMode;

  const accounts = await tx.financialAccount.findMany({ where: { householdId, status: 'actif' } });
  const accountOperational = new Map(accounts.map((a) => [a.id, a.includeInOperationalTreasury]));

  // ---------- Réserves de départ (§9) : solde RÉEL actuel de chaque poche/provision virtuelle ----------
  const pockets = await tx.savingsPocket.findMany({ where: { householdId, allocationMode: 'virtual_allocation' } });
  const provisions = await tx.provision.findMany({ where: { householdId } });
  let openingReserved = 0;
  const pocketBalance = new Map<string, number>();
  for (const p of pockets) {
    const amount = await computePocketCurrentAmount(tx, 'savings_pocket', p.id, p.allocationMode, p.linkedAccountId);
    pocketBalance.set(p.id, amount);
    openingReserved += amount;
  }
  const provisionBalance = new Map<string, number>();
  for (const p of provisions) {
    const amount = await computePocketCurrentAmount(tx, 'provision', p.id, p.allocationMode, p.linkedAccountId);
    provisionBalance.set(p.id, amount);
    if (p.allocationMode === 'virtual_allocation') openingReserved += amount;
  }
  openingReserved = round2(openingReserved);

  let containsEstimates = false;
  let unknownEventsCount = 0;
  const events: RawEvent[] = [];

  // ---------- §23 : revenus prévus (jamais ceux déjà reçus, RG-000/IF-01) ----------
  const incomes = await tx.incomeOccurrence.findMany({
    where: { status: 'prevu', usualDate: { gte: ref, lte: end }, incomeSource: { householdId } },
    include: { incomeSource: true },
  });
  for (const income of incomes) {
    const targetAccountId = income.accountId ?? income.incomeSource.defaultAccountId;
    const operational = accountOperational.get(targetAccountId) ?? true;
    events.push({
      date: income.usualDate,
      kind: 'income',
      label: income.incomeSource.label,
      sortKey: income.id,
      physicalImpact: operational ? round2(toNumber(income.plannedAmount)) : 0,
      reserveImpact: 0,
    });
  }

  // ---------- §25 : transferts planifiés (jamais ceux déjà confirmés, déjà dans le solde réel) ----------
  const transfers = await tx.accountTransfer.findMany({
    where: { householdId, status: 'prevu', plannedDate: { gte: ref, lte: end } },
  });
  for (const t of transfers) {
    const toOp = t.toAccountId ? (accountOperational.get(t.toAccountId) ?? false) : false;
    const fromOp = t.fromAccountId ? (accountOperational.get(t.fromAccountId) ?? false) : false;
    const impact = round2((toOp ? toNumber(t.amount) : 0) - (fromOp ? toNumber(t.amount) : 0));
    if (impact !== 0) {
      events.push({ date: t.plannedDate, kind: 'transfer', label: 'Transfert planifié', sortKey: t.id, physicalImpact: impact, reserveImpact: 0 });
    }
  }

  // ---------- §10/§12 : contributions/retraits planifiés sur poche/provision virtuelle ----------
  // Jamais converti en mouvement réel (RG-000) — seule la RÉSERVE projetée évolue,
  // la trésorerie physique n'est jamais affectée tant que l'argent reste sur le même compte.
  const plannedMovements = await tx.pocketMovement.findMany({
    where: {
      status: 'prevu',
      plannedDate: { gte: ref, lte: end },
      OR: [
        { pocketType: 'savings_pocket', savingsPocket: { householdId, allocationMode: 'virtual_allocation' } },
        { pocketType: 'provision', provision: { householdId, allocationMode: 'virtual_allocation' } },
      ],
    },
    include: { savingsPocket: true, provision: true },
  });
  for (const m of plannedMovements) {
    const amount = toNumber(m.plannedAmount);
    const signed = m.movementType === 'contribution' ? amount : -amount;
    events.push({
      date: m.plannedDate,
      kind: 'pocket_movement',
      label: `${m.pocketType === 'savings_pocket' ? m.savingsPocket?.name : m.provision?.name} — ${m.movementType === 'contribution' ? 'contribution prévue' : 'retrait prévu'}`,
      sortKey: m.id,
      physicalImpact: 0,
      reserveImpact: round2(signed),
      // Ajuste aussi le solde de provision suivi pour la couverture RG-090 des Deadline à venir.
      deadlineId: undefined,
    });
    if (m.pocketType === 'provision' && m.provisionId) {
      provisionBalance.set(m.provisionId, round2((provisionBalance.get(m.provisionId) ?? 0) + signed));
    } else if (m.pocketType === 'savings_pocket' && m.savingsPocketId) {
      pocketBalance.set(m.savingsPocketId, round2((pocketBalance.get(m.savingsPocketId) ?? 0) + signed));
    }
  }
  // NB : les deux lignes ci-dessus pré-appliquent l'effet réserve aux soldes SUIVIS (pour que
  // la couverture RG-090 d'une Deadline plus tardive en tienne compte), mais l'événement de
  // timeline garde sa propre date — la réserve n'apparaît dans le point du jour qu'à sa date.

  // ---------- §12 : GoalContribution prévue, effet cohérent avec son SavingsPocket lié ----------
  const goalContributions = await tx.goalContribution.findMany({
    where: { status: 'prevu', plannedDate: { gte: ref, lte: end }, goal: { householdId } },
    include: { goal: { include: { linkedPocket: true } } },
  });
  for (const gc of goalContributions) {
    const pocket = gc.goal.linkedPocket;
    if (!pocket || pocket.allocationMode !== 'virtual_allocation') continue; // pas de poche liée virtuelle : aucun effet financier projeté (§12)
    const amount = round2(toNumber(gc.plannedAmount));
    events.push({
      date: gc.plannedDate,
      kind: 'pocket_movement',
      label: `${gc.goal.label} — contribution objectif prévue`,
      sortKey: gc.id,
      physicalImpact: 0,
      reserveImpact: amount,
    });
    pocketBalance.set(pocket.id, round2((pocketBalance.get(pocket.id) ?? 0) + amount));
  }

  // ---------- §5/§6/§7/§9 : Deadline (portée certaine), traitées en ORDRE CHRONOLOGIQUE ----------
  // pour faire évoluer correctement le solde de provision suivi (RG-090, séquentiel et exclusif).
  const deadlines = (await deadlineCandidates(tx, householdId, ref, end)).sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id),
  );
  let envisagedEventsTotal = 0;
  for (const d of deadlines) {
    // Une échéance déjà en retard (due_date < aujourd'hui) est projetée dès aujourd'hui —
    // elle reste un engagement certain non réalisé, jamais ignorée (§4).
    const eventDate = d.dueDate < ref ? ref : d.dueDate;

    if (d.amountStatus === 'inconnu') {
      unknownEventsCount += 1;
      continue; // RG-103 : jamais compté 0, exclu des courbes numériques
    }
    if (d.amountStatus === 'estime') containsEstimates = true;
    if (d.resteAPayer <= 0) continue;

    let coverageAffectee = 0;
    let physicalImpact = -d.resteAPayer;

    if (d.provisionId) {
      const provision = provisions.find((p) => p.id === d.provisionId);
      if (provision) {
        const available = Math.max(provisionBalance.get(provision.id) ?? 0, 0);
        coverageAffectee = round2(Math.min(d.resteAPayer, available));
        provisionBalance.set(provision.id, round2(available - coverageAffectee));

        // §6 : virtual_allocation — l'argent couvert est déjà dans le même compte opérationnel,
        // la sortie PHYSIQUE reste le montant total (jamais retirée une deuxième fois).
        // §7 : backed_by_account — seule la part NON couverte sort de la trésorerie opérationnelle
        // SI le compte dédié de la provision est lui-même hors périmètre opérationnel ; si ce
        // compte est resté opérationnel, rien ne change au total (même agrégat).
        if (provision.allocationMode === 'backed_by_account') {
          const linkedOperational = provision.linkedAccountId ? (accountOperational.get(provision.linkedAccountId) ?? false) : false;
          if (!linkedOperational) {
            physicalImpact = -round2(d.resteAPayer - coverageAffectee);
          }
        }
      }
    }
    const engagementNonCouvert = round2(d.resteAPayer - coverageAffectee);

    events.push({
      date: eventDate,
      kind: 'deadline',
      label: d.chargePlanLabel,
      sortKey: d.id,
      physicalImpact: round2(physicalImpact),
      reserveImpact: 0, // la variation de réserve est déjà appliquée directement à provisionBalance ci-dessus
      amountStatus: d.amountStatus,
      deadlineId: d.id,
      engagementNonCouvert,
    });
  }

  // ---------- §13 : budgets variables — moteur Lot 3 exact, un événement par frontière de période ----------
  const budgetEvents = await variableBudgetEvents(tx, householdId, ref, end, mode);
  events.push(...budgetEvents);
  if (budgetEvents.length > 0) containsEstimates = true;

  // ---------- §22 : optionnelle_envisagée — jamais mélangée à la courbe certaine ----------
  const envisagedPlans = await tx.chargePlan.findMany({
    where: { householdId, obligationStatus: 'optionnelle_envisagee' },
    include: { deadlines: true },
  });
  for (const cp of envisagedPlans) {
    for (const d of cp.deadlines) {
      if (d.financialStatus === 'annulee' || d.financialStatus === 'soldee') continue;
      if (d.dueDate > end || d.dueDate < ref) continue;
      if (d.amountStatus === 'inconnu') continue;
      const balance = await getDeadlineBalance(tx, d.id);
      envisagedEventsTotal += balance?.resteAPayer ?? 0;
    }
  }

  // ---------- Construction de la timeline jour par jour (§14) ----------
  events.sort((a, b) => a.date.getTime() - b.date.getTime() || KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || a.sortKey.localeCompare(b.sortKey));
  const eventsByDay = new Map<string, RawEvent[]>();
  for (const e of events) {
    const key = dateKey(e.date);
    if (!eventsByDay.has(key)) eventsByDay.set(key, []);
    eventsByDay.get(key)!.push(e);
  }
  // Fenêtre "engagé" (§8) : pour chaque jour, la somme des engagement_non_couvert des
  // Deadline dont la due_date (réelle, non clampée) est STRICTEMENT postérieure à ce jour et
  // ≤ horizonEnd — tout ce qui n'a pas encore quitté la trésorerie physique dans la simulation.
  const engagedDeadlineEvents = events.filter((e) => e.kind === 'deadline' && e.engagementNonCouvert !== undefined);

  const timeline: TimelinePoint[] = [];
  let physicalRunning = openingPhysicalTreasury;
  let reservedRunning = openingReserved;
  let physicalLowPoint = openingPhysicalTreasury;
  let physicalLowPointDate = ref;
  let freeCapacityLowPoint: number | null = null;
  let freeCapacityLowPointDate = ref;
  let firstNegativeDate: Date | null = null;
  let deficitAtFirstNegative: number | null = null;
  let openingFreeCapacity = 0;
  let closingFreeCapacity = 0;

  for (let cursor = new Date(ref); cursor.getTime() <= end.getTime(); cursor = addDaysUTC(cursor, 1)) {
    const key = dateKey(cursor);
    const dayEvents = eventsByDay.get(key) ?? [];
    const summaries: ProjectionEventSummary[] = [];
    for (const e of dayEvents) {
      physicalRunning = round2(physicalRunning + (e.physicalImpact ?? 0));
      reservedRunning = round2(reservedRunning + (e.reserveImpact ?? 0));
      const signed = round2((e.physicalImpact ?? 0) + (e.reserveImpact ?? 0));
      if (signed !== 0) summaries.push({ label: e.label, amount: signed, kind: e.kind });
    }

    const engagedAmount = round2(
      engagedDeadlineEvents.filter((e) => e.date.getTime() > cursor.getTime()).reduce((sum, e) => sum + (e.engagementNonCouvert ?? 0), 0),
    );
    const freeCapacity = round2(physicalRunning - reservedRunning - engagedAmount - coussin);

    timeline.push({ date: key, physicalTreasury: physicalRunning, reservedAmount: reservedRunning, engagedAmount, freeCapacity, events: summaries });

    if (cursor.getTime() === ref.getTime()) {
      openingFreeCapacity = freeCapacity;
    }
    closingFreeCapacity = freeCapacity;

    if (physicalRunning < physicalLowPoint) {
      physicalLowPoint = physicalRunning;
      physicalLowPointDate = new Date(cursor);
    }
    if (freeCapacityLowPoint === null || freeCapacity < freeCapacityLowPoint) {
      freeCapacityLowPoint = freeCapacity;
      freeCapacityLowPointDate = new Date(cursor);
    }
    if (firstNegativeDate === null && physicalRunning < 0) {
      firstNegativeDate = new Date(cursor);
      deficitAtFirstNegative = physicalRunning;
    }
  }

  const closingPhysicalTreasury = physicalRunning;
  const isComplete = unknownEventsCount === 0;

  let status: ProjectionResult['status'];
  if (!isComplete) status = 'INCOMPLETE';
  else if (physicalLowPoint < 0) status = 'DEFICIT_PHYSIQUE';
  else if ((freeCapacityLowPoint ?? 0) < 0) status = 'TENSION';
  else status = 'OK';

  return {
    referenceDate: ref,
    horizonEnd: end,
    openingPhysicalTreasury: round2(openingPhysicalTreasury),
    closingPhysicalTreasury: round2(closingPhysicalTreasury),
    physicalLowPoint: round2(physicalLowPoint),
    physicalLowPointDate,
    openingFreeCapacity: round2(openingFreeCapacity),
    closingFreeCapacity: round2(closingFreeCapacity),
    freeCapacityLowPoint: round2(freeCapacityLowPoint ?? 0),
    freeCapacityLowPointDate,
    firstNegativeDate,
    deficitAtFirstNegative: deficitAtFirstNegative === null ? null : round2(deficitAtFirstNegative),
    containsEstimates,
    unknownEventsCount,
    isComplete,
    envisagedEventsTotal: round2(envisagedEventsTotal),
    status,
    timeline,
  };
}
