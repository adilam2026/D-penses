import { Prisma } from '@prisma/client';
import { getAccountBalance, getDeadlineBalance, round2, toNumber } from './ledger.util';

type TxClient = Prisma.TransactionClient;

/**
 * Moteur SavingsPocket/Provision (docs/02-modele-metier.md §E.5/E.5bis/E.5ter,
 * RG-070→074, RG-090→097, RG-032bis). Source de vérité unique pour :
 *  - current_amount d'une poche/provision (RG-071/IF-07/IF-08) ;
 *  - la couverture chronologique Provision → Deadline (RG-090/IF-16/IF-17/IF-18) ;
 *  - la suffisance temporelle par palier (RG-032bis/RG-032ter).
 * Jamais recopié ailleurs (treasury.util, financial-plans.service, pockets/provisions
 * modules réutilisent EXCLUSIVEMENT ces fonctions).
 */

export type AllocationMode = 'virtual_allocation' | 'backed_by_account';
export type PocketType = 'savings_pocket' | 'provision';

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * current_amount (RG-071) :
 *  - backed_by_account : lecture directe du solde du compte dédié (IF-08) — jamais
 *    une valeur stockée séparément, jamais un second calcul de solde recopié.
 *  - virtual_allocation : Σ PocketMovement CONFIRMÉS, signés selon movement_type
 *    (contribution = +, retrait = −) — jamais une colonne autoritaire (IF-07).
 */
export async function computePocketCurrentAmount(
  tx: TxClient,
  pocketType: PocketType,
  pocketId: string,
  allocationMode: AllocationMode,
  linkedAccountId: string | null,
): Promise<number> {
  if (allocationMode === 'backed_by_account') {
    if (!linkedAccountId) return 0;
    return getAccountBalance(tx, linkedAccountId);
  }
  const where = pocketType === 'savings_pocket' ? { savingsPocketId: pocketId } : { provisionId: pocketId };
  const movements = await tx.pocketMovement.findMany({ where: { ...where, pocketType, status: 'confirme' } });
  let total = 0;
  for (const m of movements) {
    const amount = toNumber(m.actualAmount);
    total += m.movementType === 'contribution' ? amount : -amount;
  }
  return round2(total);
}

// ---------- RG-090 — Couverture chronologique Provision → Deadline ----------

export interface DeadlineForCoverage {
  id: string;
  dueDate: Date;
  resteAPayer: number;
}

export interface CoverageItem {
  deadlineId: string;
  dueDate: Date;
  resteAPayer: number;
  coverageAffectee: number;
  engagementNonCouvert: number;
}

/**
 * RG-090 : allocation strictement chronologique (due_date croissante, id en
 * départage déterministe) et exclusive (IF-17) — une même unité de current_amount
 * ne couvre jamais deux échéances. RG-091 : sans provision (non appelé ici), coverage=0.
 */
export function allocateProvisionCoverage(provisionAvailable: number, deadlines: DeadlineForCoverage[]): CoverageItem[] {
  const sorted = [...deadlines].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));
  let disponible = round2(Math.max(provisionAvailable, 0));
  const results: CoverageItem[] = [];
  for (const d of sorted) {
    const coverageAffectee = round2(Math.min(d.resteAPayer, disponible));
    disponible = round2(disponible - coverageAffectee);
    results.push({
      deadlineId: d.id,
      dueDate: d.dueDate,
      resteAPayer: round2(d.resteAPayer),
      coverageAffectee,
      engagementNonCouvert: round2(d.resteAPayer - coverageAffectee),
    });
  }
  return results;
}

/** Échéances liées à une Provision, ouvertes/partiellement payées, avec reste_a_payer connu (RG-103 : montant inconnu exclu, jamais 0). */
async function linkedOpenDeadlines(tx: TxClient, provisionId: string): Promise<DeadlineForCoverage[]> {
  const deadlines = await tx.deadline.findMany({
    where: { provisionId, financialStatus: { in: ['ouverte', 'partiellement_payee'] } },
  });
  const result: DeadlineForCoverage[] = [];
  for (const d of deadlines) {
    if (d.amountStatus === 'inconnu') continue; // RG-103 : jamais compté, ni couvert, ni engagé pour 0
    const balance = await getDeadlineBalance(tx, d.id);
    result.push({ id: d.id, dueDate: d.dueDate, resteAPayer: balance?.resteAPayer ?? 0 });
  }
  return result;
}

