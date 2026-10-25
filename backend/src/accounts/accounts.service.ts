import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountOwnerType, Prisma } from '@prisma/client';
import { RlsContextService } from '../common/prisma/rls-context.service';
import { assertInvariants, buildLedgerLegs, computeAccountBalance, computeSubaccountBalance, lockAccounts } from '../common/ledger/ledger.util';

type TxClient = Prisma.TransactionClient;

/**
 * Invariant structurel (lot "responsable automatique") — validé ICI, pas
 * seulement côté client : INDIVIDUAL exige un ownerMemberId ; SHARED/
 * UNDEFINED l'exigent absent. Jamais déduit d'ownerLabel ni du nom du
 * compte — uniquement ownerType/ownerMemberId eux-mêmes.
 */
function assertOwnerCombination(ownerType: AccountOwnerType, ownerMemberId: string | null) {
  if (ownerType === 'INDIVIDUAL' && !ownerMemberId) {
    throw new BadRequestException('ownerMemberId est requis quand ownerType=INDIVIDUAL');
  }
  if (ownerType !== 'INDIVIDUAL' && ownerMemberId) {
    throw new BadRequestException(`ownerMemberId doit être absent quand ownerType=${ownerType}`);
  }
}

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

  await assertInvariants(tx, legs);
  return operation;
}

@Injectable()
export class AccountsService {
  constructor(private readonly rlsContext: RlsContextService) {}

  async create(
    userId: string,
    householdId: string,
    dto: {
      name: string;
      bank?: string;
      type?: string;
      ownerType?: AccountOwnerType;
      ownerMemberId?: string | null;
      ownerLabel?: string | null;
      openingBalance?: string;
      colorKey?: string;
    },
  ) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const ownerType = dto.ownerType ?? 'UNDEFINED';
      const ownerMemberId = dto.ownerMemberId ?? null;
      assertOwnerCombination(ownerType, ownerMemberId);
      const account = await tx.account.create({
        data: {
          householdId,
          name: dto.name,
          bank: dto.bank,
          type: (dto.type as never) ?? undefined,
          ownerType,
          ownerMemberId,
          ownerLabel: dto.ownerLabel,
          colorKey: dto.colorKey,
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

  /**
   * `includeInactive` (Organisation → Comptes, §7) : les sélecteurs de nouvelle
   * opération et l'Accueil n'appellent jamais avec `true` — un compte désactivé
   * ne doit plus être proposé par défaut pour de nouvelles opérations (§8),
   * mais reste visible dans son propre écran de gestion et dans l'historique.
   */
  async list(userId: string, householdId: string, includeInactive = false) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const accounts = await tx.account.findMany({
        where: { householdId, ...(includeInactive ? {} : { active: true }) },
        orderBy: { createdAt: 'asc' },
      });
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

  /** "Modifier" (Détail compte / Comptes, §7-§8) — champs d'identification + désactivation/réactivation logique. */
  async update(
    userId: string,
    householdId: string,
    id: string,
    dto: {
      name?: string;
      bank?: string;
      type?: string;
      ownerType?: AccountOwnerType;
      ownerMemberId?: string | null;
      ownerLabel?: string | null;
      active?: boolean;
      colorKey?: string;
    },
  ) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const account = await tx.account.findUnique({ where: { id } });
      if (!account || account.householdId !== householdId) throw new NotFoundException('Compte introuvable');

      // Validation sur la combinaison RÉSOLUE (merge avec la valeur actuelle
      // quand un seul des deux champs est envoyé) — jamais seulement sur ce
      // que le client a tapé isolément : un update partiel incohérent avec
      // l'état déjà en base est refusé, jamais silencieusement corrigé.
      const resolvedOwnerType = dto.ownerType ?? account.ownerType;
      const resolvedOwnerMemberId = dto.ownerMemberId !== undefined ? dto.ownerMemberId : account.ownerMemberId;
      if (dto.ownerType !== undefined || dto.ownerMemberId !== undefined) {
        assertOwnerCombination(resolvedOwnerType, resolvedOwnerMemberId);
      }

      await tx.account.update({
        where: { id },
        data: {
          name: dto.name,
          bank: dto.bank,
          type: dto.type as never,
          ownerType: dto.ownerType,
          ownerMemberId: dto.ownerMemberId,
          ownerLabel: dto.ownerLabel,
          active: dto.active,
          colorKey: dto.colorKey,
        },
      });

      // Lot "refonte Planning/À faire" §1 (correction prioritaire) — quand le
      // propriétaire RÉSOLU change réellement, les échéances FUTURES/non
      // exécutées dont le responsable a été hérité AUTOMATIQUEMENT (jamais
      // celles choisies manuellement — responsibleSource=MANUAL, protégées)
      // suivent le nouveau propriétaire. sourceAccountId pointe toujours vers
      // CE compte réel même quand la source finale est une de ses enveloppes
      // (sourceSubaccountId ne fait que la qualifier) — remonte donc déjà
      // naturellement au compte parent, jamais déduit du nom/libellé.
      const ownerChanged =
        (dto.ownerType !== undefined && dto.ownerType !== account.ownerType) ||
        (dto.ownerMemberId !== undefined && dto.ownerMemberId !== account.ownerMemberId);
      if (ownerChanged) {
        const newResponsibleMemberId = resolvedOwnerType === 'INDIVIDUAL' ? resolvedOwnerMemberId : null;
        await tx.plannedOperation.updateMany({
          where: { householdId, sourceAccountId: id, status: 'PENDING', responsibleSource: 'AUTO' },
          data: { responsibleMemberId: newResponsibleMemberId },
        });
        await tx.recurrenceRule.updateMany({
          where: { householdId, sourceAccountId: id, active: true, responsibleSource: 'AUTO' },
          data: { responsibleMemberId: newResponsibleMemberId },
        });
      }

      return this.toAccountDto(tx, id);
    });
  }

  /** "Modifier" (Détail sous-compte / Épargne & sous-comptes, §9-§10) — renommage + désactivation/réactivation logique. */
  async updateSubaccount(userId: string, householdId: string, id: string, dto: { name?: string; active?: boolean }) {
    return this.rlsContext.run(userId, householdId, async () => {
      const tx = this.rlsContext.getClient();
      const subaccount = await tx.subaccount.findUnique({ where: { id } });
      if (!subaccount || subaccount.householdId !== householdId) throw new NotFoundException('Sous-compte introuvable');
      await tx.subaccount.update({ where: { id }, data: { name: dto.name, active: dto.active } });
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
