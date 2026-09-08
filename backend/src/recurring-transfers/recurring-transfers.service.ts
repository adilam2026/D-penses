import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { CreateRecurringTransferDto } from './dto/create-recurring-transfer.dto';
import { UpdateRecurringTransferDto } from './dto/update-recurring-transfer.dto';
import { ensureRecurringTransfersUntil } from '../common/ledger/occurrence-generation.util';
import { DASHBOARD_FALLBACK_HORIZON_DAYS } from '../common/ledger/treasury.util';

/**
 * RecurringTransfer (R6.2 §10-12) — un transfert récurrent reste un
 * TRANSFERT, jamais une ChargePlan (RG implicite : sinon les statistiques de
 * dépenses seraient faussées, un virement épargne n'est pas une consommation).
 * Les occurrences (AccountTransfer) sont générées paresseusement par
 * ensureRecurringTransfersUntil, jamais ici — ce service ne gère que l'objet
 * RecurringTransfer lui-même (la définition de la règle, pas ses occurrences).
 */
@Injectable()
export class RecurringTransfersService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(userId: string, householdId: string, dto: CreateRecurringTransferDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      await this.assertAccountUsable(tx, householdId, dto.fromAccountId, 'source');
      await this.assertAccountUsable(tx, householdId, dto.toAccountId, 'destination');
      if (dto.fromAccountId === dto.toAccountId) {
        throw new BadRequestException('Le compte source et le compte destination doivent être différents');
      }

      return tx.recurringTransfer.create({
        data: {
          householdId,
          label: dto.label,
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          amount: dto.amount,
          recurrenceRule: dto.recurrenceRule,
          recurrenceAnchorDate: new Date(dto.recurrenceAnchorDate),
          note: dto.note,
        },
      });
    });
  }

  /**
   * R6.2 corrections finales §4 — génération paresseuse AVANT lecture (même
   * horizon que Dashboard/Calendar/Projection, DASHBOARD_FALLBACK_HORIZON_DAYS,
   * jamais une nouvelle constante) : sans cet appel, un transfert récurrent
   * tout juste créé n'aurait aucune occurrence 'prevu' tant qu'aucun autre
   * écran (Dashboard/Calendar/Projection) n'a été consulté — l'écran de
   * gestion doit toujours pouvoir afficher un "Prochain transfert" à jour.
   */
  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const generationHorizon = new Date(Date.now() + DASHBOARD_FALLBACK_HORIZON_DAYS * 86400000);
      await ensureRecurringTransfersUntil(tx, householdId, generationHorizon);
      return tx.recurringTransfer.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } });
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const generationHorizon = new Date(Date.now() + DASHBOARD_FALLBACK_HORIZON_DAYS * 86400000);
      await ensureRecurringTransfersUntil(tx, householdId, generationHorizon);
      return this.assertOwned(tx, id, householdId);
    });
  }

  /**
   * §10-12 : même règle que ChargePlansService.update (§3) — une modification
   * de fréquence/prochain transfert/montant ne touche JAMAIS une occurrence
   * déjà confirmée (historique réel) ; seules les occurrences encore 'prevu'
   * (jamais consultées/confirmées par l'utilisateur) sont retirées, la
   * génération future (ensureRecurringTransfersUntil, appelée paresseusement)
   * les recrée alignées sur la nouvelle règle.
   */
  async update(userId: string, householdId: string, id: string, dto: UpdateRecurringTransferDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const existing = await this.assertOwned(tx, id, householdId);

      if (dto.fromAccountId) await this.assertAccountUsable(tx, householdId, dto.fromAccountId, 'source');
      if (dto.toAccountId) await this.assertAccountUsable(tx, householdId, dto.toAccountId, 'destination');
      const nextFrom = dto.fromAccountId ?? existing.fromAccountId;
      const nextTo = dto.toAccountId ?? existing.toAccountId;
      if (nextFrom && nextTo && nextFrom === nextTo) {
        throw new BadRequestException('Le compte source et le compte destination doivent être différents');
      }

      const existingAnchorIso = existing.recurrenceAnchorDate.toISOString().slice(0, 10);
      const recurrenceChanged =
        (dto.recurrenceRule !== undefined && dto.recurrenceRule !== existing.recurrenceRule) ||
        (dto.recurrenceAnchorDate !== undefined && dto.recurrenceAnchorDate !== existingAnchorIso);

      const updated = await tx.recurringTransfer.update({
        where: { id },
        data: {
          label: dto.label,
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          amount: dto.amount,
          recurrenceRule: dto.recurrenceRule,
          recurrenceAnchorDate: dto.recurrenceAnchorDate ? new Date(dto.recurrenceAnchorDate) : undefined,
          note: dto.note,
          status: dto.status,
        },
      });

      if (recurrenceChanged) {
        await tx.accountTransfer.deleteMany({ where: { recurringTransferId: id, status: 'prevu' } });
      }

      return updated;
    });
  }

  private async assertOwned(tx: ReturnType<RlsContextService['getClient']>, id: string, householdId: string) {
    const recurringTransfer = await tx.recurringTransfer.findFirst({ where: { id, householdId } });
    if (!recurringTransfer) throw new NotFoundException('Transfert récurrent introuvable');
    return recurringTransfer;
  }

  private async assertAccountUsable(tx: ReturnType<RlsContextService['getClient']>, householdId: string, accountId: string, role: string) {
    const account = await tx.financialAccount.findFirst({ where: { id: accountId, householdId } });
    if (!account) throw new NotFoundException(`Compte ${role} introuvable dans ce foyer`);
    if (account.status !== 'actif') {
      throw new BadRequestException(`Le compte « ${account.name} » (${role}) est archivé — réactivez-le pour l'utiliser`);
    }
  }
}
