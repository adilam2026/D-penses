import { Injectable } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { toNumber } from '../common/ledger/ledger.util';
import { computeHorizon } from '../common/ledger/treasury.util';

export type CalendarEventKind = 'revenu_prevu' | 'facture_attendue' | 'echeance' | 'montant_inconnu' | 'echeance_payee';

export interface CalendarEvent {
  date: Date;
  kind: CalendarEventKind;
  label: string;
  amount: number | null;
  deadlineId?: string;
  incomeOccurrenceId?: string;
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
      const rangeStart = from ?? referenceDate;
      const rangeEnd = to ?? (await computeHorizon(tx, householdId, referenceDate));

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
        });
      }

      const deadlines = await tx.deadline.findMany({
        where: {
          chargePlan: { householdId },
          OR: [
            { dueDate: { gte: rangeStart, lte: rangeEnd } },
            { expectedBillingDate: { gte: rangeStart, lte: rangeEnd } },
          ],
        },
        include: { chargePlan: true },
      });
      for (const d of deadlines) {
        // Facture attendue (RG-100) — événement distinct de l'échéance, uniquement si non encore reçue.
        if (d.expectedBillingDate && d.expectedBillingDate >= rangeStart && d.expectedBillingDate <= rangeEnd && d.billingDate === null) {
          events.push({
            date: d.expectedBillingDate,
            kind: 'facture_attendue',
            label: `${d.chargePlan.label} — facture attendue`,
            amount: null,
            deadlineId: d.id,
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
            label: d.chargePlan.label,
            amount: d.amountCurrent === null ? null : toNumber(d.amountCurrent),
            deadlineId: d.id,
          });
        }
      }

      events.sort((a, b) => a.date.getTime() - b.date.getTime());
      return { from: rangeStart, to: rangeEnd, events };
    });
  }
}
