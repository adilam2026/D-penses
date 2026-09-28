import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { resolveFallbackCategoryId } from '../../categories/categories.service';

type TxClient = Prisma.TransactionClient;
type Kind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'SAVINGS_CONTRIBUTION' | 'MEDICAL_REIMBURSEMENT' | 'OPENING_BALANCE';
type FinancedFrom = 'DIRECT' | 'SUBACCOUNT';
type BudgetImpact = 'NORMAL' | 'ALREADY_FUNDED' | 'EXCLUDED';

export interface OperationShape {
  sourceAccountId?: string | null;
  sourceSubaccountId?: string | null;
  destinationAccountId?: string | null;
  destinationSubaccountId?: string | null;
}

export interface LedgerLeg {
  accountId: string;
  subaccountId: string | null;
  amount: Prisma.Decimal;
  affectsAccountBalance: boolean;
}

type FieldRule = 'required' | 'forbidden' | 'optional';

// Tableau de contraintes par kind (cf. rapport de reset — schéma V3.1 §invariants).
const SHAPE_RULES: Record<Kind, { sourceAccount: FieldRule; sourceSubaccount: FieldRule; destinationAccount: FieldRule; destinationSubaccount: FieldRule }> = {
  EXPENSE: { sourceAccount: 'required', sourceSubaccount: 'optional', destinationAccount: 'forbidden', destinationSubaccount: 'forbidden' },
  INCOME: { sourceAccount: 'forbidden', sourceSubaccount: 'forbidden', destinationAccount: 'required', destinationSubaccount: 'optional' },
  SAVINGS_CONTRIBUTION: { sourceAccount: 'required', sourceSubaccount: 'optional', destinationAccount: 'required', destinationSubaccount: 'optional' },
  TRANSFER: { sourceAccount: 'required', sourceSubaccount: 'forbidden', destinationAccount: 'required', destinationSubaccount: 'forbidden' },
  MEDICAL_REIMBURSEMENT: { sourceAccount: 'forbidden', sourceSubaccount: 'forbidden', destinationAccount: 'required', destinationSubaccount: 'optional' },
  OPENING_BALANCE: { sourceAccount: 'forbidden', sourceSubaccount: 'forbidden', destinationAccount: 'required', destinationSubaccount: 'optional' },
};

/** Vérifie le tableau de contraintes source/destination par kind — REFUSE toute forme invalide. */
export function validateOperationShape(kind: Kind, shape: OperationShape): void {
  const rules = SHAPE_RULES[kind];
  const check = (label: string, rule: FieldRule, value: string | null | undefined) => {
    if (rule === 'required' && !value) throw new BadRequestException(`${kind} : ${label} est obligatoire`);
    if (rule === 'forbidden' && value) throw new BadRequestException(`${kind} : ${label} est interdit`);
  };
  check('source_account_id', rules.sourceAccount, shape.sourceAccountId);
  check('source_subaccount_id', rules.sourceSubaccount, shape.sourceSubaccountId);
  check('destination_account_id', rules.destinationAccount, shape.destinationAccountId);
  check('destination_subaccount_id', rules.destinationSubaccount, shape.destinationSubaccountId);
}

/**
 * Détermine financed_from/budget_impact par défaut à partir du kind et de la
 * présence de source_subaccount_id — jamais saisi manuellement par le client.
 */
export function deriveFinancedFromAndBudgetImpact(kind: Kind, shape: OperationShape): { financedFrom: FinancedFrom | null; budgetImpact: BudgetImpact } {
  switch (kind) {
    case 'EXPENSE':
    case 'SAVINGS_CONTRIBUTION':
      return shape.sourceSubaccountId
        ? { financedFrom: 'SUBACCOUNT', budgetImpact: 'ALREADY_FUNDED' }
        : { financedFrom: 'DIRECT', budgetImpact: 'NORMAL' };
    case 'INCOME':
      return { financedFrom: null, budgetImpact: 'NORMAL' };
    case 'TRANSFER':
    case 'MEDICAL_REIMBURSEMENT':
    case 'OPENING_BALANCE':
      return { financedFrom: null, budgetImpact: 'EXCLUDED' };
  }
}

/**
 * Construit les écritures ledger pour une opération — cf. les 10 exemples
 * chiffrés validés (rapport de reset). "Non affecté" n'est jamais une ligne
 * du ledger : une réallocation pure non_affecté <-> sous-compte (même compte,
 * un seul côté avec sous-compte) ne produit qu'UNE écriture, jamais deux.
 */
