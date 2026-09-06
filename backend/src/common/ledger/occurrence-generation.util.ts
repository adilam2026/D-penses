import { Prisma } from '@prisma/client';
import { occurrenceDatesInRange, toUtcMidnight, RecurrenceRule } from './recurrence.util';

type TxClient = Prisma.TransactionClient;

/**
 * Génération idempotente des IncomeOccurrence/Deadline futures (Lot 11, §1).
 * Appelée par chaque consommateur (Dashboard/Projection/Calendar/Simulator)
 * AVANT sa propre lecture, avec SON PROPRE horizonEnd déjà calculé — jamais
 * une constante globale arbitraire (§3 refonte). Toujours dans la même
 * transaction rlsContext.run() que l'appelant.
 *
 * PRÉVU ≠ RÉEL (§4) : ne crée jamais que du prévu/ouvert — IncomeOccurrence
 * générée = status 'prevu' (jamais 'recu'), Deadline générée = financialStatus
 * par défaut 'ouverte' (jamais soldée/payée). Seule une action explicite de
 * l'utilisateur (confirmOccurrence/createPayment) fait passer au réel.
 *
 * Concurrence (§16) : createMany + skipDuplicates s'appuie sur les contraintes
 * uniques (income_source_id, usual_date) et (charge_plan_id, due_date) —
 * Postgres résout nativement les conflits (ON CONFLICT DO NOTHING), sans
 * verrou explicite ni gestion d'erreur P2002 manuelle. Deux appels
 * concurrents sur le même horizon convergent vers le même état final, sans
 * doublon ni exception.
 */
export async function ensureIncomeOccurrencesUntil(tx: TxClient, householdId: string, horizonEnd: Date): Promise<void> {
  const sources = await tx.incomeSource.findMany({
    where: {
      householdId,
      isRecurring: true,
      recurrenceAnchorDate: { not: null },
      recurrenceRule: { notIn: ['ponctuel'] },
      status: 'actif',
    },
  });
  if (sources.length === 0) return;

  const rows: Prisma.IncomeOccurrenceCreateManyInput[] = [];
  for (const source of sources) {
    if (!source.recurrenceAnchorDate || !source.recurrenceRule) continue;
    const dates = occurrenceDatesInRange(source.recurrenceRule as RecurrenceRule, source.recurrenceAnchorDate, source.recurrenceAnchorDate, horizonEnd);
    for (const usualDate of dates) {
      rows.push({ incomeSourceId: source.id, usualDate, plannedAmount: source.usualAmount });
    }
  }
  if (rows.length === 0) return;

  await tx.incomeOccurrence.createMany({ data: rows, skipDuplicates: true });
}

/**
 * Hiérarchie du montant estimé pour une Deadline auto-générée (§2, verrouillée
 * avec l'utilisateur) — ChargePlan n'a AUCUN champ de montant de référence
 * (vérifié dans le schéma) :
 *  1. dernière échéance EXISTANTE du même ChargePlan avec amount_status =
 *     confirme (la plus proche dans le temps, due_date desc) ;
 *  2. sinon dernière échéance EXISTANTE avec amount_status = estime ;
 *  3. sinon amountCurrent = null, amountStatus = inconnu (jamais 0, RG-103).
 * Une facture exceptionnelle reste isolée : elle ne devient jamais la
 * référence des mois suivants QUE si elle est la plus RÉCENTE échéance
 * confirmée au moment de la génération — comportement assumé et documenté,
 * pas un calcul silencieux (cf. rapport de livraison Lot 1).
 */
async function resolveReferenceAmount(tx: TxClient, chargePlanId: string): Promise<{ amountCurrent: Prisma.Decimal | number | null; amountStatus: 'estime' | 'inconnu' }> {
  const confirmed = await tx.deadline.findFirst({
    where: { chargePlanId, amountStatus: 'confirme', amountCurrent: { not: null } },
    orderBy: { dueDate: 'desc' },
  });
  if (confirmed) return { amountCurrent: confirmed.amountCurrent, amountStatus: 'estime' };

  const estimated = await tx.deadline.findFirst({
    where: { chargePlanId, amountStatus: 'estime', amountCurrent: { not: null } },
    orderBy: { dueDate: 'desc' },
  });
  if (estimated) return { amountCurrent: estimated.amountCurrent, amountStatus: 'estime' };

  return { amountCurrent: null, amountStatus: 'inconnu' };
}

export async function ensureChargeDeadlinesUntil(tx: TxClient, householdId: string, horizonEnd: Date): Promise<void> {
  const plans = await tx.chargePlan.findMany({
    where: {
      householdId,
      generationMode: 'auto_frequence',
      recurrenceRule: { notIn: ['ponctuel'] },
      status: 'actif',
    },
  });
  if (plans.length === 0) return;

  for (const plan of plans) {
    if (!plan.recurrenceRule) continue;
    const effectiveEnd = plan.endDate && plan.endDate.getTime() < horizonEnd.getTime() ? plan.endDate : horizonEnd;
    const dates = occurrenceDatesInRange(plan.recurrenceRule as RecurrenceRule, plan.startDate, plan.startDate, toUtcMidnight(effectiveEnd));
    if (dates.length === 0) continue;

    // Référence résolue une fois par plan, sur l'état déjà existant en base —
    // jamais recalculée entre deux lignes du même appel (§2 : pas de propagation
    // en cascade d'une échéance qu'on vient tout juste de générer soi-même).
    const reference = await resolveReferenceAmount(tx, plan.id);

    const rows: Prisma.DeadlineCreateManyInput[] = dates.map((dueDate) => ({
      chargePlanId: plan.id,
      dueDate,
      amountCurrent: reference.amountCurrent,
      amountStatus: reference.amountStatus,
      // §3 (verrouillé) : jamais de date de facturation inventée — aucune règle de
      // facturation n'existe dans le modèle ChargePlan actuel.
      expectedBillingDate: null,
    }));

    await tx.deadline.createMany({ data: rows, skipDuplicates: true });
  }
}
