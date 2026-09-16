/* eslint-disable no-console */
/**
 * Corrections UI/UX (point 2 — nettoyage des doublons existants) : avant le
 * fix de FinancialPlansService.remove() (cf. rapport), supprimer un
 * FinancialPlan ne faisait que détacher ses ChargePlan/Deadline
 * (financial_plan_id → NULL) sans jamais les annuler — ils restaient actifs
 * et continuaient d'apparaître dans Calendrier/Projection. Recréer le même
 * plan ensuite produisait alors des doublons visibles (ex. Dina, plan
 * scolaire supprimé puis recréé).
 *
 * Ce script identifie ces orphelins pour UN enfant donné : un ChargePlan
 * sans financial_plan_id, rattaché à cet enfant, dont le libellé correspond
 * à un ChargePlan actif (financial_plan_id non nul) rattaché AU MÊME enfant
 * — jamais une suppression par simple libellé seul (cf. consigne) : la
 * correspondance combine TOUJOURS libellé + enfant + absence de paiement.
 * Un ChargePlan orphelin portant le moindre Payment n'est JAMAIS touché,
 * quel que soit le libellé — l'historique financier réel prime toujours.
 *
 * Toujours en DRY-RUN par défaut (aucune écriture) : affiche la liste des
 * candidats pour relecture humaine avant toute suppression. Ajouter --apply
 * pour supprimer réellement les candidats retenus (ChargePlan.delete,
 * cascade Prisma sur leurs Deadline — aucune n'a de Payment par construction
 * du filtre ci-dessus).
 *
 * Usage (contre la base de PROD, depuis un shell qui a DATABASE_URL) :
 *   npx dotenv -e .env -- npx ts-node -r tsconfig-paths/register \
 *     scripts/cleanup-orphaned-charge-plans.ts --childFirstName=Dina
 *   # puis, après relecture de la liste imprimée :
 *   npx dotenv -e .env -- npx ts-node -r tsconfig-paths/register \
 *     scripts/cleanup-orphaned-charge-plans.ts --childFirstName=Dina --apply
 *
 * --childId=<uuid> peut être utilisé à la place de --childFirstName pour
 * lever toute ambiguïté si plusieurs enfants partagent le même prénom.
 */
import { PrismaClient } from '@prisma/client';

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, value] = raw.slice(2).split('=');
    args[key] = value ?? true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = args.apply === true || args.apply === 'true';
  const childId = typeof args.childId === 'string' ? args.childId : undefined;
  const childFirstName = typeof args.childFirstName === 'string' ? args.childFirstName : undefined;

  if (!childId && !childFirstName) {
    console.error('Usage: --childId=<uuid> OU --childFirstName=<prénom> requis (optionnellement --apply)');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const child = childId
      ? await prisma.child.findUnique({ where: { id: childId } })
      : await prisma.child.findFirst({ where: { firstName: childFirstName } });

    if (!child) {
      console.error(`Aucun enfant trouvé pour ${childId ? `id=${childId}` : `prénom="${childFirstName}"`}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Enfant ciblé : ${child.firstName} ${child.lastName ?? ''} (id=${child.id}, foyer=${child.householdId})`);

    const linkedChargePlans = await prisma.chargePlan.findMany({
      where: { householdId: child.householdId, children: { some: { childId: child.id } } },
      include: { deadlines: { include: { payments: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const active = linkedChargePlans.filter((cp) => cp.financialPlanId !== null);
    const orphaned = linkedChargePlans.filter((cp) => cp.financialPlanId === null);
    const activeLabels = new Set(active.map((cp) => cp.label));

    const candidates = orphaned.filter((cp) => {
      const hasPayment = cp.deadlines.some((d) => d.payments.length > 0);
      return !hasPayment && activeLabels.has(cp.label);
    });

    console.log(`\n${linkedChargePlans.length} ChargePlan(s) rattaché(s) à ${child.firstName} au total.`);
    console.log(`${active.length} actif(s) (rattaché à un plan), ${orphaned.length} orphelin(s) (financial_plan_id NULL).`);
    console.log(`\n${candidates.length} candidat(s) doublon détecté(s) (orphelin, sans paiement, libellé présent côté actif) :\n`);

    for (const cp of candidates) {
      const dueDates = cp.deadlines.map((d) => d.dueDate.toISOString().slice(0, 10)).join(', ') || '(aucune échéance)';
      console.log(`  - [${cp.id}] "${cp.label}" — créé le ${cp.createdAt.toISOString().slice(0, 10)} — échéances : ${dueDates}`);
    }

    const skippedWithPayment = orphaned.filter((cp) => cp.deadlines.some((d) => d.payments.length > 0));
    if (skippedWithPayment.length > 0) {
      console.log(`\n${skippedWithPayment.length} orphelin(s) IGNORÉ(S) car porteur(s) d'un paiement réel (jamais touché) :`);
      for (const cp of skippedWithPayment) {
        console.log(`  - [${cp.id}] "${cp.label}" — CONSERVÉ (historique réel)`);
      }
    }

    if (candidates.length === 0) {
      console.log('\nRien à nettoyer.');
      return;
    }

    if (!apply) {
      console.log('\nDRY-RUN — aucune suppression effectuée. Relancer avec --apply pour supprimer ces candidats.');
      return;
    }

    console.log('\n--apply : suppression en cours...');
    for (const cp of candidates) {
      await prisma.chargePlan.delete({ where: { id: cp.id } });
      console.log(`  supprimé : [${cp.id}] "${cp.label}"`);
    }
    console.log(`\n${candidates.length} ChargePlan(s) orphelin(s) supprimé(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
