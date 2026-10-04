import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PlannedOperationKind, RecurrenceFrequency } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { ensurePlannedOccurrences } from '../common/ledger/recurrence.util';
import { resolveFallbackCategoryId } from '../categories/categories.service';
import { RecurrenceRuleApplyFrom } from './dto/update-recurrence-rule.dto';

export interface CreateRecurrenceRuleInput {
  frequency: RecurrenceFrequency;
  anchorDate: string;
  label?: string;
  kind: PlannedOperationKind;
  expectedAmount: string;
  categoryId?: string;
  financialPlanItemId?: string;
  financialPlanDeadlineId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

export interface UpdateRecurrenceRuleInput {
  applyFrom: RecurrenceRuleApplyFrom;
  fromDate: string;
  expectedAmount?: string;
  label?: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  active?: boolean;
  frequency?: RecurrenceFrequency;
  anchorDate?: string;
}

@Injectable()
export class RecurrenceRulesService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateRecurrenceRuleInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const categoryId = dto.categoryId ?? (dto.kind === 'EXPENSE' ? ((await resolveFallbackCategoryId(tx, householdId)) ?? undefined) : undefined);
      const rule = await tx.recurrenceRule.create({
        data: {
          householdId,
          frequency: dto.frequency,
          anchorDate: new Date(dto.anchorDate),
          label: dto.label,
          kind: dto.kind,
          expectedAmount: new Prisma.Decimal(dto.expectedAmount),
          categoryId,
          financialPlanItemId: dto.financialPlanItemId,
          financialPlanDeadlineId: dto.financialPlanDeadlineId,
          sourceAccountId: dto.sourceAccountId,
          sourceSubaccountId: dto.sourceSubaccountId,
          destinationAccountId: dto.destinationAccountId,
          destinationSubaccountId: dto.destinationSubaccountId,
        },
      });

      // Peuple immédiatement la fenêtre glissante de 12 mois (§18/§21) — l'utilisateur
      // doit voir les occurrences futures dans le Planning dès la création de la règle.
      await ensurePlannedOccurrences(tx, householdId);

