import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance } from '../common/ledger/ledger.util';
import { CreateIncomeSourceDto } from './dto/create-income-source.dto';
import { UpdateIncomeSourceDto } from './dto/update-income-source.dto';
import { CreateIncomeOccurrenceDto } from './dto/create-income-occurrence.dto';
import { ConfirmIncomeOccurrenceDto } from './dto/confirm-income-occurrence.dto';

/**
 * Revenus (docs/02-modele-metier.md §C.3/E.2). Une IncomeOccurrence "prévue" ne
 * modifie jamais un solde réel (F.1) — seule la confirmation (statut "reçu")
 * fait apparaître le montant dans LedgerEntry et donc dans solde_courant (G.1).
 */
@Injectable()
export class IncomeService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async createSource(userId: string, householdId: string, dto: CreateIncomeSourceDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id: dto.defaultAccountId, householdId } });
      if (!account) throw new NotFoundException('Compte cible introuvable dans ce foyer');

      return tx.incomeSource.create({
        data: {
          householdId,
          label: dto.label,
          beneficiaryUserId: dto.beneficiaryUserId,
          categoryId: dto.categoryId,
          recurrenceRule: dto.recurrenceRule,
          recurrenceAnchorDate: dto.recurrenceAnchorDate ? new Date(dto.recurrenceAnchorDate) : undefined,
          usualAmount: dto.usualAmount,
          isRecurring: dto.isRecurring ?? true,
          defaultAccountId: dto.defaultAccountId,
        },
      });
    });
  }

  /** Recette post-Vague 3 (§6) — nextOccurrence (la plus proche encore 'prevu') incluse en une requête, jamais un appel N+1. */
  async listSources(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().incomeSource.findMany({
        where: { householdId },
        orderBy: { createdAt: 'desc' },
        include: {
          occurrences: { where: { status: 'prevu' }, orderBy: { usualDate: 'asc' }, take: 1 },
        },
      }),
    );
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      return this.assertOwned(tx, id, householdId);
    });
  }

  /** Recette post-Vague 3 (§5) — modification déclarative + arrêt de récurrence (status). */
  async updateSource(userId: string, householdId: string, id: string, dto: UpdateIncomeSourceDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, id, householdId);

      if (dto.categoryId) {
        const category = await tx.category.findFirst({ where: { id: dto.categoryId, householdId } });
        if (!category) throw new NotFoundException('Catégorie introuvable dans ce foyer');
      }
      if (dto.defaultAccountId) {
        const account = await tx.financialAccount.findFirst({ where: { id: dto.defaultAccountId, householdId } });
        if (!account) throw new NotFoundException('Compte cible introuvable dans ce foyer');
      }

      return tx.incomeSource.update({
        where: { id },
        data: {
          label: dto.label,
          beneficiaryUserId: dto.beneficiaryUserId === undefined ? undefined : dto.beneficiaryUserId,
          categoryId: dto.categoryId === undefined ? undefined : dto.categoryId,
          recurrenceRule: dto.recurrenceRule,
          recurrenceAnchorDate: dto.recurrenceAnchorDate === undefined ? undefined : dto.recurrenceAnchorDate ? new Date(dto.recurrenceAnchorDate) : null,
          usualAmount: dto.usualAmount,
          isRecurring: dto.isRecurring,
          defaultAccountId: dto.defaultAccountId,
          status: dto.status,
        },
      });
    });
  }

  /**
   * Recette post-Vague 3 (§5) — suppression réelle interdite dès qu'une
   * IncomeOccurrence a déjà été reçue (status='recu', historique réel) :
   * proposer status=inactif (désactivation) à la place. Sans occurrence
   * reçue, la suppression est autorisée (cascade sur les occurrences
   * encore 'prevu', rien de réel à perdre).
   */
  async removeSource(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertOwned(tx, id, householdId);

      const receivedOccurrence = await tx.incomeOccurrence.findFirst({ where: { incomeSourceId: id, status: 'recu' } });
      if (receivedOccurrence) {
        throw new ConflictException(
          'Impossible de supprimer : des occurrences déjà reçues existent. Désactivez la source (arrêter la récurrence) à la place.',
        );
      }

      await tx.incomeSource.delete({ where: { id } });
      return { deleted: true };
    });
  }

  private async assertOwned(tx: ReturnType<RlsContextService['getClient']>, id: string, householdId: string) {
    const source = await tx.incomeSource.findFirst({ where: { id, householdId } });
    if (!source) throw new NotFoundException('Source de revenu introuvable');
    return source;
  }

  async createOccurrence(userId: string, householdId: string, sourceId: string, dto: CreateIncomeOccurrenceDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const source = await tx.incomeSource.findFirst({ where: { id: sourceId, householdId } });
      if (!source) throw new NotFoundException('Source de revenu introuvable');

      return tx.incomeOccurrence.create({
        data: {
          incomeSourceId: sourceId,
          usualDate: new Date(dto.usualDate),
          plannedAmount: dto.plannedAmount ?? source.usualAmount,
          // Pré-rempli par défaut (RG-014bis) — reste modifiable jusqu'à la confirmation.
          accountId: source.defaultAccountId,
        },
      });
    });
  }

  async listOccurrences(userId: string, householdId: string, sourceId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const source = await tx.incomeSource.findFirst({ where: { id: sourceId, householdId } });
      if (!source) throw new NotFoundException('Source de revenu introuvable');
      return tx.incomeOccurrence.findMany({ where: { incomeSourceId: sourceId }, orderBy: { usualDate: 'desc' } });
    });
  }

  /**
   * « Salaire reçu » — seul point d'entrée qui fait passer prévu → reçu.
   * Le compte cible est obligatoire (RG-014bis) : celui déjà pré-rempli, ou
   * fourni explicitement si l'utilisateur l'a changé.
   */
  async confirmOccurrence(userId: string, householdId: string, occurrenceId: string, dto: ConfirmIncomeOccurrenceDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const occurrence = await tx.incomeOccurrence.findFirst({ where: { id: occurrenceId } });
      if (!occurrence) throw new NotFoundException('Occurrence de revenu introuvable');
      if (occurrence.status === 'recu') {
        throw new BadRequestException('Cette occurrence est déjà confirmée reçue');
      }

      const accountId = dto.accountId ?? occurrence.accountId;
      if (!accountId) throw new BadRequestException('Un compte cible est obligatoire pour confirmer un revenu (RG-014bis)');
      const account = await tx.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!account) throw new NotFoundException('Compte cible introuvable dans ce foyer');

      const updated = await tx.incomeOccurrence.update({
        where: { id: occurrenceId },
        data: {
          status: 'recu',
          actualAmount: dto.actualAmount,
          actualDate: dto.actualDate ? new Date(dto.actualDate) : new Date(),
          accountId,
          confirmedByUserId: userId,
          confirmedAt: new Date(),
        },
      });

      return { ...updated, soldeCourant: await getAccountBalance(tx, accountId) };
    });
  }
}
