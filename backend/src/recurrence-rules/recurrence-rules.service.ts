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
   * Modifier une règle récurrente (§19). Ne modifie JAMAIS silencieusement le
   * passé : THIS_OCCURRENCE laisse le gabarit de la règle intact (l'appelant
   * doit alors passer par PlannedOperationsService#update sur l'occurrence
   * pivot elle-même) ; THIS_AND_FOLLOWING met à jour le gabarit ET toutes les
   * occurrences encore PENDING à partir de fromDate (jamais REALIZED/CANCELLED,
   * jamais avant fromDate).
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateRecurrenceRuleInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const rule = await tx.recurrenceRule.findUnique({ where: { id } });
      if (!rule || rule.householdId !== householdId) throw new NotFoundException('Règle de récurrence introuvable');

      const templatePatch: Prisma.RecurrenceRuleUpdateInput = {};
      if (dto.expectedAmount !== undefined) templatePatch.expectedAmount = new Prisma.Decimal(dto.expectedAmount);
      if (dto.label !== undefined) templatePatch.label = dto.label;
      if (dto.categoryId !== undefined) templatePatch.category = { connect: { id: dto.categoryId } };
      if (dto.sourceAccountId !== undefined) templatePatch.sourceAccount = { connect: { id: dto.sourceAccountId } };
      if (dto.sourceSubaccountId !== undefined) templatePatch.sourceSubaccount = { connect: { id: dto.sourceSubaccountId } };
      if (dto.destinationAccountId !== undefined) templatePatch.destinationAccount = { connect: { id: dto.destinationAccountId } };
      if (dto.destinationSubaccountId !== undefined) templatePatch.destinationSubaccount = { connect: { id: dto.destinationSubaccountId } };
      if (dto.active !== undefined) templatePatch.active = dto.active;

      if (dto.applyFrom === 'THIS_OCCURRENCE') {
        // Le gabarit de la règle n'est pas touché ; seul `active` peut être
        // basculé ici (arrêter les générations futures sans réécrire le passé).
        if (dto.active !== undefined) {
          await tx.recurrenceRule.update({ where: { id }, data: { active: dto.active } });
        }
        return tx.recurrenceRule.findUniqueOrThrow({ where: { id } });
      }

      const updated = await tx.recurrenceRule.update({ where: { id }, data: templatePatch });

      // THIS_AND_FOLLOWING : répercute sur les occurrences futures encore PENDING
      // uniquement (jamais REALIZED/CANCELLED, jamais avant fromDate — §19).
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
          where: {
            recurrenceRuleId: id,
            status: 'PENDING',
            expectedDate: { gte: new Date(dto.fromDate) },
          },
          data: occurrencePatch,
        });
      }

      if (dto.active === false) {
        // Une règle désactivée n'a plus vocation à générer — les occurrences
        // futures déjà générées mais non réalisées restent visibles/payables,
        // seule la génération de nouvelles dates s'arrête (cf. ensurePlannedOccurrences).
      }

      return updated;
    });
  }
}
