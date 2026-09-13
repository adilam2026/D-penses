import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Lot 4 (module Budgets) — historique des modifications + navigation dans les
 * périodes passées. Versionnement par instantané complet (VariableBudgetVersion) :
 * un update() qui change au moins un des 7 champs suivis capture l'état AVANT
 * modification comme segment clos [validFrom, validTo) ; l'état courant reste
 * exclusivement porté par la ligne vivante VariableBudget.
 *
 * Convention temporelle semi-ouverte partout : périodes [periodStart,
 * periodEndExclusive), segments [validFrom, validTo) — une modification pile à
 * la borne de sortie d'une période appartient à la période SUIVANTE (preuve
 * exacte, à l'instant près, dans variable-budget.util.spec.ts — un test HTTP ne
 * peut pas forcer un instant exact, donc TEST 8 ici complète cette preuve avec
 * un scénario réaliste bout-en-bout plutôt que de la dupliquer).
 */
describe('Lot 4 — historique des modifications de budget et navigation de périodes (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  const mailer = new FakeMailer();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const token = await signupVerified(http, mailer, `lot31+${run}+${seq}@example.com`, 'password123', 'L31', 'T');
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer Lot31 ${seq}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createAccount(auth: () => [string, string], initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name: 'Compte', type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  function daysAgoUTC(n: number): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - n));
  }

  // ---------- TEST 1 — une modification crée une entrée d'historique récupérable ----------
  it("TEST 1 — modifier referenceAmount crée une entrée d'historique avec budgetId/champ/ancienne/nouvelle valeur/changedAt=effectiveFrom", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H1');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 2000 }).expect(200);

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    expect(history.body).toHaveLength(1);
    const entry = history.body[0];
    expect(entry.budgetId).toBe(budgetId);
    expect(entry.field).toBe('referenceAmount');
    expect(entry.oldValue).toBe(1000);
    expect(entry.newValue).toBe(2000);
    expect(entry.changedAt).toBeTruthy();
    expect(entry.effectiveFrom).toBe(entry.changedAt); // changedAt = effectiveFrom dans ce lot
  });

  // ---------- TEST 2 — une modification no-op ne crée aucune entrée ----------
  it("TEST 2 — un PATCH avec les mêmes valeurs (ou vide) ne crée aucune entrée d'historique", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H2');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 1000 }).expect(200);
    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({}).expect(200);

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    expect(history.body).toHaveLength(0);
  });

  // ---------- TEST 3 — plusieurs champs modifiés en un seul appel partagent le même changedAt ----------
  it("TEST 3 — modifier 2 champs dans le même PATCH crée 2 entrées d'historique partageant le même changedAt", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H3');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', includeInPrudentProjection: true, startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 1200, includeInPrudentProjection: false }).expect(200);

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    expect(history.body).toHaveLength(2);
    const fields = history.body.map((e: any) => e.field).sort();
    expect(fields).toEqual(['includeInPrudentProjection', 'referenceAmount']);
    expect(history.body[0].changedAt).toBe(history.body[1].changedAt);
  });

  // ---------- TEST 4 — non-rétroactivité : une période déjà close reste protégée après une modification ultérieure ----------
  it("TEST 4 — non-rétroactivité : une modification d'aujourd'hui ne change jamais le plafond déjà calculé pour une période passée close", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation H4');
    const pastDay = daysAgoUTC(30); // largement dans le passé, semaine ET mois différents d'aujourd'hui

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.post('/expenses').set(...h.auth()).send({ amount: 300, accountId, categoryId, spentDate: pastDay.toISOString() }).expect(201);

    const before = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).query({ at: isoDate(pastDay) }).expect(200);
    expect(before.body.status.budgetPeriode).toBe(1000);
    expect(before.body.status.consommeADate).toBe(300);

    // Modification "aujourd'hui" — ne doit jamais changer l'interprétation de la période passée déjà consultée.
    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 5000 }).expect(200);

    const after = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).query({ at: isoDate(pastDay) }).expect(200);
    expect(after.body.status.budgetPeriode).toBe(1000); // toujours l'ancienne valeur, jamais 5000
    expect(after.body.status.consommeADate).toBe(300);

    // La période COURANTE, elle, reflète bien la nouvelle valeur (comportement §14 déjà existant, inchangé).
    const current = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(current.body.status.budgetPeriode).toBe(5000);
  });

  // ---------- TEST 5 — scénario de l'énoncé : 1000 → 1500 → 1800, initial/ajusté + historique complet ----------
  it("TEST 5 — trois modifications successives dans la même période : initialValues=1000, adjustedValues=1800, plafond affiché=1800, historique complet 1000→1500→1800", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H5');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 1500 }).expect(200);
    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 1800 }).expect(200);

    const detail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(detail.body.status.budgetPeriode).toBe(1800); // dernière valeur ajustée, jamais une moyenne
    expect(detail.body.initialValues.referenceAmount).toBe(1000);
    expect(detail.body.adjustedValues.referenceAmount).toBe(1800);

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    const amountChanges = history.body.filter((e: any) => e.field === 'referenceAmount').sort((a: any, b: any) => a.changedAt.localeCompare(b.changedAt));
    expect(amountChanges).toHaveLength(2);
    expect(amountChanges[0]).toMatchObject({ oldValue: 1000, newValue: 1500 });
    expect(amountChanges[1]).toMatchObject({ oldValue: 1500, newValue: 1800 });
  });

  // ---------- TEST 6 — navigation < précédente | période | suivante > ----------
  it('TEST 6 — periodNavigation : isCurrentPeriod/nextPeriodAt cohérents, et previousPeriodAt permet de revenir à une période dont le nextPeriodAt ramène à la période courante', async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H6');
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;

    const current = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(current.body.periodNavigation.isCurrentPeriod).toBe(true);
    expect(current.body.periodNavigation.nextPeriodAt).toBeNull(); // jamais de navigation vers le futur

    const previousAt = current.body.periodNavigation.previousPeriodAt as string;
    const previous = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).query({ at: previousAt }).expect(200);
    expect(previous.body.periodNavigation.isCurrentPeriod).toBe(false);
    expect(previous.body.periodNavigation.nextPeriodAt).toBeTruthy();

    // Revenir en avant depuis la période précédente doit ramener exactement à la période courante.
    const backToCurrent = await http
      .get(`/variable-budgets/${budgetId}`)
      .set(...h.auth())
      .query({ at: previous.body.periodNavigation.nextPeriodAt })
      .expect(200);
    expect(backToCurrent.body.periodNavigation.isCurrentPeriod).toBe(true);
    expect(backToCurrent.body.status.periodStart).toBe(current.body.status.periodStart);
  });

  // ---------- TEST 7 — cas limite §5 : modification avant la startDate du budget ----------
  it("TEST 7 — un budget modifié AVANT sa startDate (future) ne crée jamais de segment invalide et reste consultable sans erreur", async () => {
    const h = await newHousehold();
    const categoryId = await createCategory(h.auth, 'Alimentation H7');
    const futureStart = isoDate(daysAgoUTC(-60)); // startDate dans 60 jours
    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'mois', startDate: futureStart })
      .expect(201);
    const budgetId = budget.body.id as string;

    // Modification immédiate, alors que la startDate financière est encore loin dans le futur —
    // validFrom du segment doit être budget.createdAt (maintenant), jamais startDate (plus tard),
    // qui produirait un intervalle inversé (validFrom > validTo).
    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 2000 }).expect(200);

    const history = await http.get(`/variable-budgets/${budgetId}/history`).set(...h.auth()).expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ oldValue: 1000, newValue: 2000 });

    const detail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(detail.body.status.budgetPeriode).toBe(0); // fenêtre vide, budget pas encore démarré — jamais un crash
  });

  // ---------- TEST 8 — scénario bout-en-bout proche de la frontière (complète la preuve exacte unitaire) ----------
  it('TEST 8 — une dépense de la semaine passée et une modification du jour restent chacune dans leur période respective (aucun mélange)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 20000);
    const categoryId = await createCategory(h.auth, 'Alimentation H8');
    const lastWeek = daysAgoUTC(10);

    const budget = await http
      .post('/variable-budgets')
      .set(...h.auth())
      .send({ categoryId, referenceAmount: 1000, referencePeriod: 'semaine', startDate: '2020-01-01' })
      .expect(201);
    const budgetId = budget.body.id as string;
    await http.post('/expenses').set(...h.auth()).send({ amount: 200, accountId, categoryId, spentDate: lastWeek.toISOString() }).expect(201);

    await http.patch(`/variable-budgets/${budgetId}`).set(...h.auth()).send({ referenceAmount: 3000 }).expect(200);

    const lastWeekDetail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).query({ at: isoDate(lastWeek) }).expect(200);
    expect(lastWeekDetail.body.status.budgetPeriode).toBe(1000);
    expect(lastWeekDetail.body.status.consommeADate).toBe(200);
    expect(lastWeekDetail.body.periodNavigation.isCurrentPeriod).toBe(false);

    const currentDetail = await http.get(`/variable-budgets/${budgetId}`).set(...h.auth()).expect(200);
    expect(currentDetail.body.status.budgetPeriode).toBe(3000);
    expect(currentDetail.body.status.consommeADate).toBe(0); // la dépense de la semaine passée n'apparaît jamais dans la période courante
  });
});