      return rule;
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return tx.recurrenceRule.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
    });
  }

  /**
   * Modifier une règle récurrente (§19, lot "modifier une échéance récurrente").
   * Ne modifie JAMAIS silencieusement le passé : THIS_OCCURRENCE laisse le
   * gabarit de la règle intact (l'appelant doit alors passer par
   * PlannedOperationsService#update sur l'occurrence pivot elle-même) ;
   * THIS_AND_FOLLOWING met à jour le gabarit ET toutes les occurrences encore
   * PENDING à partir de fromDate (jamais REALIZED/CANCELLED, jamais avant
   * fromDate).
   *
   * Cas "périodicité/jour change" (frequency et/ou anchorDate fournis) : un
   * simple batch update en place ne suffit pas, les occurrences déjà
   * générées sous l'ANCIENNE cadence à partir de fromDate ne correspondent
   * plus aux bonnes dates sous la NOUVELLE — elles sont donc supprimées
   * (PENDING uniquement, jamais réalisées, donc jamais un historique perdu)
   * puis régénérées : le pivot est recréé immédiatement à sa nouvelle date
   * (anchorDate, par défaut fromDate si seule la fréquence change) pour ne
   * jamais dépendre de la génération paresseuse (qui ignorerait une date déjà
   * passée), et ensurePlannedOccurrences complète le reste de l'horizon.
   *
   * Cas "arrêter la série à partir de cette occurrence" (§8, active=false) :
   * annule (CANCELLED, jamais supprimé) le pivot et toutes les occurrences
   * encore PENDING à partir de fromDate, en plus de désactiver la règle —
   * sinon elles resteraient payables indéfiniment malgré la règle inactive.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateRecurrenceRuleInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const rule = await tx.recurrenceRule.findUnique({ where: { id } });
      if (!rule || rule.householdId !== householdId) throw new NotFoundException('Règle de récurrence introuvable');

      const fromDate = new Date(dto.fromDate);
      const cadenceChanges = dto.frequency !== undefined || dto.anchorDate !== undefined;
      const newAnchorDate = dto.anchorDate !== undefined ? new Date(dto.anchorDate) : fromDate;

      const templatePatch: Prisma.RecurrenceRuleUpdateInput = {};
      if (dto.expectedAmount !== undefined) templatePatch.expectedAmount = new Prisma.Decimal(dto.expectedAmount);
      if (dto.label !== undefined) templatePatch.label = dto.label;
      if (dto.categoryId !== undefined) templatePatch.category = { connect: { id: dto.categoryId } };
      if (dto.sourceAccountId !== undefined) templatePatch.sourceAccount = { connect: { id: dto.sourceAccountId } };
      if (dto.sourceSubaccountId !== undefined) templatePatch.sourceSubaccount = { connect: { id: dto.sourceSubaccountId } };
      if (dto.destinationAccountId !== undefined) templatePatch.destinationAccount = { connect: { id: dto.destinationAccountId } };
      if (dto.destinationSubaccountId !== undefined) templatePatch.destinationSubaccount = { connect: { id: dto.destinationSubaccountId } };
      if (dto.active !== undefined) templatePatch.active = dto.active;
      if (cadenceChanges) {
        if (dto.frequency !== undefined) templatePatch.frequency = dto.frequency;
        templatePatch.anchorDate = newAnchorDate;
      }

      if (dto.applyFrom === 'THIS_OCCURRENCE') {
        // Le gabarit de la règle n'est pas touché ; seul `active` peut être
        // basculé ici (arrêter les générations futures sans réécrire le passé).
        if (dto.active !== undefined) {
          await tx.recurrenceRule.update({ where: { id }, data: { active: dto.active } });
        }
        return tx.recurrenceRule.findUniqueOrThrow({ where: { id } });
      }

      const updated = await tx.recurrenceRule.update({ where: { id }, data: templatePatch });

      if (cadenceChanges) {
        // Supprime les occurrences PENDING déjà générées sous l'ANCIENNE
        // cadence à partir du pivot (jamais REALIZED/CANCELLED — protégées).
        await tx.plannedOperation.deleteMany({
          where: { recurrenceRuleId: id, status: 'PENDING', expectedDate: { gte: fromDate } },
        });
        // Recrée immédiatement le pivot à sa nouvelle date — ne dépend jamais
        // de la génération paresseuse (qui ignore toute date déjà passée par
        // rapport à "aujourd'hui", ex. modification d'une échéance en retard).
        await tx.plannedOperation.create({
          data: {
            householdId,
            kind: updated.kind,
            recurrenceRuleId: id,
            categoryId: updated.categoryId,
            financialPlanItemId: updated.financialPlanItemId,
            financialPlanDeadlineId: updated.financialPlanDeadlineId,
            sourceAccountId: updated.sourceAccountId,
            sourceSubaccountId: updated.sourceSubaccountId,
            destinationAccountId: updated.destinationAccountId,
            destinationSubaccountId: updated.destinationSubaccountId,
            expectedAmount: updated.expectedAmount,
            expectedDate: newAnchorDate,
            label: updated.label ?? 'Récurrence',
            status: 'PENDING',
          },
        });
        // Complète le reste de l'horizon sous la nouvelle cadence (idempotent).
        await ensurePlannedOccurrences(tx, householdId);
      } else {
        // Pas de changement de cadence : batch update en place des occurrences
        // déjà générées, mêmes dates, nouveaux champs (comportement existant).
        const occurrencePatch: Prisma.PlannedOperationUncheckedUpdateManyInput = {};
        if (dto.expectedAmount !== undefined) occurrencePatch.expectedAmount = new Prisma.Decimal(dto.expectedAmount);
        if (dto.label !== undefined) occurrencePatch.label = dto.label;
        if (dto.categoryId !== undefined) occurrencePatch.categoryId = dto.categoryId;
        if (dto.sourceAccountId !== undefined) occurrencePatch.sourceAccountId = dto.sourceAccountId;
        if (dto.sourceSubaccountId !== undefined) occurrencePatch.sourceSubaccountId = dto.sourceSubaccountId;
        if (dto.destinationAccountId !== undefined) occurrencePatch.destinationAccountId = dto.destinationAccountId;
        if (dto.destinationSubaccountId !== undefined) occurrencePatch.destinationSubaccountId = dto.destinationSubaccountId;

        if (Object.keys(occurrencePatch).length > 0) {
          await tx.plannedOperation.updateMany({
            where: { recurrenceRuleId: id, status: 'PENDING', expectedDate: { gte: fromDate } },
            data: occurrencePatch,
          });
        }
      }

      if (dto.active === false) {
        // Arrêter la série à partir de cette occurrence (§8) : le pivot et
        // toutes les occurrences encore PENDING à partir de fromDate ne
        // doivent plus apparaître comme à venir/payables.
        await tx.plannedOperation.updateMany({
          where: { recurrenceRuleId: id, status: 'PENDING', expectedDate: { gte: fromDate } },
          data: { status: 'CANCELLED' },
        });
      }

      return updated;
    });
  }
}
