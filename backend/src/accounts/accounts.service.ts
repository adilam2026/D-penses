import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { assertInvariants, buildLedgerLegs, computeAccountBalance, computeSubaccountBalance, lockAccounts } from '../common/ledger/ledger.util';

type TxClient = Prisma.TransactionClient;

/** Crée l'opération OPENING_BALANCE + ses écritures ledger — appelé dans une transaction déjà ouverte. */
async function createOpeningBalance(
  tx: TxClient,
  params: { householdId: string; createdByUserId: string; accountId: string; subaccountId?: string; amount: Prisma.Decimal; label: string },
) {
  const shape = { destinationAccountId: params.accountId, destinationSubaccountId: params.subaccountId ?? null };
  const legs = buildLedgerLegs('OPENING_BALANCE', shape, params.amount);

  const operation = await tx.financialOperation.create({
    data: {
      householdId: params.householdId,
      kind: 'OPENING_BALANCE',
      label: params.label,
      date: new Date(),
      amount: params.amount,
      destinationAccountId: params.accountId,
      destinationSubaccountId: params.subaccountId ?? null,
      budgetImpact: 'EXCLUDED',
      createdByUserId: params.createdByUserId,
    },
  });

  await tx.ledgerEntry.createMany({
    data: legs.map((leg) => ({
      financialOperationId: operation.id,
      accountId: leg.accountId,
      subaccountId: leg.subaccountId,
      amount: leg.amount,
      affectsAccountBalance: leg.affectsAccountBalance,
    })),
  });

  await assertInvariants(tx, [params.accountId], params.subaccountId ? [params.subaccountId] : []);
  return operation;
}

@Injectable()
export class AccountsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(
    userId: string,
    householdId: string,
    dto: { name: string; bank?: string; type?: string; ownerMemberId?: string; ownerLabel?: string; openingBalance?: string },
  ) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.account.create({
        data: {
          householdId,
          name: dto.name,
          bank: dto.bank,
          type: (dto.type as never) ?? undefined,
          ownerMemberId: dto.ownerMemberId,
          ownerLabel: dto.ownerLabel,
        },
      });

      if (dto.openingBalance && new Prisma.Decimal(dto.openingBalance).gt(0)) {
        await lockAccounts(tx, [account.id]);
        await createOpeningBalance(tx, {
          householdId,
          createdByUserId: userId,
          accountId: account.id,
          amount: new Prisma.Decimal(dto.openingBalance),
          label: `Solde d'ouverture — ${account.name}`,
        });
      }

      return this.toAccountDto(tx, account.id);
    });
  }

  async createSubaccount(userId: string, householdId: string, dto: { accountId: string; name: string; initialAllocation?: string }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.account.findUnique({ where: { id: dto.accountId } });
      if (!account || account.householdId !== householdId) throw new NotFoundException('Compte introuvable');

      const subaccount = await tx.subaccount.create({
        data: { accountId: dto.accountId, householdId, name: dto.name },
      });

      if (dto.initialAllocation && new Prisma.Decimal(dto.initialAllocation).gt(0)) {
        await lockAccounts(tx, [dto.accountId]);
        await createOpeningBalance(tx, {
          householdId,
          createdByUserId: userId,
          accountId: dto.accountId,
          subaccountId: subaccount.id,
          amount: new Prisma.Decimal(dto.initialAllocation),
          label: `Allocation initiale — ${subaccount.name}`,
        });
      }

      return this.toSubaccountDto(tx, subaccount.id);
    });
  }

  async list(userId: string, householdId: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const accounts = await tx.account.findMany({ where: { householdId }, orderBy: { createdAt: 'asc' } });
      return Promise.all(accounts.map((a) => this.toAccountDto(tx, a.id)));
    });
  }

  async getOne(userId: string, householdId: string, id: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.account.findUnique({ where: { id } });
      if (!account || account.householdId !== householdId) throw new NotFoundException('Compte introuvable');
      return this.toAccountDto(tx, id);
    });
  }

  /** "Modifier" (Détail compte, §8) — renommage uniquement, écran très simple. */
  async rename(userId: string, householdId: string, id: string, name: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.account.findUnique({ where: { id } });
      if (!account || account.householdId !== householdId) throw new NotFoundException('Compte introuvable');
      await tx.account.update({ where: { id }, data: { name } });
      return this.toAccountDto(tx, id);
    });
  }

  /** "Modifier" (Détail sous-compte, §9) — renommage uniquement. */
  async renameSubaccount(userId: string, householdId: string, id: string, name: string) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const subaccount = await tx.subaccount.findUnique({ where: { id } });
      if (!subaccount || subaccount.householdId !== householdId) throw new NotFoundException('Sous-compte introuvable');
      await tx.subaccount.update({ where: { id }, data: { name } });
      return this.toSubaccountDto(tx, id);
    });
  }

  /**
   * §performance (recette globale) : nonAffecte se déduit de balance - somme des
   * soldes sous-comptes déjà calculés pour subaccountDtos, jamais recalculé via
   * computeNonAffecte (qui re-requêterait les mêmes sous-comptes une 2e fois).
   */
  private async toAccountDto(tx: TxClient, accountId: string) {
    const account = await tx.account.findUniqueOrThrow({ where: { id: accountId } });
    const subaccounts = await tx.subaccount.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });
    const [balance, subaccountDtos] = await Promise.all([
      computeAccountBalance(tx, accountId),
      Promise.all(subaccounts.map((s) => this.toSubaccountDto(tx, s.id))),
    ]);
    const allocated = subaccountDtos.reduce((sum, s) => sum.add(s.balance), new Prisma.Decimal(0));
    const nonAffecte = balance.sub(allocated);
    return { ...account, balance, nonAffecte, subaccounts: subaccountDtos };
  }

  private async toSubaccountDto(tx: TxClient, subaccountId: string) {
    const subaccount = await tx.subaccount.findUniqueOrThrow({ where: { id: subaccountId } });
    const balance = await computeSubaccountBalance(tx, subaccountId);
    return { ...subaccount, balance };
  }
}
