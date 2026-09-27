/// <reference types="node" />
// Seed de démonstration Finance Maison (reset 2026-09-27) — données de référence
// exactes validées avec l'utilisateur (rapport de reset §13). Idempotent : ne
// recrée rien si le foyer de démo existe déjà (email fixe, cf. DEMO_EMAIL).
import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { insertFinancialOperation } from '../src/common/ledger/ledger.util';
import { seedDefaultFallbackCategory } from '../src/categories/categories.service';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@finance-maison.local';
const DEMO_PASSWORD = 'DemoFinanceMaison2026!';

async function setRlsContext(tx: Prisma.TransactionClient, userId: string, householdId: string) {
  await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
  await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    // eslint-disable-next-line no-console
    console.log('Foyer de démonstration déjà présent — seed ignoré (idempotent).');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash,
        firstName: 'Lamiaa',
        lastName: 'Demo',
        emailVerifiedAt: new Date(),
      },
    });

    // Id généré côté application AVANT l'insertion : permet de fixer le contexte RLS
    // (app.current_household_id) avant l'INSERT, condition nécessaire pour que la
    // clause RETURNING de Prisma (qui exige une policy SELECT satisfaite) réussisse
    // — même patron que HouseholdsService.create().
    const householdId = crypto.randomUUID();
    await setRlsContext(tx, user.id, householdId);

    const household = await tx.household.create({ data: { id: householdId, name: 'Foyer Demo' } });
    await tx.user.update({ where: { id: user.id }, data: { activeHouseholdId: household.id } });
    await tx.householdMembership.create({ data: { householdId: household.id, userId: user.id, role: 'admin' } });

    await seedDefaultFallbackCategory(tx, household.id);
    const [catCourses, catInternet, catVoiture, catSalaire, catPrime, catScolarite, catSante, catVoyage] = await Promise.all(
      ['Courses', 'Internet', 'Voiture', 'Salaire', 'Prime', 'Scolarité', 'Santé', 'Voyage'].map((name, i) =>
        tx.category.create({ data: { householdId: household.id, name, sortOrder: i } }),
      ),
    );

    // ---------- Comptes ----------
    const bpLamiaa = await tx.account.create({ data: { householdId: household.id, name: 'BP Lamiaa', bank: 'Banque Populaire', type: 'COURANT' } });
    const bpAdil = await tx.account.create({ data: { householdId: household.id, name: 'BP Adil', bank: 'Banque Populaire', type: 'COURANT' } });
    const epargneEnfants = await tx.account.create({ data: { householdId: household.id, name: 'Épargne Enfants', bank: 'Banque Populaire', type: 'EPARGNE' } });
    const epargne2 = await tx.account.create({ data: { householdId: household.id, name: 'Épargne 2', bank: 'Banque Populaire', type: 'EPARGNE' } });
    const cih = await tx.account.create({ data: { householdId: household.id, name: 'CIH', bank: 'CIH Bank', type: 'COURANT' } });
    const bpEpargne = await tx.account.create({ data: { householdId: household.id, name: 'BP Épargne', bank: 'Banque Populaire', type: 'EPARGNE' } });

    // ---------- Soldes d'ouverture (OPENING_BALANCE) ----------
    const openingBalance = async (accountId: string, amount: number, label: string) => {
      await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${accountId} FOR UPDATE`;
      return insertFinancialOperation(tx, {
        householdId: household.id,
        createdByUserId: user.id,
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
      const sub = await tx.subaccount.create({ data: { accountId, householdId: household.id, name } });
      await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${accountId} FOR UPDATE`;
      await insertFinancialOperation(tx, {
        householdId: household.id,
        createdByUserId: user.id,
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
    const lockAndInsert = async (accountIds: string[], params: Parameters<typeof insertFinancialOperation>[1]) => {
      for (const id of new Set(accountIds)) await tx.$queryRaw`SELECT id FROM "account" WHERE id = ${id} FOR UPDATE`;
      return insertFinancialOperation(tx, params);
    };

    // Salaires
    await lockAndInsert([bpLamiaa.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'INCOME',
      label: 'Salaire Lamiaa',
      date: new Date('2026-09-01'),
      amount: new Prisma.Decimal(12000),
      categoryId: catSalaire.id,
      destinationAccountId: bpLamiaa.id,
    });
    await lockAndInsert([bpAdil.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'INCOME',
      label: 'Salaire Adil',
      date: new Date('2026-09-01'),
      amount: new Prisma.Decimal(15000),
      categoryId: catSalaire.id,
      destinationAccountId: bpAdil.id,
    });

    // Dépenses courantes directes
    await lockAndInsert([bpLamiaa.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'EXPENSE',
      label: 'Courses',
      date: new Date('2026-09-05'),
      amount: new Prisma.Decimal(1200),
      categoryId: catCourses.id,
      sourceAccountId: bpLamiaa.id,
    });
    await lockAndInsert([bpAdil.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'EXPENSE',
      label: 'Internet',
      date: new Date('2026-09-07'),
      amount: new Prisma.Decimal(300),
      categoryId: catInternet.id,
      sourceAccountId: bpAdil.id,
    });

    // Dépense financée par sous-compte (voiture 700 DH — cf. exemple validé)
    await lockAndInsert([cih.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'EXPENSE',
      label: 'Réparation voiture',
      date: new Date('2026-09-10'),
      amount: new Prisma.Decimal(700),
      categoryId: catVoiture.id,
      sourceAccountId: cih.id,
      sourceSubaccountId: cihVoiture.id,
    });

    // Versements épargne
    await lockAndInsert([bpAdil.id, epargneEnfants.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'SAVINGS_CONTRIBUTION',
      label: 'Versement Épargne Enfants',
      date: new Date('2026-09-12'),
      amount: new Prisma.Decimal(2000),
      sourceAccountId: bpAdil.id,
      destinationAccountId: epargneEnfants.id,
    });
    await lockAndInsert([bpEpargne.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'SAVINGS_CONTRIBUTION',
      label: 'Versement Scolarité',
      date: new Date('2026-09-12'),
      amount: new Prisma.Decimal(1500),
      sourceAccountId: bpEpargne.id,
      destinationAccountId: bpEpargne.id,
      destinationSubaccountId: bpEpargneScolarite.id,
    });

    // Mutuelle — consultation santé remboursable intégralement (pas encore remboursée)
    const consultation = await lockAndInsert([cih.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'EXPENSE',
      label: 'Consultation santé',
      date: new Date('2026-09-15'),
      amount: new Prisma.Decimal(700),
      categoryId: catSante.id,
      sourceAccountId: cih.id,
      sourceSubaccountId: cihSante.id,
    });
    await tx.medicalClaim.create({
      data: { householdId: household.id, sourceOperationId: consultation.id, subaccountId: cihSante.id, label: 'Consultation santé', amountEngaged: new Prisma.Decimal(700) },
    });

    // Mutuelle — analyse laboratoire avec remboursement partiel reçu
    const analyse = await lockAndInsert([cih.id], {
      householdId: household.id,
      createdByUserId: user.id,
      kind: 'EXPENSE',
      label: 'Analyse laboratoire',
      date: new Date('2026-09-18'),
      amount: new Prisma.Decimal(400),
      categoryId: catSante.id,
      sourceAccountId: cih.id,
      sourceSubaccountId: cihSante.id,
    });
    const analyseClaim = await tx.medicalClaim.create({
      data: { householdId: household.id, sourceOperationId: analyse.id, subaccountId: cihSante.id, label: 'Analyse laboratoire', amountEngaged: new Prisma.Decimal(400) },
    });
    const reimbursementOp = await lockAndInsert([bpLamiaa.id], {
      householdId: household.id,
      createdByUserId: user.id,
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
        householdId: household.id,
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
        householdId: household.id,
        kind: 'INCOME',
        label: 'Prime annuelle',
        expectedDate: new Date('2026-12-01'),
        expectedAmount: new Prisma.Decimal(3000),
        categoryId: catPrime.id,
        destinationAccountId: bpAdil.id,
      },
    });

    // eslint-disable-next-line no-console
    console.log('Seed Finance Maison créé :', { email: DEMO_EMAIL, password: DEMO_PASSWORD, householdId: household.id });
  });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
