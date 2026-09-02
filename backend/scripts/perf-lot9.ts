/* eslint-disable no-console */
/**
 * Lot 9 (§26 — mesure de performance) : construit un jeu de données réaliste à
 * échelle (2 adultes, 2 enfants, 5 comptes, 24 mois de revenus, 300+ transactions,
 * 30+ Deadlines, 10+ budgets variables, 5+ poches/provisions, 3+ Goals) puis
 * MESURE les temps de réponse réels de GET /dashboard/summary, GET
 * /projection?horizon=90, POST /simulation/purchase et POST
 * /simulation/savings-capacity — jamais une estimation, toujours un chronométrage.
 *
 * Aucune règle métier nouvelle : le volume est construit pour l'essentiel via
 * des insertions Prisma directes en masse (createMany), volontairement hors du
 * chemin de validation métier normal — l'objectif ici est la charge de requête
 * (donc l'efficacité des index, cf. §27) et non la recette fonctionnelle (déjà
 * couverte par test/lot9-recette.e2e-spec.ts). Exécuter avec :
 *   npx dotenv -e .env -- npx ts-node -r tsconfig-paths/register scripts/perf-lot9.ts
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { performance } from 'node:perf_hooks';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { RlsContextService } from '../src/common/prisma/rls-context.service';

const TARGETS_MS = {
  dashboard: 500,
  projection90: 1000,
  simulationPurchase: 1000,
  simulationSavingsCapacity: 1000,
};

function mean(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { ms: performance.now() - start, result };
}

async function measureRepeated(label: string, runs: number, warmup: number, fn: () => Promise<unknown>) {
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const { ms } = await time(fn);
    samples.push(ms);
  }
  return { label, samples, min: Math.min(...samples), p50: percentile(samples, 50), p95: percentile(samples, 95), max: Math.max(...samples), mean: mean(samples) };
}

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  const http = request(app.getHttpServer());
  const prisma = app.get(PrismaService);
  const rlsContext = app.get(RlsContextService);

  const run = Date.now();
  console.log('=== Lot 9 — Jeu de données de performance : construction ===');

  // ---------- Squelette réaliste via l'API (mêmes règles que la production) ----------
  const signup1 = await http.post('/auth/signup').send({ email: `perf9a+${run}@example.com`, password: 'password123', firstName: 'Perf', lastName: 'A' }).expect(201);
  const householdRes = await http.post('/households').set('Authorization', `Bearer ${signup1.body.accessToken}`).send({ name: 'Foyer Perf Lot9' }).expect(201);
  const householdId = householdRes.body.household.id as string;
  let accessToken = householdRes.body.accessToken as string;
  const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];

  const userId1 = JSON.parse(Buffer.from((signup1.body.accessToken as string).split('.')[1], 'base64').toString('utf8')).sub as string;

  const invite = await http.post('/households/invites').set(...auth()).send({ role: 'admin' }).expect(201);
  const signup2 = await http.post('/auth/signup').send({ email: `perf9b+${run}@example.com`, password: 'password123', firstName: 'Perf', lastName: 'B' }).expect(201);
  await http.post('/households/join').set('Authorization', `Bearer ${signup2.body.accessToken}`).send({ code: invite.body.code }).expect(201);

  const child1 = (await http.post('/children').set(...auth()).send({ firstName: 'Enfant1', lastName: 'Perf' }).expect(201)).body.id as string;
  const child2 = (await http.post('/children').set(...auth()).send({ firstName: 'Enfant2', lastName: 'Perf' }).expect(201)).body.id as string;

  const accountIds: string[] = [];
  for (const [name, type, balance] of [
    ['Compte courant', 'courant', 60000],
    ['Espèces', 'especes', 2000],
    ['Épargne famille', 'epargne', 40000],
    ['Épargne Enfant1', 'epargne', 5000],
    ['Épargne Enfant2', 'epargne', 3000],
  ] as const) {
    accountIds.push((await http.post('/accounts').set(...auth()).send({ name, type, initialBalance: balance }).expect(201)).body.id as string);
  }
  const [mainAccountId] = accountIds;

  const categoryIds: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    categoryIds.push((await http.post('/categories').set(...auth()).send({ name: `Catégorie perf ${i}`, kind: 'expense' }).expect(201)).body.id as string);
  }

  const budgetIds: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const res = await http.post('/variable-budgets').set(...auth()).send({
      categoryId: categoryIds[i % categoryIds.length], referenceAmount: 1000 + i * 50, referencePeriod: 'mois', startDate: '2025-01-01',
    }).expect(201);
    budgetIds.push(res.body.id as string);
  }

  console.log('Squelette créé (2 adultes, 2 enfants, 5 comptes, 10 catégories, 12 budgets). Insertion en masse du volume...');

  // ---------- Volume à l'échelle : insertions Prisma directes en masse (§26) ----------
  await rlsContext.run(userId1, householdId, async () => {
    const tx = rlsContext.getClient();

    // 24 mois de revenus (source unique, occurrences mensuelles, moitié confirmées).
    const source = await tx.incomeSource.create({
      data: { householdId, label: 'Salaire', usualAmount: 14000, defaultAccountId: mainAccountId },
    });
    const incomeRows = [];
    for (let m = 0; m < 24; m += 1) {
      const date = new Date(Date.UTC(2025, m, 28));
      const confirmed = date.getTime() < Date.now();
      incomeRows.push({
        incomeSourceId: source.id,
        usualDate: date,
        plannedAmount: 14000,
        accountId: mainAccountId,
        status: confirmed ? ('recu' as const) : ('prevu' as const),
        actualAmount: confirmed ? 14000 : null,
        actualDate: confirmed ? date : null,
      });
    }
    await tx.incomeOccurrence.createMany({ data: incomeRows });

    // 30+ Deadlines réparties sur 10 ChargePlan.
    const userRow = await tx.user.findFirstOrThrow({ where: { email: `perf9a+${run}@example.com` } });
    const chargePlans = [];
    for (let i = 0; i < 10; i += 1) {
      chargePlans.push(
        await tx.chargePlan.create({
          data: { householdId, label: `Charge récurrente ${i}`, generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire', startDate: new Date('2025-01-01') },
        }),
      );
    }
    const deadlineRows = [];
    for (let i = 0; i < 36; i += 1) {
      const cp = chargePlans[i % chargePlans.length];
      const due = new Date(Date.UTC(2025, i % 24, 15));
      deadlineRows.push({
        chargePlanId: cp.id,
        dueDate: due,
        amountCurrent: 500 + (i % 12) * 100,
        amountStatus: 'confirme' as const,
      });
    }
    await tx.deadline.createMany({ data: deadlineRows });

    // 300+ transactions réelles : mélange AdHocExpense / BudgetExpense sur 24 mois.
    const adhocRows = [];
    const budgetExpenseRows = [];
    for (let i = 0; i < 320; i += 1) {
      const date = new Date(Date.UTC(2025, i % 24, 1 + (i % 27)));
      const accountId = accountIds[i % accountIds.length];
      const categoryId = categoryIds[i % categoryIds.length];
      if (i % 3 === 0) {
        budgetExpenseRows.push({
          variableBudgetId: budgetIds[i % budgetIds.length],
          amount: 50 + (i % 40) * 10,
          spentDate: date,
          categoryId,
          accountId,
          recordedById: userRow.id,
        });
      } else {
        adhocRows.push({
          householdId,
          amount: 50 + (i % 40) * 10,
          spentDate: date,
          categoryId,
          accountId,
          recordedById: userRow.id,
        });
      }
    }
    await tx.adHocExpense.createMany({ data: adhocRows });
    await tx.budgetExpense.createMany({ data: budgetExpenseRows });

    // 5+ poches/provisions avec quelques mouvements chacune.
    const pockets = [];
    for (let i = 0; i < 6; i += 1) {
      pockets.push(
        await tx.savingsPocket.create({
          data: { householdId, name: `Poche perf ${i}`, allocationMode: 'virtual_allocation' },
        }),
      );
    }
    const movementRows = [];
    for (const pocket of pockets) {
      for (let i = 0; i < 4; i += 1) {
        const date = new Date(Date.UTC(2025, i * 3, 10));
        movementRows.push({
          pocketType: 'savings_pocket' as const,
          savingsPocketId: pocket.id,
          plannedDate: date,
          plannedAmount: 500,
          actualDate: date,
          actualAmount: 500,
          status: 'confirme' as const,
          movementType: 'contribution' as const,
          recordedByUserId: userRow.id,
        });
      }
    }
    await tx.pocketMovement.createMany({ data: movementRows });

    // 3+ Goals avec contributions.
    for (let i = 0; i < 4; i += 1) {
      const goal = await tx.goal.create({ data: { householdId, label: `Objectif perf ${i}`, targetAmount: 10000 + i * 5000 } });
      await tx.goalContribution.createMany({
        data: [0, 1, 2].map((k) => ({
          goalId: goal.id,
          plannedDate: new Date(Date.UTC(2025, k * 4, 5)),
          plannedAmount: 1000,
          actualDate: new Date(Date.UTC(2025, k * 4, 5)),
          actualAmount: 1000,
          status: 'confirme' as const,
          recordedByUserId: userRow.id,
        })),
      });
    }
  });

  // Comptage SCOPÉ à ce foyer, dans le contexte RLS (§29/Lot 8 : un comptage Prisma direct
  // hors contexte RLS renvoie toujours 0 sous FORCE ROW LEVEL SECURITY — une fausse preuve).
  const counts = await rlsContext.run(userId1, householdId, async () => {
    const tx = rlsContext.getClient();
    return Promise.all([
      tx.incomeOccurrence.count({ where: { incomeSource: { householdId } } }),
      tx.deadline.count({ where: { chargePlan: { householdId } } }),
      tx.adHocExpense.count({ where: { householdId } }),
      tx.budgetExpense.count({ where: { variableBudget: { householdId } } }),
      tx.pocketMovement.count({ where: { savingsPocket: { householdId } } }),
      tx.goalContribution.count({ where: { goal: { householdId } } }),
    ]);
  });
  console.log(
    `Volume inséré pour ce foyer — income_occurrence=${counts[0]}, deadline=${counts[1]}, adhoc_expense=${counts[2]}, budget_expense=${counts[3]}, pocket_movement=${counts[4]}, goal_contribution=${counts[5]}`,
  );

  console.log('\n=== Mesures (5 exécutions après 2 échauffements, requêtes réelles via supertest) ===\n');

  const results = [];
  results.push(
    await measureRepeated('GET /dashboard/summary', 5, 2, () => http.get('/dashboard/summary').set(...auth()).query({ at: '2026-09-01' }).expect(200)),
  );
  results.push(
    await measureRepeated('GET /projection?horizon=90', 5, 2, () => http.get('/projection').set(...auth()).query({ at: '2026-09-01', horizon: 90 }).expect(200)),
  );
  results.push(
    await measureRepeated('POST /simulation/purchase', 5, 2, () =>
      http.post('/simulation/purchase').set(...auth()).query({ at: '2026-09-01' }).send({ amount: 2000, date: '2026-09-01', accountId: mainAccountId, horizonDays: 90 }).expect(201),
    ),
  );
  results.push(
    await measureRepeated('POST /simulation/savings-capacity', 5, 2, () =>
      http.post('/simulation/savings-capacity').set(...auth()).query({ at: '2026-09-01' }).send({ horizonDays: 90 }).expect(201),
    ),
  );

  const targetsByLabel: Record<string, number> = {
    'GET /dashboard/summary': TARGETS_MS.dashboard,
    'GET /projection?horizon=90': TARGETS_MS.projection90,
    'POST /simulation/purchase': TARGETS_MS.simulationPurchase,
    'POST /simulation/savings-capacity': TARGETS_MS.simulationSavingsCapacity,
  };

  console.log('| Endpoint | min | p50 | p95 | max | Objectif recette | Verdict |');
  console.log('|---|---|---|---|---|---|---|');
  let allPass = true;
  for (const r of results) {
    const target = targetsByLabel[r.label];
    const pass = r.p95 <= target;
    allPass = allPass && pass;
    console.log(
      `| ${r.label} | ${r.min.toFixed(1)}ms | ${r.p50.toFixed(1)}ms | ${r.p95.toFixed(1)}ms | ${r.max.toFixed(1)}ms | <${target}ms (p95) | ${pass ? 'OK' : 'DÉPASSÉ'} |`,
    );
  }
  console.log(`\nVerdict global performance : ${allPass ? 'TOUS LES OBJECTIFS RECETTE ATTEINTS' : 'AU MOINS UN OBJECTIF DÉPASSÉ — voir ci-dessus'}`);

  await app.close();
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
