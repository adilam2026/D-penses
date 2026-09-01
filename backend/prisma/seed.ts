/// <reference types="node" />
// Catégories système (document 02 §31) — partagées par tous les foyers (household_id NULL).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_CATEGORIES: Array<{ name: string; kind: 'income' | 'expense' | 'both' }> = [
  { name: 'Logement', kind: 'expense' },
  { name: 'Alimentation', kind: 'expense' },
  { name: 'Enfants', kind: 'expense' },
  { name: 'École', kind: 'expense' },
  { name: 'Transport', kind: 'expense' },
  { name: 'Voiture', kind: 'expense' },
  { name: 'Assurance', kind: 'expense' },
  { name: 'Santé', kind: 'expense' },
  { name: 'Loisirs', kind: 'expense' },
  { name: 'Abonnements', kind: 'expense' },
  { name: 'Personnel maison', kind: 'expense' },
  { name: 'Vêtements', kind: 'expense' },
  { name: 'Vacances', kind: 'expense' },
  { name: 'Impôts / taxes', kind: 'expense' },
  { name: 'Épargne', kind: 'expense' },
  { name: 'Salaire', kind: 'income' },
  { name: 'Prime', kind: 'income' },
  { name: 'Revenu locatif', kind: 'income' },
  { name: 'Autre', kind: 'both' },
];

async function main() {
  for (const c of SYSTEM_CATEGORIES) {
    const existing = await prisma.category.findFirst({ where: { name: c.name, householdId: null } });
    if (!existing) {
      await prisma.category.create({ data: { ...c, isSystem: true } });
    }
  }
  // eslint-disable-next-line no-console
  console.log(`Catégories système en place (${SYSTEM_CATEGORIES.length}).`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