export interface ProvisionCoverage {
  provisionId: string;
  currentAmount: number;
  items: CoverageItem[];
}

/**
 * Couverture complète d'une Provision — TOUJOURS calculée sur la totalité de ses
 * Deadline liées ouvertes (jamais restreinte à un horizon de calcul, cf. G.4/RG-090) :
 * l'horizon ne filtre que quelles échéances ENTRENT dans Montants_engagés, jamais
 * comment la provision se répartit entre elles.
 */
export async function computeProvisionCoverage(tx: TxClient, provisionId: string): Promise<ProvisionCoverage> {
  const provision = await tx.provision.findUniqueOrThrow({ where: { id: provisionId } });
  const currentAmount = await computePocketCurrentAmount(tx, 'provision', provisionId, provision.allocationMode, provision.linkedAccountId);
  const deadlines = await linkedOpenDeadlines(tx, provisionId);
  const items = allocateProvisionCoverage(currentAmount, deadlines);
  return { provisionId, currentAmount, items };
}

/** engagement_non_couvert(deadline) — RG-090/RG-091. Sans provision liée : coverage=0, engagement=reste_a_payer. */
export async function engagementNonCouvert(tx: TxClient, deadlineId: string): Promise<{ coverageAffectee: number; engagementNonCouvert: number } | null> {
  const deadline = await tx.deadline.findUnique({ where: { id: deadlineId } });
  if (!deadline) return null;
  const balance = await getDeadlineBalance(tx, deadlineId);
  if (!balance || balance.resteAPayer === null) return null; // amount_status = inconnu (RG-103)
  if (!deadline.provisionId) return { coverageAffectee: 0, engagementNonCouvert: round2(balance.resteAPayer) }; // RG-091
  const coverage = await computeProvisionCoverage(tx, deadline.provisionId);
  const item = coverage.items.find((i) => i.deadlineId === deadlineId);
  return item ? { coverageAffectee: item.coverageAffectee, engagementNonCouvert: item.engagementNonCouvert } : { coverageAffectee: 0, engagementNonCouvert: round2(balance.resteAPayer) };
}

// ---------- RG-032bis/RG-032ter — Suffisance temporelle ----------

export interface SufficiencyStep {
  deadlineId: string;
  dueDate: Date;
  resteAPayer: number;
  cumulativeNeed: number; // R_i
  moisRestants: number; // (dueDate - referenceDate) en jours / 30, jamais négatif (borné à 0)
  gap: number; // R_i - current_amount, jamais négatif (0 si déjà suffisant à ce palier)
  tauxRequis: number | null; // gap / moisRestants — null si moisRestants < 1 (RG-032ter, non actionnable)
}

export interface MonthlyRecommendation {
  month: string; // "YYYY-MM"
  recommendedAmount: number;
}

