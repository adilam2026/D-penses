import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';
import { ensurePlannedOccurrences } from '../common/ledger/recurrence.util';
import { resolveFallbackCategoryId } from '../categories/categories.service';

export interface UpdatePlannedOperationInput {
  expectedAmount?: string;
  expectedDate?: string;
  label?: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

export interface RealizePlannedOperationInput {
  actualAmount: string;
  actualDate?: string;
  label?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

/**
 * Source RÉELLE de ce paiement (lot "choisir la source au moment du
 * paiement") — si l'appelant fournit sourceAccountId, la paire
 * (account+subaccount) qu'il a choisie remplace ENTIÈREMENT celle de
 * l'échéance (jamais une fusion champ par champ : omettre subaccountId
 * signifie explicitement "compte principal direct", pas "garder l'ancien
 * sous-compte"). Sans override, la source PRÉVUE de l'échéance est utilisée
 * telle quelle — comportement historique inchangé. Ne modifie jamais la
 * planned_operation elle-même : purement les params de CETTE opération réelle.
 */
function resolvePaymentShape(
  planned: { sourceAccountId: string | null; sourceSubaccountId: string | null; destinationAccountId: string | null; destinationSubaccountId: string | null },
  dto: { sourceAccountId?: string; sourceSubaccountId?: string; destinationAccountId?: string; destinationSubaccountId?: string },
) {
  return {
    sourceAccountId: dto.sourceAccountId ?? planned.sourceAccountId ?? undefined,
    sourceSubaccountId: dto.sourceAccountId ? dto.sourceSubaccountId : (planned.sourceSubaccountId ?? undefined),
    destinationAccountId: dto.destinationAccountId ?? planned.destinationAccountId ?? undefined,
    destinationSubaccountId: dto.destinationAccountId ? dto.destinationSubaccountId : (planned.destinationSubaccountId ?? undefined),
  };
}

export interface CreatePlannedOperationInput {
  kind: 'EXPENSE' | 'INCOME' | 'SAVINGS_CONTRIBUTION';
  label: string;
  expectedDate: string;
  expectedAmount: string;
  categoryId?: string;
  recurrenceRuleId?: string;
  financialPlanItemId?: string;
  financialPlanDeadlineId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
}

@Injectable()
export class PlannedOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      try {
        const categoryId = dto.categoryId ?? (dto.kind === 'EXPENSE' ? await resolveFallbackCategoryId(tx, householdId) : undefined);
        return await tx.plannedOperation.create({
          data: {
            householdId,
            kind: dto.kind,
            label: dto.label,
            expectedDate: new Date(dto.expectedDate),
            expectedAmount: new Prisma.Decimal(dto.expectedAmount),
            categoryId: categoryId ?? undefined,
            recurrenceRuleId: dto.recurrenceRuleId,
            financialPlanItemId: dto.financialPlanItemId,
            financialPlanDeadlineId: dto.financialPlanDeadlineId,
            sourceAccountId: dto.sourceAccountId,
            sourceSubaccountId: dto.sourceSubaccountId,
            destinationAccountId: dto.destinationAccountId,
            destinationSubaccountId: dto.destinationSubaccountId,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('Une échéance existe déjà pour cette règle de récurrence à cette date');
        }
        throw err;
      }
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      // Fenêtre glissante toujours à jour (même logique que Planning) — sinon
      // "À faire" (Accueil) peut rester figé si l'utilisateur n'ouvre jamais Planning.
      await ensurePlannedOccurrences(tx, householdId);
      return tx.plannedOperation.findMany({ where: { householdId }, orderBy: { expectedDate: 'asc' } });
    });
  }

