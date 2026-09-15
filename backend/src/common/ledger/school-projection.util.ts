import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { round2, toNumber } from './ledger.util';
import { financialPeriodKeyOf } from './financial-period.util';

type TxClient = Prisma.TransactionClient;

const SCHOOL_YEAR_PATTERN = /^(\d{4})\/(\d{4})$/;

export type SchoolProjectionIncreaseType = 'aucune' | 'fixe' | 'pourcentage';

/**
 * M9 — année scolaire structurée "YYYY/YYYY" (ex. "2026/2027"), jamais dérivée de
 * periodStart/periodEnd (RG explicite, cf. rapport M9). Rejette tout format libre.
 */
export function parseSchoolYear(schoolYear: string): { startYear: number; endYear: number } {
  const match = SCHOOL_YEAR_PATTERN.exec(schoolYear);
  if (!match) throw new Error(`Année scolaire invalide : "${schoolYear}" (format attendu AAAA/AAAA)`);
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  if (endYear !== startYear + 1) throw new Error(`Année scolaire invalide : "${schoolYear}" (la seconde année doit suivre immédiatement la première)`);
  return { startYear, endYear };
}

/** Décale une année scolaire structurée de `offset` années (ex. "2026/2027" + 1 → "2027/2028"). */
export function shiftSchoolYear(schoolYear: string, offset: number): string {
  const { startYear } = parseSchoolYear(schoolYear);
  return `${startYear + offset}/${startYear + offset + 1}`;
}

/**
 * Décalage de date déterministe par année civile — même mois/jour, année+offset.
 * 29 février d'une cible non bissextile → 28 février (jamais un débordement sur mars,
 * cas limite documenté, sans impact pratique sur des échéances scolaires).
 */
export function addYears(date: Date, offset: number): Date {
  const year = date.getUTCFullYear() + offset;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const isFeb29 = month === 1 && day === 29;
  const targetIsLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return new Date(Date.UTC(year, month, isFeb29 && !targetIsLeap ? 28 : day));
}

/**
 * M9 §6 — la règle part TOUJOURS du montant de référence de l'année précédente
 * (réelle ou déjà projetée), jamais un recalcul depuis l'origine de la chaîne.
 * Arrondi monétaire déterministe (round2, même convention que tout le reste du
 * moteur ledger) — testé explicitement pour fixe et pourcentage (cf. lot43).
 */
export function computeProjectedAmount(referenceAmount: number, increaseType: SchoolProjectionIncreaseType, increaseValue: number | null): number {
  if (increaseType === 'aucune') return round2(referenceAmount);
  if (increaseType === 'fixe') return round2(referenceAmount + (increaseValue ?? 0));
  return round2(referenceAmount * (1 + (increaseValue ?? 0) / 100));
}

/**
 * M9 §4 — transformation prévision→réel : matérialise le remplacement d'UNE
 * prévision par la vraie Deadline qui vient d'être créée (jamais une suppression,
 * jamais les deux comptées à la fois). Appelée DANS la transaction RLS de
 * l'appelant (school-wizard) — jamais un second contexte RLS. `status='projete'`
 * exigé en entrée : une prévision déjà remplacée ne peut jamais l'être une
 * seconde fois (chaque ligne réelle → au plus une prévision source).
 */
export async function markSchoolProjectionReplaced(
  tx: TxClient,
  householdId: string,
  projectionId: string,
  replacedByFinancialPlanId: string,
  replacedByDeadlineId: string,
) {
  const projection = await tx.schoolProjection.findFirst({ where: { id: projectionId, householdId, status: 'projete' } });
  if (!projection) throw new NotFoundException('Prévision introuvable, ou déjà remplacée par un autre plan');
  return tx.schoolProjection.update({
    where: { id: projectionId },
    data: { status: 'remplacee', replacedByFinancialPlanId, replacedByDeadlineId },
  });
}

/**
 * M9B §1 — ligne d'hypothèse future pour la Projection longue durée. Jamais dans
 * income_items/expense_items (§8, purement additif) : aucun champ ici n'est
 * sommé dans total_income/total_expense/balance/cumulative_balance/
 * projected_cash_balance — engagements connus/prudent restent calculés
 * exactement comme avant M9.
 */
export interface SchoolProjectionMonthlyItem {
  id: string;
  label: string;
  childId: string;
  childFirstName: string;
  date: string; // ISO, targetDate exact
  amount: number;
  schoolYear: string;
}

/**
 * M9B §1 — regroupe les SchoolProjection ACTIVES (status=projete) dont la
 * targetDate tombe dans [referenceDate, horizonEnd], par période financière
 * (même clé que monthly-projection.util.ts, closingDay du foyer) — jamais un
 * second découpage divergent. Une prévision remplacee n'apparaît JAMAIS ici :
 * la vraie Deadline qui l'a remplacée est déjà comptée normalement par
 * computeMonthlyProjection, dans income_items/expense_items.
 */
export async function schoolProjectionMonthlyItems(
  tx: TxClient,
  householdId: string,
  referenceDate: Date,
  horizonEnd: Date,
  closingDay: number,
): Promise<Map<string, SchoolProjectionMonthlyItem[]>> {
  const rows = await tx.schoolProjection.findMany({
    where: { householdId, status: 'projete', targetDate: { gte: referenceDate, lte: horizonEnd } },
    include: { child: { select: { firstName: true } } },
    orderBy: { targetDate: 'asc' },
  });

  const byMonth = new Map<string, SchoolProjectionMonthlyItem[]>();
  for (const row of rows) {
    const key = financialPeriodKeyOf(row.targetDate, closingDay);
    const item: SchoolProjectionMonthlyItem = {
      id: row.id,
      label: row.label,
      childId: row.childId,
      childFirstName: row.child.firstName,
      date: row.targetDate.toISOString(),
      amount: toNumber(row.computedAmount),
      schoolYear: row.schoolYear,
    };
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(item);
  }
  return byMonth;
}