export function buildLedgerLegs(kind: Kind, shape: OperationShape, amount: Prisma.Decimal): LedgerLeg[] {
  const { sourceAccountId, sourceSubaccountId, destinationAccountId, destinationSubaccountId } = shape;

  switch (kind) {
    case 'EXPENSE':
      return [{ accountId: sourceAccountId!, subaccountId: sourceSubaccountId ?? null, amount: amount.neg(), affectsAccountBalance: true }];

    case 'INCOME':
    case 'MEDICAL_REIMBURSEMENT':
    case 'OPENING_BALANCE': {
      if (destinationSubaccountId) {
        // OPENING_BALANCE d'un sous-compte = pure allocation de fonds déjà présents
        // dans le compte (jamais un ajout de fonds) -> affects_account_balance=false.
        // INCOME/MEDICAL_REIMBURSEMENT directement dans un sous-compte = argent
        // réellement nouveau, aussitôt fléché -> une seule écriture combinée true.
        return [{ accountId: destinationAccountId!, subaccountId: destinationSubaccountId, amount, affectsAccountBalance: kind !== 'OPENING_BALANCE' }];
      }
      return [{ accountId: destinationAccountId!, subaccountId: null, amount, affectsAccountBalance: true }];
    }

    case 'TRANSFER':
      return [
        { accountId: sourceAccountId!, subaccountId: null, amount: amount.neg(), affectsAccountBalance: true },
        { accountId: destinationAccountId!, subaccountId: null, amount, affectsAccountBalance: true },
      ];

    case 'SAVINGS_CONTRIBUTION': {
      const sameAccount = !!sourceAccountId && !!destinationAccountId && sourceAccountId === destinationAccountId;

      // Réallocation pure au sein du même compte : un seul côté porte un
      // sous-compte, l'autre est le non-affecté (jamais matérialisé) -> 1 écriture.
      if (sameAccount && !!sourceSubaccountId !== !!destinationSubaccountId) {
        if (sourceSubaccountId) {
          return [{ accountId: sourceAccountId!, subaccountId: sourceSubaccountId, amount: amount.neg(), affectsAccountBalance: false }];
        }
        return [{ accountId: destinationAccountId!, subaccountId: destinationSubaccountId!, amount, affectsAccountBalance: false }];
      }

      const legs: LedgerLeg[] = [];
      if (sourceSubaccountId) {
        legs.push({ accountId: sourceAccountId!, subaccountId: sourceSubaccountId, amount: amount.neg(), affectsAccountBalance: !sameAccount });
      } else {
        legs.push({ accountId: sourceAccountId!, subaccountId: null, amount: amount.neg(), affectsAccountBalance: true });
      }
      if (destinationSubaccountId) {
        if (sameAccount) {
          legs.push({ accountId: destinationAccountId!, subaccountId: destinationSubaccountId, amount, affectsAccountBalance: false });
        } else {
          legs.push({ accountId: destinationAccountId!, subaccountId: null, amount, affectsAccountBalance: true });
          legs.push({ accountId: destinationAccountId!, subaccountId: destinationSubaccountId, amount, affectsAccountBalance: false });
        }
      } else {
        legs.push({ accountId: destinationAccountId!, subaccountId: null, amount, affectsAccountBalance: true });
      }
      return legs;
    }
  }
}

/** Un renversement produit l'exact inverse des écritures de l'opération d'origine. */
export function negateLegs(legs: LedgerLeg[]): LedgerLeg[] {
  return legs.map((leg) => ({ ...leg, amount: leg.amount.neg() }));
}

export async function assertSubaccountBelongsToAccount(tx: TxClient, subaccountId: string, accountId: string): Promise<void> {
  const subaccount = await tx.subaccount.findUnique({ where: { id: subaccountId }, select: { accountId: true } });
  if (!subaccount || subaccount.accountId !== accountId) {
    throw new BadRequestException('Le sous-compte ne correspond pas au compte indiqué');
  }
}

/** Verrouille les lignes account (FOR UPDATE), triées par id pour éviter tout deadlock entre transactions concurrentes. */
export async function lockAccounts(tx: TxClient, accountIds: string[]): Promise<void> {
  const unique = Array.from(new Set(accountIds)).sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`SELECT id FROM "account" WHERE id = ANY(${unique}) ORDER BY id FOR UPDATE`;
}