  /** Réalise une échéance prévue : crée la financial_operation réelle (montant possiblement différent) et clôt le prévu. */
  async realize(userId: string, householdId: string, id: string, dto: RealizePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const operation = await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: planned.kind as unknown as OperationKind,
        label: dto.label ?? planned.label,
        date: dto.actualDate ? new Date(dto.actualDate) : planned.expectedDate,
        amount: new Prisma.Decimal(dto.actualAmount),
        categoryId: planned.categoryId,
        plannedOperationId: id,
        ...resolvePaymentShape(planned, dto),
      });

      await tx.plannedOperation.update({
        where: { id },
        data: { status: 'REALIZED', realizedOperationId: operation.id },
      });

      return operation;
    });
  }

  /**
   * Montant déjà payé (somme nette de TOUTES les opérations réelles déjà
   * liées à cette échéance — paiements partiels + éventuel paiement final,
   * un renversement nette correctement via effectiveAmount) — jamais déduit
   * de expected_amount, qui reste la valeur PRÉVUE d'origine, constante.
   */
  private async computeAlreadyPaid(tx: Prisma.TransactionClient, plannedId: string): Promise<Prisma.Decimal> {
    const realizations = await tx.financialOperation.findMany({ where: { plannedOperationId: plannedId } });
    return realizations.reduce((sum, op) => sum.add(op.reversalOfOperationId ? op.amount.neg() : op.amount), new Prisma.Decimal(0));
  }

  /**
   * Paiement partiel (Planning, appui long, §correction "paiements partiels
   * successifs") — enregistre le montant réellement payé maintenant comme
   * une vraie opération réelle LIÉE à l'échéance (planned_operation_id),
   * SANS jamais clore l'échéance ni muter son expected_amount (qui reste le
   * "prévu" d'origine, constant). Le "déjà payé"/"reste" sont dérivés en
   * sommant toutes les opérations liées (cf. computeAlreadyPaid) — jamais
   * stockés. Le reste continue d'apparaître comme à venir (même échéance,
   * toujours PENDING), et peut recevoir d'AUTRES paiements partiels, chacun
   * avec sa propre source — jamais de blocage après un premier paiement
   * partiel. Si le reste est payé plus tard via `realize`, l'échéance
   * devient entièrement réalisée.
   */
  async partialRealize(userId: string, householdId: string, id: string, dto: RealizePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const partialAmount = new Prisma.Decimal(dto.actualAmount);
      if (partialAmount.lte(0)) throw new BadRequestException('Le montant payé doit être positif');

      const alreadyPaid = await this.computeAlreadyPaid(tx, id);
      const remaining = planned.expectedAmount.sub(alreadyPaid);
      if (partialAmount.gte(remaining)) {
        throw new BadRequestException('Pour régler le reste en totalité, utilisez le paiement total plutôt que le paiement partiel');
      }

      return insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: planned.kind as unknown as OperationKind,
        label: dto.label ?? planned.label,
        date: dto.actualDate ? new Date(dto.actualDate) : new Date(),
        amount: partialAmount,
        categoryId: planned.categoryId,
        plannedOperationId: id,
        ...resolvePaymentShape(planned, dto),
      });
    });
  }

  async cancel(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');
      return tx.plannedOperation.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
  }

  /**
   * Modifier UNE occurrence ("cette échéance uniquement", appui long sur une
   * case encore prévue, ou échéance ponctuelle) — ex. Internet d'octobre 350
   * -> 420. Ne touche jamais la règle de récurrence source ni les autres
   * occurrences ; refuse si l'occurrence n'est plus PENDING.
   *
   * Cas particulier : déplacer la DATE d'une occurrence qui appartient
   * toujours à une récurrence (recurrenceRuleId non null) ne peut PAS être un
   * simple UPDATE de la ligne — la contrainte d'unicité (recurrenceRuleId,
   * expectedDate) qui garantit l'idempotence de la génération libérerait
   * alors l'ANCIENNE date, et la prochaine génération y recréerait un
   * "fantôme" identique au gabarit (cf. ensurePlannedOccurrences). On détache
   * donc cette occurrence de la série : la ligne d'origine est annulée
   * (status=CANCELLED — elle continue d'occuper son ancienne date, ce qui
   * bloque définitivement toute régénération fantôme à cette date) et une
   * NOUVELLE occurrence autonome (recurrenceRuleId=null, comme une échéance
   * ponctuelle) est créée à la nouvelle date avec les valeurs mises à jour.
   * La règle de récurrence et toutes les autres occurrences restent intactes.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdatePlannedOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'PENDING') throw new BadRequestException('Cette échéance a déjà été réalisée ou annulée');

      const newExpectedDate = dto.expectedDate !== undefined ? new Date(dto.expectedDate) : undefined;
      const changesDate = !!newExpectedDate && newExpectedDate.getTime() !== planned.expectedDate.getTime();

      if (changesDate && planned.recurrenceRuleId) {
        await tx.plannedOperation.update({ where: { id }, data: { status: 'CANCELLED' } });
        return tx.plannedOperation.create({
          data: {
            householdId,
            kind: planned.kind,
            recurrenceRuleId: null,
            categoryId: dto.categoryId !== undefined ? dto.categoryId : planned.categoryId,
            financialPlanItemId: planned.financialPlanItemId,
            financialPlanDeadlineId: planned.financialPlanDeadlineId,
            sourceAccountId: dto.sourceAccountId !== undefined ? dto.sourceAccountId : planned.sourceAccountId,
            sourceSubaccountId: dto.sourceAccountId !== undefined ? (dto.sourceSubaccountId ?? null) : planned.sourceSubaccountId,
            destinationAccountId: dto.destinationAccountId !== undefined ? dto.destinationAccountId : planned.destinationAccountId,
            destinationSubaccountId: dto.destinationAccountId !== undefined ? (dto.destinationSubaccountId ?? null) : planned.destinationSubaccountId,
            expectedAmount: dto.expectedAmount !== undefined ? new Prisma.Decimal(dto.expectedAmount) : planned.expectedAmount,
            expectedDate: newExpectedDate!,
            label: dto.label ?? planned.label,
            status: 'PENDING',
          },
        });
      }

      return tx.plannedOperation.update({
        where: { id },
        data: {
          expectedAmount: dto.expectedAmount !== undefined ? new Prisma.Decimal(dto.expectedAmount) : undefined,
          expectedDate: newExpectedDate,
          label: dto.label,
          categoryId: dto.categoryId,
          // Paire source/destination traitée comme un tout (jamais fusionnée
          // champ par champ) : fournir *AccountId sans *SubaccountId signifie
          // explicitement "compte principal direct", jamais "garder l'ancien
          // sous-compte" d'un compte différent.
          sourceAccountId: dto.sourceAccountId,
          sourceSubaccountId: dto.sourceAccountId !== undefined ? (dto.sourceSubaccountId ?? null) : undefined,
          destinationAccountId: dto.destinationAccountId,
          destinationSubaccountId: dto.destinationAccountId !== undefined ? (dto.destinationSubaccountId ?? null) : undefined,
        },
      });
    });
  }

  /**
   * Annuler un paiement déjà réalisé (appui long sur une case verte, "Annuler
   * le paiement") — utilise exclusivement le mécanisme de renversement déjà
   * validé (reversalOfOperationId) : NE supprime JAMAIS la transaction
   * d'origine, crée une contre-écriture, et remet l'occurrence à PENDING avec
   * son montant prévu d'origine (le montant réel réalisé est perdu, comme
   * pour toute annulation — l'occurrence redevient une échéance à réaliser).
   */
  async unrealize(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const planned = await tx.plannedOperation.findUnique({ where: { id } });
      if (!planned || planned.householdId !== householdId) throw new NotFoundException('Échéance prévue introuvable');
      if (planned.status !== 'REALIZED' || !planned.realizedOperationId) {
        throw new BadRequestException("Cette échéance n'est pas réalisée, impossible de l'annuler");
      }

      const original = await tx.financialOperation.findUnique({ where: { id: planned.realizedOperationId } });
      if (!original || original.householdId !== householdId) throw new NotFoundException('Transaction réalisée introuvable');

      await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: `Annulation — ${original.label}`,
        date: new Date(),
        amount: original.amount,
        categoryId: original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        reversalOfOperationId: original.id,
        reversalReason: 'Annulation depuis le Planning',
        // Lot "paiements partiels successifs" : garde le renversement lié à
        // la même échéance que l'opération d'origine, pour qu'il nette
        // correctement dans la somme "déjà payé" (cf. computeAlreadyPaid) —
        // si des paiements partiels antérieurs existent, ils restent comptés.
        plannedOperationId: original.plannedOperationId,
      });

      return tx.plannedOperation.update({
        where: { id },
        data: { status: 'PENDING', realizedOperationId: null },
      });
    });
  }
}
