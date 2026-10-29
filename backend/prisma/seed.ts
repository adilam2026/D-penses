/// <reference types="node" />
// Seed de démonstration Finance Maison (reset 2026-09-27) — données de référence
// exactes validées avec l'utilisateur (rapport de reset §13). Idempotent : ne
// recrée rien si le foyer de démo existe déjà (email fixe, cf. DEMO_EMAIL).
import { PrismaClient, Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { seedBaselineHouseholdData } from '../src/e2e/e2e-seed-data.util';
import { isTrivialPin, PIN_PATTERN } from '../src/auth/pin.util';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@finance-maison.local';

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

  // Code personnel à 6 chiffres du compte démo, fourni par l'environnement
  // (jamais dans Git). Sans lui, aucun compte démo n'est créé — le déploiement
  // continue normalement (environnement où la démo existe déjà : rien à faire).
  const demoPin = process.env.SEED_DEMO_PIN ?? '';
  if (!PIN_PATTERN.test(demoPin) || isTrivialPin(demoPin)) {
    // eslint-disable-next-line no-console
    console.log('SEED_DEMO_PIN absent ou invalide (6 chiffres non triviaux) — compte démo non créé.');
    return;
  }
  const passwordHash = await bcrypt.hash(demoPin, 12);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: DEMO_EMAIL,
        passwordHash,
        firstName: 'Lamiaa',
        lastName: 'Demo',
        emailVerifiedAt: new Date(),
        pinSetAt: new Date(),
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

    await seedBaselineHouseholdData(tx, { householdId: household.id, userId: user.id });

    // Jamais le code dans les journaux.
    // eslint-disable-next-line no-console
    console.log('Seed Finance Maison créé :', { email: DEMO_EMAIL, householdId: household.id });
  });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