export interface ProvisionSufficiency {
  provisionId: string;
  currentAmount: number;
  steps: SufficiencyStep[];
  versementMensuelRecommande: number; // max_i(tauxRequis) sur les paliers où gap > 0 et moisRestants >= 1
  tensionAlert: { deadlineId: string; dueDate: Date; manque: number } | null; // RG-032ter
  monthlyCalendar: MonthlyRecommendation[]; // RG-032bis étendu — calendrier mensuel nommé, cf. buildMonthlyRecommendationCalendar
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthsBetweenInclusive(start: Date, end: Date): string[] {
  const months: string[] = [];
  let cur = start;
  while (cur.getTime() <= end.getTime()) {
    months.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return months;
}

/**
 * Calendrier mensuel de recommandation (extension RG-032bis, refonte maquette
 * V6B §8) — jamais un montant unique : produit une recommandation PAR MOIS
 * nommé, à partir UNIQUEMENT du disponible réel (currentAmount, issu des seuls
 * versements confirmés) et des paliers déjà calculés par computeProvisionSufficiency
 * (jamais un second moteur de calcul, jamais de mensualité stockée en base —
 * toujours recalculée). Pour chaque palier, le besoin incrémental (au-delà de
 * ce que le palier précédent devait déjà couvrir) est réparti sur les mois
 * calendaires allant du mois suivant le palier précédent (ou le mois suivant
 * referenceDate pour le premier palier) jusqu'au mois de l'échéance inclus —
 * le dernier mois du segment reçoit le reliquat d'arrondi ("le solde restant").
 * Une fois un palier échu, son montant cumulatif devient la nouvelle base : le
 * palier suivant ne finance que son propre delta, jamais une redite du
 * précédent (§ "après paiement d'une échéance, bascule automatique").
 */
export function buildMonthlyRecommendationCalendar(
  currentAmount: number,
  steps: { dueDate: Date; cumulativeNeed: number }[],
  referenceDate: Date,
): MonthlyRecommendation[] {
  const result: MonthlyRecommendation[] = [];
  let segmentStart = addMonths(monthStart(referenceDate), 1);
  let baseline = currentAmount;

  for (const step of steps) {
    const dueMonth = monthStart(step.dueDate);
    const start = segmentStart.getTime() <= dueMonth.getTime() ? segmentStart : dueMonth;
    const months = monthsBetweenInclusive(start, dueMonth);
    const gap = round2(Math.max(step.cumulativeNeed - baseline, 0));

    if (gap <= 0) {
      for (const m of months) result.push({ month: m, recommendedAmount: 0 });
    } else {
      const per = Math.floor((gap / months.length) * 100) / 100;
      let allocated = 0;
      months.forEach((m, idx) => {
        const isLast = idx === months.length - 1;
        const amount = isLast ? round2(gap - allocated) : per;
        allocated = round2(allocated + amount);
        result.push({ month: m, recommendedAmount: amount });
      });
    }

    baseline = step.cumulativeNeed;
    segmentStart = addMonths(dueMonth, 1);
  }

  return result;
}

/**
 * RG-032bis : calcul par palier (jamais un simple reste_global/mois_restants_global,
 * qui sous-provisionnerait une échéance intermédiaire, cf. doc06 §4 "preuve du calcul naïf").
 * mois_restants = jours_restants / 30 (calibré sur doc06 §4 : 46j ≈ 1,53 mois, 107j ≈ 3,57 mois).
 */
export async function computeProvisionSufficiency(tx: TxClient, provisionId: string, referenceDate: Date): Promise<ProvisionSufficiency> {
  const provision = await tx.provision.findUniqueOrThrow({ where: { id: provisionId } });
  const currentAmount = await computePocketCurrentAmount(tx, 'provision', provisionId, provision.allocationMode, provision.linkedAccountId);
  const ref = toUtcMidnight(referenceDate);
  const deadlines = (await linkedOpenDeadlines(tx, provisionId)).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.id.localeCompare(b.id));

  const steps: SufficiencyStep[] = [];
  let cumulative = 0;
  let versementMensuelRecommande = 0;
  let tensionAlert: ProvisionSufficiency['tensionAlert'] = null;

  for (const d of deadlines) {
    cumulative = round2(cumulative + d.resteAPayer);
    const joursRestants = Math.round((toUtcMidnight(d.dueDate).getTime() - ref.getTime()) / 86400000);
    const moisRestants = round2(Math.max(joursRestants, 0) / 30);
    const gap = round2(Math.max(cumulative - currentAmount, 0));

    let tauxRequis: number | null = null;
    if (gap > 0) {
      if (moisRestants < 1) {
        // RG-032ter : échéance imminente sous-financée — alerte de tension, jamais un taux mensuel absurde.
        if (!tensionAlert) tensionAlert = { deadlineId: d.id, dueDate: d.dueDate, manque: gap };
      } else {
        tauxRequis = round2(gap / moisRestants);
        versementMensuelRecommande = Math.max(versementMensuelRecommande, tauxRequis);
      }
    }

    steps.push({ deadlineId: d.id, dueDate: d.dueDate, resteAPayer: d.resteAPayer, cumulativeNeed: cumulative, moisRestants, gap, tauxRequis });
  }

  const monthlyCalendar = buildMonthlyRecommendationCalendar(
    currentAmount,
    steps.map((s) => ({ dueDate: s.dueDate, cumulativeNeed: s.cumulativeNeed })),
    ref,
  );

  return { provisionId, currentAmount, steps, versementMensuelRecommande: round2(versementMensuelRecommande), tensionAlert, monthlyCalendar };
}
