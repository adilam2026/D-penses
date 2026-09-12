import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Sécurité S0 (audit isolation §3, verrouillé) — régression permanente : le
 * foyer B ne doit jamais pouvoir créer/modifier une ressource de SON foyer en
 * lui rattachant un ID (accountId, categoryId, financialPlanId, childId,
 * deadlineId, provisionId, defaultAccountId, linkedAccountId...) appartenant
 * au foyer A. Complète lot9-atomicity-rls.e2e-spec.ts (qui teste l'accès
 * direct par ID) avec l'attaque par SUBSTITUTION d'ID dans une relation.
 *
 * `categoryId` sur ChargePlan.create() n'était pas vérifié avant ce lot —
 * cf. charge-plans.service.ts (corrigé) : c'est le seul cas où ce fichier a
 * trouvé une faille réelle parmi les 9 relations testées.
 */
describe('Sécurité — isolation inter-foyers par substitution d\'ID (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  const mailer = new FakeMailer();

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold(suffix: string) {
    const token = await signupVerified(http, mailer, `sec+${suffix}+${run}@example.com`, 'password123', 'Sec', suffix);
    const household = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${suffix}` }).expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it('accountId étranger : expense refusée', async () => {
    const a = await newHousehold('acc-a');
    const accountA = (await http.post('/accounts').set(...a.auth()).send({ name: 'Compte A', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const b = await newHousehold('acc-b');
    const res = await http.post('/expenses').set(...b.auth()).send({ amount: 50, accountId: accountA });
    expect([400, 404]).toContain(res.status);
  });

  it('fromAccountId/toAccountId étrangers : transfert refusé', async () => {
    const a = await newHousehold('tr-a');
    const accountA = (await http.post('/accounts').set(...a.auth()).send({ name: 'Compte A', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const b = await newHousehold('tr-b');
    const accountB = (await http.post('/accounts').set(...b.auth()).send({ name: 'Compte B', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const res = await http.post('/accounts/transfers').set(...b.auth()).send({ fromAccountId: accountB, toAccountId: accountA, amount: 100 });
    expect([400, 404]).toContain(res.status);
  });

  it('categoryId étranger (catégorie privée d\'un autre foyer) : charge-plan refusé — correctif S0', async () => {
    const a = await newHousehold('cat-a');
    const categoryA = (await http.post('/categories').set(...a.auth()).send({ name: 'CatA privée', kind: 'expense' }).expect(201)).body.id;
    const b = await newHousehold('cat-b');
    const res = await http.post('/charge-plans').set(...b.auth()).send({ label: 'Test', categoryId: categoryA, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' });
    expect([400, 404]).toContain(res.status);
  });

  it('categoryId propre au foyer : le correctif n\'empêche pas l\'usage normal (non-régression)', async () => {
    const a = await newHousehold('cat-own-a');
    const categoryA = (await http.post('/categories').set(...a.auth()).send({ name: 'Catégorie A', kind: 'expense' }).expect(201)).body.id;
    const res = await http
      .post('/charge-plans')
      .set(...a.auth())
      .send({ label: 'Charge normale', categoryId: categoryA, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' });
    expect(res.status).toBe(201);
  });

  it('financialPlanId étranger : charge-plan ne peut pas s\'y rattacher', async () => {
    const a = await newHousehold('plan-a');
    const planA = (await http.post('/financial-plans').set(...a.auth()).send({ label: 'Plan A', periodStart: '2026-09-01', periodEnd: '2027-07-31' }).expect(201)).body.id;
    const b = await newHousehold('plan-b');
    const res = await http.post('/charge-plans').set(...b.auth()).send({ label: 'Test', startDate: '2026-10-01', financialPlanId: planA, generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' });
    expect([400, 404]).toContain(res.status);
  });

  it('childId étranger : charge-plan ne peut pas rattacher l\'enfant d\'un autre foyer', async () => {
    const a = await newHousehold('child-a');
    const childA = (await http.post('/children').set(...a.auth()).send({ firstName: 'Enfant', lastName: 'A' }).expect(201)).body.id;
    const b = await newHousehold('child-b');
    const res = await http.post('/charge-plans').set(...b.auth()).send({ label: 'Test', startDate: '2026-10-01', childIds: [childA], generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' });
    expect([400, 404]).toContain(res.status);
  });

  it('deadlineId étranger : paiement refusé (l\'échéance n\'appartient pas au foyer)', async () => {
    const a = await newHousehold('dl-a');
    const categoryA = (await http.post('/categories').set(...a.auth()).send({ name: 'CatDlA', kind: 'expense' }).expect(201)).body.id;
    const accountA = (await http.post('/accounts').set(...a.auth()).send({ name: 'Compte DlA', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const planA = (await http.post('/charge-plans').set(...a.auth()).send({ label: 'Charge A', categoryId: categoryA, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' }).expect(201)).body.id;
    const deadlineA = (await http.post(`/charge-plans/${planA}/deadlines`).set(...a.auth()).send({ dueDate: '2026-10-15', amountCurrent: 500, amountStatus: 'confirme' }).expect(201)).body.id;

    const b = await newHousehold('dl-b');
    const accountB = (await http.post('/accounts').set(...b.auth()).send({ name: 'Compte DlB', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const res = await http.post(`/deadlines/${deadlineA}/payments`).set(...b.auth()).send({ amount: 500, accountId: accountB });
    expect([400, 404]).toContain(res.status);
  });

  it('provisionId étranger : paiement par enveloppe refusé', async () => {
    const a = await newHousehold('prov-a');
    const provisionA = (await http.post('/provisions').set(...a.auth()).send({ name: 'Provision A', allocationMode: 'virtual_allocation' }).expect(201)).body.id;

    const b = await newHousehold('prov-b');
    const categoryB = (await http.post('/categories').set(...b.auth()).send({ name: 'CatProvB', kind: 'expense' }).expect(201)).body.id;
    const accountB = (await http.post('/accounts').set(...b.auth()).send({ name: 'Compte ProvB', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const planB = (await http.post('/charge-plans').set(...b.auth()).send({ label: 'Charge B', categoryId: categoryB, startDate: '2026-10-01', generationMode: 'calendrier_manuel', obligationStatus: 'obligatoire' }).expect(201)).body.id;
    const deadlineB = (await http.post(`/charge-plans/${planB}/deadlines`).set(...b.auth()).send({ dueDate: '2026-10-15', amountCurrent: 500, amountStatus: 'confirme' }).expect(201)).body.id;

    const res = await http.post(`/deadlines/${deadlineB}/payments`).set(...b.auth()).send({ amount: 500, accountId: accountB, fundingSource: 'provision', provisionId: provisionA });
    expect([400, 404]).toContain(res.status);
  });

  it('defaultAccountId étranger : source de revenu refusée', async () => {
    const a = await newHousehold('inc-a');
    const accountA = (await http.post('/accounts').set(...a.auth()).send({ name: 'Compte IncA', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const b = await newHousehold('inc-b');
    const res = await http.post('/income-sources').set(...b.auth()).send({ label: 'Salaire', usualAmount: 8000, defaultAccountId: accountA });
    expect([400, 404]).toContain(res.status);
  });

  it('linkedAccountId étranger : pocket refusé', async () => {
    const a = await newHousehold('pkt-a');
    const accountA = (await http.post('/accounts').set(...a.auth()).send({ name: 'Compte PktA', type: 'courant', initialBalance: 1000 }).expect(201)).body.id;
    const b = await newHousehold('pkt-b');
    const res = await http.post('/pockets').set(...b.auth()).send({ name: 'Poche B', allocationMode: 'backed_by_account', linkedAccountId: accountA });
    expect([400, 404]).toContain(res.status);
  });
});