export async function computeAccountBalance(tx: TxClient, accountId: string): Promise<Prisma.Decimal> {
  const result = await tx.ledgerEntry.aggregate({
    where: { accountId, affectsAccountBalance: true },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

export async function computeSubaccountBalance(tx: TxClient, subaccountId: string): Promise<Prisma.Decimal> {
  const result = await tx.ledgerEntry.aggregate({
    where: { subaccountId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? new Prisma.Decimal(0);
}

export async function computeNonAffecte(tx: TxClient, accountId: string): Promise<Prisma.Decimal> {
  const [balance, subaccounts] = await Promise.all([
    computeAccountBalance(tx, accountId),
    tx.subaccount.findMany({ where: { accountId }, select: { id: true } }),
  ]);
  let allocated = new Prisma.Decimal(0);
  for (const sub of subaccounts) {
    allocated = allocated.add(await computeSubaccountBalance(tx, sub.id));
  }
  return balance.sub(allocated);
}

/** Doit être appelé APRÈS insertion des écritures (dans la même transaction), après lockAccounts(). */
export async function assertInvariants(tx: TxClient, affectedAccountIds: string[], affectedSubaccountIds: string[]): Promise<void> {
  for (const accountId of new Set(affectedAccountIds)) {
    const nonAffecte = await computeNonAffecte(tx, accountId);
    if (nonAffecte.isNegative()) {
      throw new BadRequestException('Non affecté insuffisant : cette opération dépasse le solde disponible du compte');
    }
  }
  for (const subaccountId of new Set(affectedSubaccountIds)) {
    const balance = await computeSubaccountBalance(tx, subaccountId);
    if (balance.isNegative()) {
      throw new BadRequestException('Solde insuffisant sur ce sous-compte');
    }
  }
}

export function effectiveAmount(op: { amount: Prisma.Decimal; reversalOfOperationId: string | null }): Prisma.Decimal {
  return op.reversalOfOperationId ? op.amount.neg() : op.amount;
}

export interface InsertOperationParams {
  householdId: string;
  createdByUserId: string;
  kind: Kind;
  label: string;
  date: Date;
  amount: Prisma.Decimal;
  categoryId?: string | null;
  sourceAccountId?: string | null;
  sourceSubaccountId?: string | null;
  destinationAccountId?: string | null;
  destinationSubaccountId?: string | null;
  reversalOfOperationId?: string | null;
  reversalReason?: string | null;
  /** "Modifier" une opération réalisée (§4) : pointe vers l'opération ORIGINALE
   * (pas vers son reversal) pour garder une chaîne d'audit explicite en base. */
  correctionOfOperationId?: string | null;
}

/**
 * Cœur transactionnel partagé : valide la forme, verrouille les comptes concernés,
 * construit les écritures ledger, insère opération + écritures, vérifie les
 * invariants. Prend un `tx` déjà ouvert (jamais son propre $transaction) afin de
 * rester composable depuis PlannedOperationsService#realize (même transaction que
 * la mise à jour de statut planned_operation -> REALIZED).
 */
export async function insertFinancialOperation(tx: TxClient, params: InsertOperationParams) {
  const shape: OperationShape = {
    sourceAccountId: params.sourceAccountId ?? null,
    sourceSubaccountId: params.sourceSubaccountId ?? null,
    destinationAccountId: params.destinationAccountId ?? null,
    destinationSubaccountId: params.destinationSubaccountId ?? null,
  };
  validateOperationShape(params.kind, shape);

  if (params.amount.lte(0)) throw new BadRequestException('Le montant doit être strictement positif');

  if (params.reversalOfOperationId) {
    const original = await tx.financialOperation.findUnique({ where: { id: params.reversalOfOperationId } });
    if (!original || original.householdId !== params.householdId) throw new NotFoundException('Opération à annuler introuvable');
    if (original.reversalOfOperationId) throw new BadRequestException("Impossible d'annuler une opération qui est elle-même un renversement");
  }

  if (params.sourceSubaccountId) await assertSubaccountBelongsToAccount(tx, params.sourceSubaccountId, params.sourceAccountId!);
  if (params.destinationSubaccountId) await assertSubaccountBelongsToAccount(tx, params.destinationSubaccountId, params.destinationAccountId!);

  // "Autres" obligatoire (Checkpoint 3) : une dépense non planifiée créée sans
  // catégorie (ex. "Aspirateur 2500 DH") tombe automatiquement dans "Autres" —
  // jamais de catégorie null qui échapperait à l'agrégation du Planning.
  let categoryId = params.categoryId ?? null;
  if (params.kind === 'EXPENSE' && !categoryId) {
    categoryId = await resolveFallbackCategoryId(tx, params.householdId);
  }

  const affectedAccountIds = [params.sourceAccountId, params.destinationAccountId].filter((x): x is string => !!x);
  await lockAccounts(tx, affectedAccountIds);

  const { financedFrom, budgetImpact } = deriveFinancedFromAndBudgetImpact(params.kind, shape);
  let legs = buildLedgerLegs(params.kind, shape, params.amount);
  if (params.reversalOfOperationId) legs = negateLegs(legs);

  const operation = await tx.financialOperation.create({
    data: {
      householdId: params.householdId,
      kind: params.kind,
      label: params.label,
      date: params.date,
      amount: params.amount,
      categoryId: categoryId ?? undefined,
      sourceAccountId: params.sourceAccountId ?? undefined,
      sourceSubaccountId: params.sourceSubaccountId ?? undefined,
      destinationAccountId: params.destinationAccountId ?? undefined,
      destinationSubaccountId: params.destinationSubaccountId ?? undefined,
      financedFrom: financedFrom ?? undefined,
      budgetImpact,
      reversalOfOperationId: params.reversalOfOperationId ?? undefined,
      reversalReason: params.reversalReason ?? undefined,
      correctionOfOperationId: params.correctionOfOperationId ?? undefined,
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

  const affectedSubaccountIds = [params.sourceSubaccountId, params.destinationSubaccountId].filter((x): x is string => !!x);
  await assertInvariants(tx, affectedAccountIds, affectedSubaccountIds);

  return operation;
}
