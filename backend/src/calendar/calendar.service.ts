import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { contextualLabel, toNumber } from '../common/ledger/ledger.util';
import { computeHorizon, DASHBOARD_FALLBACK_HORIZON_DAYS } from '../common/ledger/treasury.util';
import { ensureChargeDeadlinesUntil, ensureIncomeOccurrencesUntil, ensureRecurringTransfersUntil } from '../common/ledger/occurrence-generation.util';

export type CalendarEventKind = 'revenu_prevu' | 'facture_attendue' | 'echeance' | 'montant_inconnu' | 'echeance_payee' | 'transfert_prevu';

export interface CalendarEvent {
  date: Date;
  kind: CalendarEventKind;
  label: string;
  amount: number | null;
  deadlineId?: string;
  incomeOccurrenceId?: string;
  // M5 — cible du clic « revenu prévu » : id de l'IncomeSource (jamais l'occurrence,
  // qui n'a pas d'écran de détail propre), même patron que deadlineId côté échéances.
  incomeSourceId?: string;
  // M5 — cible du clic « transfert planifié » : id du RecurringTransfer parent.
  recurringTransferId?: string;
  // Point 5 — vue "Par catégorie / plan financier" (mobile) : uniquement pour
  // les événements liés à une Deadline. financialPlanId prime (le libellé du
  // FinancialPlan, ex. "Voiture · Opel Astra", est déjà composé/stocké tel
  // quel au moment de sa création — jamais recomposé ici), sinon la catégorie
  // du poste, sinon aucun regroupement (le mobile applique alors "Autres").
  // Additif uniquement : ne change ni le tri ni la portée des événements déjà
  // renvoyés — même liste, mêmes champs existants, jamais dupliquée.
  financialPlanId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
}

/**
 * Calendrier financier (§14/§15) — vue purement DÉRIVÉE des entités existantes
 * (IncomeOccurrence, Deadline) : aucune table CalendarEvent persistée. Une
 * Deadline avec expected_billing_date ET due_date produit DEUX événements
 * d'affichage (« facture attendue » le 12, « échéance » le 28) à partir d'UNE
 * seule Deadline métier — jamais de doublon dans Montants_engagés, jamais de
 * Payment créé par ces dates (§15, RG-100).
 */
@Injectable()
export class CalendarService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async listEvents(userId: string, householdId: string, referenceDate: Date, from?: Date, to?: Date) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      // Lot 11 (§1/§3) : génération AVANT lecture, avec l'horizon que CE consommateur
      // a réellement besoin — explicite si `to` est fourni, sinon même repli que H*
      // (DASHBOARD_FALLBACK_HORIZON_DAYS) pour que computeHorizon() voie les
      // occurrences fraîchement générées avant de calculer son propre horizon.
      const generationHorizon = to ?? new Date(referenceDate.getTime() + DASHBOARD_FALLBACK_HORIZON_DAYS * 86400000);
      await ensureIncomeOccurrencesUntil(tx, householdId, generationHorizon);
      await ensureChargeDeadlinesUntil(tx, householdId, generationHorizon);
      await ensureRecurringTransfersUntil(tx, householdId, generationHorizon);

      const rangeStart = from ?? referenceDate;
      const rangeEnd = to ?? (await computeHorizon(tx, householdId, referenceDate)).date;

      const events: CalendarEvent[] = [];

      const incomes = await tx.incomeOccurrence.findMany({
        where: { status: 'prevu', usualDate: { gte: rangeStart, lte: rangeEnd }, incomeSource: { householdId } },
        include: { incomeSource: true },
      });
      for (const income of incomes) {
        events.push({
          date: income.usualDate,
          kind: 'revenu_prevu',
          label: income.incomeSource.label,
          amount: toNumber(income.plannedAmount),
          incomeOccurrenceId: income.id,
          incomeSourceId: income.incomeSourceId,
        });
      }

      const deadlines = await tx.deadline.findMany({
        where: {
          chargePlan: { householdId },
          // Corrections UI/UX (point 8) — une échéance annulée (plan supprimé,
          // poste retiré, correction manuelle...) ne doit plus jamais réapparaître
          // au Calendrier comme si elle était encore due : même exclusion déjà
          // appliquée partout ailleurs (projection.util.ts, treasury.util.ts).
          financialStatus: { not: 'annulee' },
          OR: [
            { dueDate: { gte: rangeStart, lte: rangeEnd } },
            { expectedBillingDate: { gte: rangeStart, lte: rangeEnd } },
          ],
        },
        include: {
          chargePlan: { include: { vehicle: true, housing: true, financialPlan: true, category: true, children: { include: { child: true } } } },
        },
      });
      for (const d of deadlines) {
        // M7+M8 (guard-rail §4/§14) — "Libellé · Entité", jamais stocké dans chargePlan.label.
        const label = contextualLabel(d.chargePlan.label, {
          vehicleName: d.chargePlan.vehicle?.name,
          housingName: d.chargePlan.housing?.name,
          travelDestination: d.chargePlan.financialPlan?.planType === 'travel' ? d.chargePlan.financialPlan.destination : undefined,
          childName: d.chargePlan.children.length === 1 ? d.chargePlan.children[0].child.firstName : undefined,
        });
        const financialPlanId = d.chargePlan.financialPlanId;
        const categoryId = d.chargePlan.categoryId;
        const categoryName = d.chargePlan.category?.name ?? null;

        // Facture attendue (RG-100) — événement distinct de l'échéance, uniquement si non encore reçue.
        if (d.expectedBillingDate && d.expectedBillingDate >= rangeStart && d.expectedBillingDate <= rangeEnd && d.billingDate === null) {
          events.push({
            date: d.expectedBillingDate,
            kind: 'facture_attendue',
            label: `${label} — facture attendue`,
            amount: null,
            deadlineId: d.id,
            financialPlanId,
            categoryId,
            categoryName,
          });
        }

        if (d.dueDate >= rangeStart && d.dueDate <= rangeEnd) {
          let kind: CalendarEventKind;
          if (d.financialStatus === 'soldee') kind = 'echeance_payee';
          else if (d.amountStatus === 'inconnu') kind = 'montant_inconnu';
          else kind = 'echeance';

          events.push({
            date: d.dueDate,
            kind,
            label,
            amount: d.amountCurrent === null ? null : toNumber(d.amountCurrent),
            deadlineId: d.id,
            financialPlanId,
            categoryId,
            categoryName,
          });
        }
      }

      // M5 — transferts planifiés (occurrences 'prevu' générées par un RecurringTransfer,
      // ensureRecurringTransfersUntil déjà appelé ci-dessus) : un transfert ponctuel manuel
      // est confirmé immédiatement (AccountsService.createTransfer, RG-085) et n'a donc
      // jamais status='prevu' — recurringTransferId non null suffit à cibler exactement
      // les occurrences récurrentes, jamais un second filtre redondant.
      const transfers = await tx.accountTransfer.findMany({
        where: { householdId, status: 'prevu', recurringTransferId: { not: null }, plannedDate: { gte: rangeStart, lte: rangeEnd } },
        include: { recurringTransfer: true },
      });
      for (const t of transfers) {
        events.push({
          date: t.plannedDate,
          kind: 'transfert_prevu',
          label: t.recurringTransfer?.label ?? 'Transfert planifié',
          amount: toNumber(t.amount),
          recurringTransferId: t.recurringTransferId ?? undefined,
        });
      }

      events.sort((a, b) => a.date.getTime() - b.date.getTime());
      return { from: rangeStart, to: rangeEnd, events };
    });
  }
}
