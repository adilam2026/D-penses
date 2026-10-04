import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OperationKind, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { insertFinancialOperation } from '../common/ledger/ledger.util';

export interface CancelFinancialOperationInput {
  reason?: string;
}

export interface CorrectFinancialOperationInput {
  label: string;
  date: string;
  amount: string;
  categoryId?: string;
  reason?: string;
}

export interface CreateFinancialOperationInput {
  kind: OperationKind;
  label: string;
  date: string;
  amount: string;
  categoryId?: string;
  sourceAccountId?: string;
  sourceSubaccountId?: string;
  destinationAccountId?: string;
  destinationSubaccountId?: string;
  reversalOfOperationId?: string;
  reversalReason?: string;
  /** Ajouter > "Remboursable par mutuelle ?" (§11/§10 maquette) — crée le medical_claim dans la même transaction. */
  createMedicalClaim?: boolean;
}

@Injectable()
export class FinancialOperationsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateFinancialOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const operation = await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: dto.kind,
        label: dto.label,
        date: new Date(dto.date),
        amount: new Prisma.Decimal(dto.amount),
        categoryId: dto.categoryId,
        sourceAccountId: dto.sourceAccountId,
        sourceSubaccountId: dto.sourceSubaccountId,
        destinationAccountId: dto.destinationAccountId,
        destinationSubaccountId: dto.destinationSubaccountId,
        reversalOfOperationId: dto.reversalOfOperationId,
        reversalReason: dto.reversalReason,
      });

      if (dto.createMedicalClaim && dto.kind === 'EXPENSE') {
        await tx.medicalClaim.create({
          data: {
            householdId,
            sourceOperationId: operation.id,
            subaccountId: dto.sourceSubaccountId ?? null,
            label: dto.label,
            amountEngaged: operation.amount,
          },
        });
      }

      return operation;
    });
  }

  /**
   * "Annuler" une opération réalisée (§4) — reversal exact construit à partir
   * des valeurs ENREGISTRÉES de l'opération d'origine (jamais celles envoyées
   * par le client), donc toujours cohérent avec l'historique. insertFinancialOperation
   * refuse déjà d'annuler une opération qui est elle-même un reversal, mais ce
   * garde-fou seul ne bloque PAS un second appel /cancel sur la MÊME opération
   * d'origine (il ne regarde que l'opération ciblée, jamais si elle a déjà été
   * renversée par ailleurs) — d'où la vérification explicite ci-dessous :
   * double-annulation impossible dans tous les cas.
   */
  async cancel(userId: string, householdId: string, operationId: string, dto: CancelFinancialOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.financialOperation.findUnique({ where: { id: operationId } });
      if (!original || original.householdId !== householdId) throw new NotFoundException('Opération introuvable');

      const alreadyReversed = await tx.financialOperation.findFirst({ where: { reversalOfOperationId: original.id } });
      if (alreadyReversed) throw new BadRequestException('Cette opération a déjà été annulée');

      return insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: original.label,
        date: new Date(),
        amount: original.amount,
        categoryId: original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        reversalOfOperationId: original.id,
        reversalReason: dto.reason ?? undefined,
      });
    });
  }

  /**
   * "Modifier" une opération réalisée (§4) — jamais de mutation de la ligne
   * d'origine : reversal de l'originale + nouvelle opération corrigée avec les
   * valeurs ajustées, dans la MÊME transaction (atomique — pas 2 appels
   * client séparés). La nouvelle opération pointe vers l'ORIGINALE via
   * correction_of_operation_id pour une chaîne d'audit explicite. kind et
   * comptes source/destination sont repris de l'originale (immuables ici).
   * Vérifie "déjà renversée" (pas seulement "déjà corrigée") : une opération
   * annulée via /cancel ne doit jamais pouvoir être corrigée ensuite, sous
   * peine de la renverser une seconde fois (même risque que le double-cancel).
   */
  async correct(userId: string, householdId: string, operationId: string, dto: CorrectFinancialOperationInput) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const original = await tx.financialOperation.findUnique({ where: { id: operationId } });
      if (!original || original.householdId !== householdId) throw new NotFoundException('Opération introuvable');

      const alreadyReversed = await tx.financialOperation.findFirst({ where: { reversalOfOperationId: original.id } });
      if (alreadyReversed) throw new BadRequestException('Cette opération a déjà été annulée ou corrigée');

      await insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: original.label,
        date: new Date(),
        amount: original.amount,
        categoryId: original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        reversalOfOperationId: original.id,
        reversalReason: dto.reason ?? `Correction : ${dto.label}`,
      });

      return insertFinancialOperation(tx, {
        householdId,
        createdByUserId: userId,
        kind: original.kind,
        label: dto.label,
        date: new Date(dto.date),
        amount: new Prisma.Decimal(dto.amount),
        categoryId: dto.categoryId ?? original.categoryId,
        sourceAccountId: original.sourceAccountId,
        sourceSubaccountId: original.sourceSubaccountId,
        destinationAccountId: original.destinationAccountId,
        destinationSubaccountId: original.destinationSubaccountId,
        correctionOfOperationId: original.id,
      });
    });
  }

  /**
   * Historique standard (§annulation, correction affichage) — une opération
   * annulée ne doit JAMAIS y figurer, ni sous sa forme d'origine ni sous sa
   * contre-écriture technique : les deux restent en base pour l'audit (jamais
   * supprimées), mais sont exclues ici via la relation métier réelle
   * (reversalOfOperationId), jamais un filtre fragile sur le libellé. Une
   * opération CORRIGÉE (correctionOfOperationId) n'est pas concernée par ce
   * filtre : sa nouvelle version n'est ni un reversal ni reversée, elle reste
   * visible normalement sous sa forme corrigée.
   */
  async list(userId: string, householdId: string, filters?: { accountId?: string; subaccountId?: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const where: Prisma.FinancialOperationWhereInput = { householdId };
      if (filters?.subaccountId) {
        where.OR = [{ sourceSubaccountId: filters.subaccountId }, { destinationSubaccountId: filters.subaccountId }];
      } else if (filters?.accountId) {
        where.OR = [{ sourceAccountId: filters.accountId }, { destinationAccountId: filters.accountId }];
      }
      const operations = await tx.financialOperation.findMany({
        where,
        orderBy: { date: 'desc' },
        include: { ledgerEntries: true },
      });
      const reversedOriginalIds = new Set(operations.map((op) => op.reversalOfOperationId).filter((x): x is string => !!x));
      return operations.filter((op) => !op.reversalOfOperationId && !reversedOriginalIds.has(op.id));
    });
  }

  async getOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const operation = await tx.financialOperation.findUnique({
        where: { id },
        include: {
          ledgerEntries: true,
          reversals: true,
          reversalOfOperation: true,
          correctedByOperations: true,
          correctionOfOperation: true,
        },
      });
      if (!operation || operation.householdId !== householdId) throw new NotFoundException('Opération introuvable');
      return operation;
    });
  }
}
