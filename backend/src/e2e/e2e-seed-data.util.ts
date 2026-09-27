import { Prisma } from '@prisma/client';
import { insertFinancialOperation } from '../common/ledger/ledger.util';
import { seedDefaultFallbackCategory } from '../categories/categories.service';

type TxClient = Prisma.TransactionClient;

/**
 * Jeu de données de démonstration Finance Maison — extrait de prisma/seed.ts
 * (source unique, jamais dupliqué) pour être réutilisable à la fois :
 * - à la création initiale du foyer de démo (prisma/seed.ts) ;
 * - après une réinitialisation E2E (backend/src/e2e/e2e.service.ts), pour que
 *   chaque campagne Maestro reparte d'un état de données identique et connu.
 *
 * Suppose que le foyer et son admin existent déjà et que le contexte RLS est
 * déjà positionné par l'appelant (rlsContext.run côté E2E, setRlsContext côté
 * seed.ts).
 */
export async function seedBaselineHouseholdData(tx: TxClient, params: { householdId: string; userId: string }): Promise<void> {
  const { householdId, userId } = params;

  await seedDefaultFallbackCategory(tx, householdId);
  const [catCourses, catInternet, catVoiture, catSalaire, catPrime, catScolarite, catSante, catVoyage] = await Promise.all(
    ['Courses', 'Internet', 'Voiture', 'Salaire', 'Prime', 'Scolarité', 'Santé', 'Voyage'].map((name, i) =>
      tx.category.create({ data: { householdId, name, sortOrder: i } }),
    ),
  );

  // ---------- Comptes ----------
  const bpLamiaa = await tx.account.create({ data: { householdId, name: 'BP Lamiaa', bank: 'Banque Populaire', type: 'COURANT' } });
  const bpAdil = await tx.account.create({ data: { householdId, name: 'BP Adil', bank: 'Banque Populaire', type: 'COURANT' } });
  const epargneEnfants = await tx.account.create({ data: { householdId, name: 'Épargne Enfants', bank: 'Banque Populaire', type: 'EPARGNE' } });
  const epargne2 = await tx.account.create({ data: { householdId, name: 'Épargne 2', bank: 'Banque Populaire', type: 'EPARGNE' } });
  const cih = await tx.account.create({ data: { householdId, name: 'CIH', bank: 'CIH Bank', type: 'COURANT' } });
  const bpEpargne = await tx.account.create({ data: { householdId, name: 'BP Épargne', bank: 'Banque Populaire', type: 'EPARGNE' } });

  // ---------- Soldes d'ouverture (OPENING_BALANCE) ----------
  const openingBalance = async (accountId: string, amount: number, label: string) => {
    await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${accountId} FOR UPDATE`;
    return insertFinancialOperation(tx, {
      householdId,
      createdByUserId: userId,
      kind: 'OPENING_BALANCE',
      label,
      date: new Date('2026-01-01'),
      amount: new Prisma.Decimal(amount),
      destinationAccountId: accountId,
    });
  };

  await openingBalance(bpLamiaa.id, 25000, "Solde d'ouverture — BP Lamiaa");
  await openingBalance(bpAdil.id, 30000, "Solde d'ouverture — BP Adil");
  await openingBalance(epargneEnfants.id, 42000, "Solde d'ouverture — Épargne Enfants");
  await openingBalance(epargne2.id, 18000, "Solde d'ouverture — Épargne 2");
  await openingBalance(cih.id, 20000, "Solde d'ouverture — CIH");
  await openingBalance(bpEpargne.id, 60000, "Solde d'ouverture — BP Épargne");

  // ---------- Sous-comptes + allocation initiale ----------
  const createSubaccount = async (accountId: string, name: string, initialAllocation: number) => {
    const sub = await tx.subaccount.create({ data: { accountId, householdId, name } });
    await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${accountId} FOR UPDATE`;
    await insertFinancialOperation(tx, {
      householdId,
      createdByUserId: userId,
      kind: 'OPENING_BALANCE',
      label: `Allocation initiale — ${name}`,
      date: new Date('2026-01-01'),
      amount: new Prisma.Decimal(initialAllocation),
      destinationAccountId: accountId,
      destinationSubaccountId: sub.id,
    });
    return sub;
  };

  const cihVoiture = await createSubaccount(cih.id, 'CIH-Voiture', 5000);
  const cihVoyage = await createSubaccount(cih.id, 'CIH-Voyage', 4000);
  const cihSante = await createSubaccount(cih.id, 'CIH-Santé', 3000);
  const bpEpargneScolarite = await createSubaccount(bpEpargne.id, 'BP Épargne-Scolarité', 45000);
  await createSubaccount(bpEpargne.id, 'BP Épargne-Autres', 10000);

  // ---------- Opérations réalisées de démonstration ----------
  const lockAndInsert = async (accountIds: string[], operationParams: Parameters<typeof insertFinancialOperation>[1]) => {
    for (const id of new Set(accountIds)) await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${id} FOR UPDATE`;
    return insertFinancialOperation(tx, operationParams);
  };

  await lockAndInsert([bpLamiaa.id], {
    householdId,
    createdByUserId: userId,
    kind: 'INCOME',
    label: 'Salaire Lamiaa',
    date: new Date('2026-09-01'),
    amount: new Prisma.Decimal(12000),
    categoryId: catSalaire.id,
    destinationAccountId: bpLamiaa.id,
  });
  await lockAndInsert([bpAdil.id], {
    householdId,
    createdByUserId: userId,
    kind: 'INCOME',
    label: 'Salaire Adil',
    date: new Date('2026-09-01'),
    amount: new Prisma.Decimal(15000),
    categoryId: catSalaire.id,
    destinationAccountId: bpAdil.id,
  });

  await lockAndInsert([bpLamiaa.id], {
    householdId,
    createdByUserId: userId,
    kind: 'EXPENSE',
    label: 'Courses',
    date: new Date('2026-09-05'),
    amount: new Prisma.Decimal(1200),
    categoryId: catCourses.id,
    sourceAccountId: bpLamiaa.id,
  });
  await lockAndInsert([bpAdil.id], {
    householdId,
    createdByUserId: userId,
    kind: 'EXPENSE',
    label: 'Internet',
    date: new Date('2026-09-07'),
    amount: new Prisma.Decimal(300),
    categoryId: catInternet.id,
    sourceAccountId: bpAdil.id,
  });

  await lockAndInsert([cih.id], {
    householdId,
    createdByUserId: userId,
    kind: 'EXPENSE',
    label: 'Réparation voiture',
    date: new Date('2026-09-10'),
    amount: new Prisma.Decimal(700),
    categoryId: catVoiture.id,
    sourceAccountId: cih.id,
    sourceSubaccountId: cihVoiture.id,
  });

  await lockAndInsert([bpAdil.id, epargneEnfants.id], {
    householdId,
    createdByUserId: userId,
    kind: 'SAVINGS_CONTRIBUTION',
    label: 'Versement Épargne Enfants',
    date: new Date('2026-09-12'),
    amount: new Prisma.Decimal(2000),
    sourceAccountId: bpAdil.id,
    destinationAccountId: epargneEnfants.id,
  });
  await lockAndInsert([bpEpargne.id], {
    householdId,
    createdByUserId: userId,
    kind: 'SAVINGS_CONTRIBUTION',
    label: 'Versement Scolarité',
    date: new Date('2026-09-12'),
    amount: new Prisma.Decimal(1500),
    sourceAccountId: bpEpargne.id,
    destinationAccountId: bpEpargne.id,
    destinationSubaccountId: bpEpargneScolarite.id,
  });

  const consultation = await lockAndInsert([cih.id], {
    householdId,
    createdByUserId: userId,
    kind: 'EXPENSE',
    label: 'Consultation santé',
    date: new Date('2026-09-15'),
    amount: new Prisma.Decimal(700),
    categoryId: catSante.id,
    sourceAccountId: cih.id,
    sourceSubaccountId: cihSante.id,
  });
  await tx.medicalClaim.create({
    data: { householdId, sourceOperationId: consultation.id, subaccountId: cihSante.id, label: 'Consultation santé', amountEngaged: new Prisma.Decimal(700) },
  });

  const analyse = await lockAndInsert([cih.id], {
    householdId,
    createdByUserId: userId,
    kind: 'EXPENSE',
    label: 'Analyse laboratoire',
    date: new Date('2026-09-18'),
    amount: new Prisma.Decimal(400),
    categoryId: catSante.id,
    sourceAccountId: cih.id,
    sourceSubaccountId: cihSante.id,
  });
  const analyseClaim = await tx.medicalClaim.create({
    data: { householdId, sourceOperationId: analyse.id, subaccountId: cihSante.id, label: 'Analyse laboratoire', amountEngaged: new Prisma.Decimal(400) },
  });
  const reimbursementOp = await lockAndInsert([bpLamiaa.id], {
    householdId,
    createdByUserId: userId,
    kind: 'MEDICAL_REIMBURSEMENT',
    label: 'Remboursement mutuelle — Analyse laboratoire',
    date: new Date('2026-09-25'),
    amount: new Prisma.Decimal(250),
    destinationAccountId: bpLamiaa.id,
  });
  await tx.medicalReimbursement.create({
    data: { claimId: analyseClaim.id, amount: new Prisma.Decimal(250), date: new Date('2026-09-25'), operationId: reimbursementOp.id },
  });

  // ---------- Opérations planifiées (Planning) ----------
  await tx.plannedOperation.create({
    data: {
      householdId,
      kind: 'EXPENSE',
      label: 'Voyage Été',
      expectedDate: new Date('2026-12-15'),
      expectedAmount: new Prisma.Decimal(8000),
      categoryId: catVoyage.id,
      sourceAccountId: cih.id,
      sourceSubaccountId: cihVoyage.id,
    },
  });
  await tx.plannedOperation.create({
    data: {
      householdId,
      kind: 'INCOME',
      label: 'Prime annuelle',
      expectedDate: new Date('2026-12-01'),
      expectedAmount: new Prisma.Decimal(3000),
      categoryId: catPrime.id,
      destinationAccountId: bpAdil.id,
    },
  });
}
