/**
 * Reprise des occurrences récurrentes — SIMULATION UNIQUEMENT.
 *
 *   npx ts-node src/scripts/recurrence-reprise-simulation.ts --household=<id> [--household=<id>…] [--json]
 *
 * Lit la base pointée par DATABASE_URL dans une transaction READ ONLY et
 * affiche le rapport (aucune écriture possible, aucune option d'application
 * réelle). Le contexte RLS est positionné foyer par foyer : il faut donc
 * fournir explicitement les foyers à analyser.
 */
import { PrismaClient } from '@prisma/client';
import { simulateRecurrenceReprise } from '../common/ledger/recurrence-reprise.util';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a.startsWith('--apply'))) {
    console.error("Refusé : cet outil ne fait que des simulations. Aucune reprise réelle n'est implémentée.");
    process.exit(2);
  }
  const householdIds = args.filter((a) => a.startsWith('--household=')).map((a) => a.slice('--household='.length));
  if (householdIds.length === 0) {
    console.error('Usage : --household=<id> (répétable) [--json]');
    process.exit(2);
  }
  const prisma = new PrismaClient();
  try {
    const report = await simulateRecurrenceReprise(prisma, householdIds);
    if (args.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    const t = report.totals;
    console.log(`SIMULATION (aucune écriture) — aujourd'hui ${report.today}`);
    console.log(`Règles : ${t.rules} (actives ${t.activeRules}, ancrées un 29/30/31 : ${t.rulesAnchoredOn29To31})`);
    console.log(`Occurrences rattachées : ${t.occurrences} (dont règles 29/30/31 : ${t.occurrencesOfRules29To31})`);
    console.log(`Par catégorie : ${JSON.stringify(t.byCategory)}`);
    console.log(`À recaler : ${t.toRecale} · dates différentes de la nouvelle règle : ${t.datesDiffering} · conflits : ${t.conflicts}`);
    for (const rule of report.rules) {
      console.log(`\nRègle ${rule.ruleId.slice(0, 8)} ${rule.frequency} ancre ${rule.anchorDate} (jour ${rule.anchorDay}) ${rule.active ? 'active' : 'inactive'} v${rule.seriesVersion}`);
      for (const row of rule.rows) {
        console.log(`  ${row.currentDate} n°${row.occurrenceIndex ?? '-'} ${row.status} ${row.category} → ${row.action}${row.action === 'NUMEROTER_ET_RECALER' ? ` (${row.dateAfter})` : ''}`);
      }
      for (const c of rule.conflicts) console.log(`  CONFLIT : ${c}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
