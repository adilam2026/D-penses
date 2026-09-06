import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 11 (§1 refonte UX) — moteur de récurrence commun Revenus + Charges.
 * Chaque scénario utilise un foyer dédié, la date de référence est toujours
 * injectée (`?at=`), jamais l'horloge système (même convention que Lot 7).
 */
describe('Lot 11 — Moteur de récurrence Revenus + Charges (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot11+${run}+${seq}@example.com`, 'password123', 'L11', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot11 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createIncomeSource(
    auth: () => [string, string],
    accountId: string,
    body: { label: string; usualAmount: number; recurrenceRule: string; recurrenceAnchorDate: string },
  ) {
    const res = await http
      .post('/income-sources')
      .set(...auth())
      .send({ ...body, defaultAccountId: accountId, isRecurring: true })
      .expect(201);
    return res.body.id as string;
  }

  async function createAutoChargePlan(auth: () => [string, string], label: string, recurrenceRule: string, startDate: string) {
    const res = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label, generationMode: 'auto_frequence', recurrenceRule, startDate })
      .expect(201);
    return res.body.id as string;
  }

  async function getProjection(auth: () => [string, string], at: string, horizonDays: number) {
    return http.get('/projection').set(...auth()).query({ at, horizon: horizonDays }).expect(200);
  }

  /**
   * Les tables IncomeOccurrence/Deadline sont protégées par RLS (FORCE ROW LEVEL
   * SECURITY) — une requête Prisma "nue" sans app.current_household_id positionné
   * renvoie silencieusement 0 ligne (jamais une erreur), exactement comme un vrai
   * accès inter-foyer refusé. Pour VÉRIFIER l'état réel en base dans ces tests
   * (pas pour contourner l'isolation), on rejoue le même SET LOCAL que
   * RlsContextService.run() dans une transaction dédiée.
   */
  async function inHouseholdContext<T>(householdId: string, fn: (tx: PrismaService) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx as unknown as PrismaService);
    });
  }

  // ---------- TEST 1 : revenu mensuel, ancre jour 26, projection 90 jours ----------
  it('TEST 1 — revenu mensuel jour 26 : 3 occurrences futures visibles en projection 90 jours', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    await createIncomeSource(auth, accountId, {
      label: 'Salaire',
      usualAmount: 29500,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-26',
    });

    const res = await getProjection(auth, '2026-09-01', 90);
    const incomeEvents = res.body.timeline.flatMap((p: { events: { kind: string; amount: number }[] }) => p.events).filter((e: { kind: string }) => e.kind === 'income');
    // 26 sept, 26 oct, 26 nov — au moins 3 occurrences distinctes dans les 90 jours.
    expect(incomeEvents.length).toBeGreaterThanOrEqual(3);
    expect(incomeEvents.every((e: { amount: number }) => e.amount === 29500)).toBe(true);
  });

  // ---------- TEST 2 : jour 31, clampage déterministe ----------
  it('TEST 2 — revenu mensuel jour 31 : clampé au dernier jour de février, jamais un débordement', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const sourceId = await createIncomeSource(auth, accountId, {
      label: 'Loyer perçu',
      usualAmount: 3000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2027-01-31',
    });

    await getProjection(auth, '2027-01-01', 120);
    const occurrences = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.findMany({ where: { incomeSourceId: sourceId }, orderBy: { usualDate: 'asc' } }));
    const dates = occurrences.map((o) => o.usualDate.toISOString().slice(0, 10));
    expect(dates).toContain('2027-01-31');
    expect(dates).toContain('2027-02-28'); // 2027 n'est pas bissextile
    expect(dates).toContain('2027-03-31'); // jamais dérivé depuis le 28 clampé de février
  });

  // ---------- TEST 3 : idempotence ----------
  it('TEST 3 — deux appels consécutifs ne créent aucun doublon', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const sourceId = await createIncomeSource(auth, accountId, {
      label: 'Salaire',
      usualAmount: 10000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-10',
    });

    await getProjection(auth, '2026-09-01', 90);
    const countAfterFirst = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.count({ where: { incomeSourceId: sourceId } }));
    await getProjection(auth, '2026-09-01', 90);
    const countAfterSecond = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.count({ where: { incomeSourceId: sourceId } }));

    expect(countAfterFirst).toBeGreaterThan(0);
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  // ---------- TEST 4 : concurrence ----------
  it('TEST 4 — deux appels simultanés sur le même horizon convergent sans doublon ni erreur', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const sourceId = await createIncomeSource(auth, accountId, {
      label: 'Salaire',
      usualAmount: 8000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-05',
    });

    const [r1, r2] = await Promise.all([getProjection(auth, '2026-09-01', 90), getProjection(auth, '2026-09-01', 90)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    const occurrences = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.findMany({ where: { incomeSourceId: sourceId } }));
    const dates = occurrences.map((o) => o.usualDate.toISOString().slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length); // aucune date en double
  });

  // ---------- TEST 5 : charges auto_frequence, hiérarchie du montant estimé ----------
  it('TEST 5 — charge mensuelle auto_frequence : la référence confirmée la plus récente devient l\'estimation des échéances suivantes', async () => {
    const { auth, householdId } = await newHousehold();
    const chargePlanId = await createAutoChargePlan(auth, 'Internet', 'mensuel', '2026-07-15');

    // Première échéance (celle de l'ancre) confirmée manuellement à 500 DH.
    const firstDeadline = await http
      .post(`/charge-plans/${chargePlanId}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-07-15', amountCurrent: 500, amountStatus: 'confirme' })
      .expect(201);
    expect(firstDeadline.body.dueDate.slice(0, 10)).toBe('2026-07-15');

    await getProjection(auth, '2026-07-01', 90); // génère août/septembre

    const deadlines = await inHouseholdContext(householdId, (tx) => tx.deadline.findMany({ where: { chargePlanId }, orderBy: { dueDate: 'asc' } }));
    const generated = deadlines.filter((d) => d.dueDate.toISOString().slice(0, 10) !== '2026-07-15');
    expect(generated.length).toBeGreaterThanOrEqual(2);
    for (const d of generated) {
      expect(d.amountStatus).toBe('estime');
      expect(Number(d.amountCurrent)).toBe(500); // reprend la référence confirmée, jamais inventé
    }
  });

  it("TEST 5bis — sans aucune échéance de référence existante : amount_status = inconnu, jamais 0", async () => {
    const { auth, householdId } = await newHousehold();
    const chargePlanId = await createAutoChargePlan(auth, 'Assurance', 'annuel', '2026-03-01');
    await getProjection(auth, '2026-01-01', 400);

    const deadlines = await inHouseholdContext(householdId, (tx) => tx.deadline.findMany({ where: { chargePlanId } }));
    expect(deadlines.length).toBeGreaterThanOrEqual(1);
    for (const d of deadlines) {
      expect(d.amountStatus).toBe('inconnu');
      expect(d.amountCurrent).toBeNull();
    }
  });

  // ---------- TEST 6 : aucune date de facturation inventée ----------
  it('TEST 6 — expected_billing_date reste toujours NULL sur les échéances auto-générées', async () => {
    const { auth, householdId } = await newHousehold();
    const chargePlanId = await createAutoChargePlan(auth, 'Téléphone', 'mensuel', '2026-09-05');
    await getProjection(auth, '2026-09-01', 90);

    const deadlines = await inHouseholdContext(householdId, (tx) => tx.deadline.findMany({ where: { chargePlanId } }));
    expect(deadlines.length).toBeGreaterThan(0);
    expect(deadlines.every((d) => d.expectedBillingDate === null)).toBe(true);
  });

  // ---------- TEST 7 : prévu ≠ réel ----------
  it('TEST 7 — la génération automatique ne crée jamais de réel (statuts toujours prévu/ouverte)', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const sourceId = await createIncomeSource(auth, accountId, {
      label: 'Salaire',
      usualAmount: 5000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-20',
    });
    const chargePlanId = await createAutoChargePlan(auth, 'Loyer', 'mensuel', '2026-09-01');

    await getProjection(auth, '2026-09-01', 90);

    const occurrences = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.findMany({ where: { incomeSourceId: sourceId } }));
    expect(occurrences.every((o) => o.status === 'prevu')).toBe(true);
    expect(occurrences.every((o) => o.actualAmount === null && o.actualDate === null)).toBe(true);

    const deadlines = await inHouseholdContext(householdId, (tx) => tx.deadline.findMany({ where: { chargePlanId } }));
    expect(deadlines.every((d) => d.financialStatus === 'ouverte')).toBe(true);
  });

  // ---------- TEST 8 : revenus multiples ----------
  it('TEST 8 — deux sources de revenus mensuelles génèrent chacune leurs occurrences indépendamment', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const salaire1 = await createIncomeSource(auth, accountId, {
      label: 'Salaire 1',
      usualAmount: 29500,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-26',
    });
    const salaire2 = await createIncomeSource(auth, accountId, {
      label: 'Salaire 2',
      usualAmount: 24000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-30',
    });

    await getProjection(auth, '2026-09-01', 90);

    const occ1 = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.count({ where: { incomeSourceId: salaire1 } }));
    const occ2 = await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.count({ where: { incomeSourceId: salaire2 } }));
    expect(occ1).toBeGreaterThanOrEqual(3);
    expect(occ2).toBeGreaterThanOrEqual(3);
  });

  // ---------- TEST 9 : charges multiples, périodicités différentes ----------
  it('TEST 9 — charge mensuelle et charge trimestrielle génèrent selon leur propre périodicité', async () => {
    const { auth, householdId } = await newHousehold();
    const internet = await createAutoChargePlan(auth, 'Internet', 'mensuel', '2026-09-10');
    const assurance = await createAutoChargePlan(auth, 'Assurance auto', 'trimestriel', '2026-09-10');

    await getProjection(auth, '2026-09-01', 200);

    const internetCount = await inHouseholdContext(householdId, (tx) => tx.deadline.count({ where: { chargePlanId: internet } }));
    const assuranceCount = await inHouseholdContext(householdId, (tx) => tx.deadline.count({ where: { chargePlanId: assurance } }));
    expect(internetCount).toBeGreaterThanOrEqual(6); // ~ un par mois sur ~200 jours
    expect(assuranceCount).toBeGreaterThanOrEqual(2);
    expect(assuranceCount).toBeLessThan(internetCount); // trimestriel génère nettement moins que mensuel
  });

  // ---------- TEST 10 : ponctuel ne génère jamais ----------
  it('TEST 10 — recurrenceRule ponctuel (revenu et charge) ne génère jamais automatiquement', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    const sourceId = await createIncomeSource(auth, accountId, {
      label: 'Prime exceptionnelle',
      usualAmount: 2000,
      recurrenceRule: 'ponctuel',
      recurrenceAnchorDate: '2026-09-15',
    });
    const chargePlanId = await createAutoChargePlan(auth, 'Réparation exceptionnelle', 'ponctuel', '2026-09-15');

    await getProjection(auth, '2026-09-01', 200);

    expect(await inHouseholdContext(householdId, (tx) => tx.incomeOccurrence.count({ where: { incomeSourceId: sourceId } }))).toBe(0);
    expect(await inHouseholdContext(householdId, (tx) => tx.deadline.count({ where: { chargePlanId } }))).toBe(0);
  });

  // ---------- TEST 11 : generationMode calendrier_manuel n'est jamais auto-généré ----------
  it('TEST 11 — un ChargePlan calendrier_manuel (mensuel) n\'est jamais auto-généré, contrairement à auto_frequence', async () => {
    const { auth, householdId } = await newHousehold();
    const res = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'École', generationMode: 'calendrier_manuel', recurrenceRule: 'mensuel', startDate: '2026-09-10' })
      .expect(201);
    const chargePlanId = res.body.id as string;

    await getProjection(auth, '2026-09-01', 200);
    expect(await inHouseholdContext(householdId, (tx) => tx.deadline.count({ where: { chargePlanId } }))).toBe(0);
  });

  // ---------- TEST 12 : calendrier voit aussi les occurrences générées ----------
  it('TEST 12 — GET /calendar reflète les occurrences/échéances générées automatiquement', async () => {
    const { auth, householdId } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte courant', 5000);
    await createIncomeSource(auth, accountId, {
      label: 'Salaire',
      usualAmount: 15000,
      recurrenceRule: 'mensuel',
      recurrenceAnchorDate: '2026-09-26',
    });

    const res = await http.get('/calendar').set(...auth()).query({ at: '2026-09-01', to: '2026-11-30' }).expect(200);
    const incomeEvents = res.body.events.filter((e: { kind: string }) => e.kind === 'revenu_prevu');
    expect(incomeEvents.length).toBeGreaterThanOrEqual(3);
  });
});
