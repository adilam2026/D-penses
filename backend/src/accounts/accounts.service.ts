import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { getAccountBalance } from '../common/ledger/ledger.util';
import { computeTreasurySummary } from '../common/ledger/treasury.util';
import { CreateAccountDto } from './dto/create-account.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ReconcileDto } from './dto/reconcile.dto';
import { AdjustReconciliationDto } from './dto/adjust-reconciliation.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  // ---------- G.1 : solde_courant (RG-080) — source de vérité unique (common/ledger) ----------
  private getBalance(accountId: string): Promise<number> {
    return getAccountBalance(this.rlsContext.getClient(), accountId);
  }

  async create(userId: string, householdId: string, dto: CreateAccountDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.create({
        data: {
          householdId,
          name: dto.name,
          type: dto.type,
          includeInOperationalTreasury: dto.includeInOperationalTreasury ?? true,
          isProtected: dto.isProtected ?? false,
          ownerUserId: dto.ownerUserId,
        },
      });
      await tx.accountBalanceSnapshot.create({
        data: {
          accountId: account.id,
          declaredBalance: dto.initialBalance ?? 0,
          source: 'manuel',
          createdById: userId,
        },
      });
      const balance = await this.getBalance(account.id);
      return { ...account, soldeCourant: balance };
    });
  }

  async findAll(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const accounts = await tx.financialAccount.findMany({
        where: { householdId, status: 'actif' },
        orderBy: { createdAt: 'asc' },
      });
      return Promise.all(
        accounts.map(async (a) => ({ ...a, soldeCourant: await this.getBalance(a.id) })),
      );
    });
  }

  async findOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable');
      return { ...account, soldeCourant: await this.getBalance(account.id) };
    });
  }

  /** Un seul compte favori par foyer (index unique partiel) — utilisé par la saisie rapide (§14). */
  async setFavorite(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable');
      await tx.financialAccount.updateMany({ where: { householdId, isFavorite: true }, data: { isFavorite: false } });
      const updated = await tx.financialAccount.update({ where: { id }, data: { isFavorite: true } });
      return { ...updated, soldeCourant: await this.getBalance(id) };
    });
  }

  /**
   * Compte pré-rempli pour la saisie rapide (§14) : favori, sinon dernier compte
   * utilisé (LedgerEntry le plus récent du foyer), sinon compte "principal"
   * (le premier créé). Reste toujours modifiable par l'utilisateur.
   */
  async getQuickAddDefaultAccount(userId: string, householdId: string): Promise<string | null> {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const favorite = await tx.financialAccount.findFirst({ where: { householdId, status: 'actif', isFavorite: true } });
      if (favorite) return favorite.id;

      const lastUsed = await tx.$queryRaw<{ account_id: string }[]>`
        SELECT account_id FROM ledger_entry WHERE household_id = ${householdId} ORDER BY occurred_at DESC LIMIT 1
      `;
      if (lastUsed.length) return lastUsed[0].account_id;

      const first = await tx.financialAccount.findFirst({ where: { householdId, status: 'actif' }, orderBy: { createdAt: 'asc' } });
      return first ? first.id : null;
    });
  }

  // ---------- G.2 : Patrimoine liquide total / Trésorerie opérationnelle (RG-081/082) ----------
  async getTreasurySummary(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () => computeTreasurySummary(this.rlsContext.getClient(), householdId));
  }

  // ---------- RG-085 : transferts internes ----------
  async createTransfer(userId: string, householdId: string, dto: CreateTransferDto) {
    if (!dto.fromAccountId && !dto.toAccountId) {
      throw new BadRequestException('fromAccountId ou toAccountId est requis (RG-085)');
    }
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();

      for (const id of [dto.fromAccountId, dto.toAccountId].filter(Boolean) as string[]) {
        const exists = await tx.financialAccount.findFirst({ where: { id, householdId } });
        if (!exists) throw new NotFoundException(`Compte ${id} introuvable dans ce foyer`);
      }

      const type = dto.fromAccountId && dto.toAccountId ? 'interne' : dto.fromAccountId ? 'retrait_especes' : 'depot_especes';
      const plannedDate = dto.plannedDate ? new Date(dto.plannedDate) : new Date();
      const isImmediate = plannedDate.getTime() <= Date.now();

      const transfer = await tx.accountTransfer.create({
        data: {
          householdId,
          fromAccountId: dto.fromAccountId,
          toAccountId: dto.toAccountId,
          amount: dto.amount,
          plannedDate,
          type,
          status: isImmediate ? 'confirme' : 'prevu',
          actualDate: isImmediate ? plannedDate : undefined,
          confirmedById: isImmediate ? userId : undefined,
        },
      });

      const balances: Record<string, number> = {};
      if (dto.fromAccountId) balances[dto.fromAccountId] = await this.getBalance(dto.fromAccountId);
      if (dto.toAccountId) balances[dto.toAccountId] = await this.getBalance(dto.toAccountId);

      return { ...transfer, balancesAfter: balances };
    });
  }

  async listTransfers(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, () =>
      this.rlsContext.getClient().accountTransfer.findMany({ where: { householdId }, orderBy: { createdAt: 'desc' } }),
    );
  }

  /**
   * Confirme un transfert encore `prevu` (RG-085) — reste sans effet sur le solde
   * courant tant qu'il n'est pas confirmé (LedgerEntry ne retient que `confirme`).
   */
  async confirmTransfer(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const transfer = await tx.accountTransfer.findFirst({ where: { id, householdId } });
      if (!transfer) throw new NotFoundException('Transfert introuvable');
      if (transfer.status !== 'prevu') {
        throw new BadRequestException('Seul un transfert encore "prevu" peut être confirmé');
      }
      return tx.accountTransfer.update({
        where: { id },
        data: { status: 'confirme', actualDate: new Date(), confirmedById: userId },
      });
    });
  }

  // ---------- RG-083 : rapprochement bancaire ----------
  async reconcile(userId: string, householdId: string, accountId: string, dto: ReconcileDto) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable');

      const computedBalance = await this.getBalance(accountId);
      const discrepancy = Number((dto.declaredBalance - computedBalance).toFixed(2));

      // Jamais de correction automatique de l'écart (RG-083) — uniquement une constatation.
      return tx.reconciliation.create({
        data: {
          accountId,
          computedBalance,
          declaredBalance: dto.declaredBalance,
          discrepancy,
          status: discrepancy === 0 ? 'resolue' : 'pending',
          createdById: userId,
        },
      });
    });
  }

  async listReconciliations(userId: string, householdId: string, accountId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable');
      return tx.reconciliation.findMany({ where: { accountId }, orderBy: { reconciledAt: 'desc' } });
    });
  }

  /**
   * Action « Enregistrer un ajustement » (document 03 §I.11) — la seule des 4 actions de
   * rapprochement qui écrit un mouvement réel. Crée l'Adjustment qui comble exactement
   * l'écart constaté et clôt la Reconciliation. Jamais déclenché automatiquement (RG-000/083).
   */
  async adjustReconciliation(
    userId: string,
    householdId: string,
    accountId: string,
    reconciliationId: string,
    dto: AdjustReconciliationDto,
  ) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.financialAccount.findFirst({ where: { id: accountId, householdId } });
      if (!account) throw new NotFoundException('Compte introuvable');
      const reconciliation = await tx.reconciliation.findFirst({ where: { id: reconciliationId, accountId } });
      if (!reconciliation) throw new NotFoundException('Rapprochement introuvable');
      if (reconciliation.status === 'resolue') {
        throw new BadRequestException('Ce rapprochement est déjà résolu');
      }

      const adjustment = await tx.adjustment.create({
        data: {
          accountId,
          amount: reconciliation.discrepancy,
          reason: dto.reason ?? 'Écart de rapprochement',
          type: 'ecart_rapprochement',
          linkedReconciliationId: reconciliationId,
          createdById: userId,
        },
      });
      await tx.reconciliation.update({ where: { id: reconciliationId }, data: { status: 'resolue' } });

      return { adjustment, soldeCourant: await this.getBalance(accountId) };
    });
  }
}
