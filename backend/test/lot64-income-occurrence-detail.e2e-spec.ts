import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Correction UX (Calendrier — occurrence de revenu) — GET /income-occurrences/:id
 * expose la fiche d'UNE occurrence précise (jamais la source récurrente
 * entière) : incomeSource.label additif (même requête), pour que l'écran
 * mobile affiche le libellé sans dupliquer la source. RLS/isolation
 * identiques au reste du module (findFirst scopé au householdId via
 * incomeSource.householdId, même garde-fou que unconfirmOccurrence).
 */
describe('Correction UX — GET /income-occurrences/:id expose la fiche d\'une occurrence (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold(name: string) {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot64+${run}+${seq}@example.com`, 'password123', 'L64', name);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot64 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it("retourne l'occurrence avec le libellé de sa source (incomeSource.label), sans les champs de gestion de la source", async () => {
    const { auth } = await newHousehold('A');
    const account = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 1000 }).expect(201);
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Salaire Adil', usualAmount: 46700, defaultAccountId: account.body.id, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-26' })
      .expect(201);
    await http.get('/dashboard/summary').set(...auth()).expect(200);
    const occurrences = await http.get(`/income-sources/${source.body.id}/occurrences`).set(...auth()).expect(200);
    const occurrenceId = occurrences.body[0].id;

    const detail = await http.get(`/income-occurrences/${occurrenceId}`).set(...auth()).expect(200);

    expect(detail.body.id).toBe(occurrenceId);
    expect(detail.body.status).toBe('prevu');
    expect(Number(detail.body.plannedAmount)).toBe(46700);
    expect(detail.body.incomeSource.label).toBe('Salaire Adil');
    // Additif uniquement — jamais les champs de gestion de la source complète.
    expect(detail.body.incomeSource).not.toHaveProperty('recurrenceRule');
    expect(detail.body.incomeSource).not.toHaveProperty('usualAmount');
  });

  it('404 sur une occurrence introuvable, 404 (jamais 200 silencieux) pour une occurrence d\'un AUTRE foyer (isolation RLS)', async () => {
    const { auth: authA } = await newHousehold('A2');
    const { auth: authB } = await newHousehold('B2');
    const account = await http.post('/accounts').set(...authA()).send({ name: 'BP', type: 'courant', initialBalance: 1000 }).expect(201);
    const source = await http
      .post('/income-sources')
      .set(...authA())
      .send({ label: 'Salaire A', usualAmount: 1000, defaultAccountId: account.body.id, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-01' })
      .expect(201);
    await http.get('/dashboard/summary').set(...authA()).expect(200);
    const occurrences = await http.get(`/income-sources/${source.body.id}/occurrences`).set(...authA()).expect(200);
    const occurrenceId = occurrences.body[0].id;

    await http.get(`/income-occurrences/${occurrenceId}`).set(...authB()).expect(404);
    await http.get('/income-occurrences/00000000-0000-0000-0000-000000000000').set(...authA()).expect(404);
  });

  it("après confirmation (Reçu), la fiche reflète le statut 'recu' et les valeurs réelles", async () => {
    const { auth } = await newHousehold('C');
    const account = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 1000 }).expect(201);
    const source = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Freelance', usualAmount: 3000, defaultAccountId: account.body.id, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-10' })
      .expect(201);
    await http.get('/dashboard/summary').set(...auth()).expect(200);
    const occurrences = await http.get(`/income-sources/${source.body.id}/occurrences`).set(...auth()).expect(200);
    const occurrenceId = occurrences.body[0].id;

    await http
      .post(`/income-occurrences/${occurrenceId}/confirm`)
      .set(...auth())
      .send({ actualAmount: 3200, accountId: account.body.id })
      .expect(201);

    const detail = await http.get(`/income-occurrences/${occurrenceId}`).set(...auth()).expect(200);
    expect(detail.body.status).toBe('recu');
    expect(Number(detail.body.actualAmount)).toBe(3200);
    expect(detail.body.accountId).toBe(account.body.id);
  });
});
