import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * M5 — RecurringTransfer.endDate (bornage facultatif, jamais de génération
 * infinie en base) + visibilité des transferts planifiés / revenus prévus
 * dans le Calendrier, avec cible de clic exploitable côté mobile.
 * M6 — aucun test dédié ici : createdByUserId/createdByName sont déjà
 * couverts par le Lot T1 (lot33-transactions-t1-filters), User.color n'a
 * pas de règle métier propre (pure donnée d'affichage, cf. rapport M5/M6).
 */
describe('Lot 41 — M5 endDate transfert récurrent + Calendrier (e2e)', () => {
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

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot41+${run}+${seq}@example.com`, 'password123', 'L41', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer M5M6 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], name: string) {
    const res = await http
      .post('/accounts')
      .set(...auth())
      .send({ name, type: 'courant', initialBalance: 5000, includeInOperationalTreasury: true })
      .expect(201);
    return res.body.id as string;
  }

  it('A. sans endDate, la génération va jusqu\'à l\'horizon demandé (comportement historique inchangé)', async () => {
    const { auth } = await newHousehold();
    const source = await newAccount(auth, 'Courant A');
    const dest = await newAccount(auth, 'Épargne A');

    const rt = await http
      .post('/recurring-transfers')
      .set(...auth())
      .send({ label: 'A', fromAccountId: source, toAccountId: dest, amount: 500, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
      .expect(201);
    expect(rt.body.endDate).toBeNull();

    // Horizon large explicite (même mécanisme que le Calendrier) pour forcer la génération
    // au-delà du repli DASHBOARD_FALLBACK_HORIZON_DAYS (30 jours, insuffisant pour 2 mensualités).
    await http.get('/calendar?to=2026-12-31').set(...auth()).expect(200);
    const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
    const generated = occurrences.body.filter((t: any) => t.recurringTransferId === rt.body.id);
    expect(generated.length).toBeGreaterThanOrEqual(2);
  });

  it('B. avec endDate, aucune occurrence générée au-delà — jamais une génération infinie en base', async () => {
    const { auth } = await newHousehold();
    const source = await newAccount(auth, 'Courant B');
    const dest = await newAccount(auth, 'Épargne B');

    const rt = await http
      .post('/recurring-transfers')
      .set(...auth())
      .send({
        label: 'B',
        fromAccountId: source,
        toAccountId: dest,
        amount: 500,
        recurrenceRule: 'mensuel',
        recurrenceAnchorDate: '2026-09-28',
        endDate: '2026-11-01',
      })
      .expect(201);
    expect(rt.body.endDate).toBe('2026-11-01T00:00:00.000Z');

    await http.get('/recurring-transfers').set(...auth()).expect(200);
    const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
    const generated = occurrences.body.filter((t: any) => t.recurringTransferId === rt.body.id);
    // Seule l'occurrence du 2026-09-28 est <= endDate (2026-11-01) ; la suivante (2026-10-28)
    // resterait éligible mais 2026-11-28 ne doit jamais apparaître.
    expect(generated.every((t: any) => new Date(t.plannedDate).getTime() <= new Date('2026-11-01').getTime())).toBe(true);
    expect(generated.some((t: any) => new Date(t.plannedDate).toISOString().slice(0, 10) === '2026-11-28')).toBe(false);
  });

  it("C. réduire endDate sur une récurrence existante retire les occurrences 'prevu' au-delà (régénération paresseuse)", async () => {
    const { auth } = await newHousehold();
    const source = await newAccount(auth, 'Courant C');
    const dest = await newAccount(auth, 'Épargne C');

    const rt = await http
      .post('/recurring-transfers')
      .set(...auth())
      .send({ label: 'C', fromAccountId: source, toAccountId: dest, amount: 500, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
      .expect(201);
    await http.get('/calendar?to=2026-12-31').set(...auth()).expect(200);
    const before = await http.get('/accounts/transfers').set(...auth()).expect(200);
    expect(before.body.filter((t: any) => t.recurringTransferId === rt.body.id).length).toBeGreaterThanOrEqual(2);

    await http.patch(`/recurring-transfers/${rt.body.id}`).set(...auth()).send({ endDate: '2026-10-01' }).expect(200);
    await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200); // régénération paresseuse

    const after = await http.get('/accounts/transfers').set(...auth()).expect(200);
    const generated = after.body.filter((t: any) => t.recurringTransferId === rt.body.id);
    expect(generated.every((t: any) => new Date(t.plannedDate).getTime() <= new Date('2026-10-01').getTime())).toBe(true);
  });

  it('D. Calendrier expose les transferts planifiés (kind=transfert_prevu, recurringTransferId) et le revenu prévu avec incomeSourceId', async () => {
    const { auth } = await newHousehold();
    const source = await newAccount(auth, 'Courant D');
    const dest = await newAccount(auth, 'Épargne D');
    const rt = await http
      .post('/recurring-transfers')
      .set(...auth())
      .send({ label: 'D', fromAccountId: source, toAccountId: dest, amount: 500, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
      .expect(201);

    const income = await http
      .post('/income-sources')
      .set(...auth())
      .send({ label: 'Salaire D', usualAmount: 8000, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-15', defaultAccountId: source })
      .expect(201);

    const calendar = await http.get('/calendar?to=2026-12-31').set(...auth()).expect(200);
    const transferEvent = calendar.body.events.find((e: any) => e.kind === 'transfert_prevu' && e.recurringTransferId === rt.body.id);
    expect(transferEvent).toBeDefined();
    expect(transferEvent.amount).toBe(500);

    const incomeEvent = calendar.body.events.find((e: any) => e.kind === 'revenu_prevu' && e.incomeSourceId === income.body.id);
    expect(incomeEvent).toBeDefined();
  });
});
