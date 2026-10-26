import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * À faire au-delà de 12 mois : GET /todo?monthsOffset=N matérialise les
 * occurrences récurrentes du seul mois consulté, avec exactement le même
 * mécanisme que le Planning (ensureOccurrencesForPeriod), sans dépendre
 * d'une consultation préalable du Planning.
 */
describe('Finance Maison — À faire : récurrences au-delà de 12 mois, sans dépendance au Planning', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  function shift(n: number): string {
    const now = new Date();
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const day = (n: number) => `${shift(n)}-10`;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Foyer avec "Internet" mensuel de 350 DH (dans À faire), sans fin, à partir du 10 du mois prochain. */
  async function withMonthlyInternet() {
    counter += 1;
    const signup = await signupVerified(http, mailer, `todo-far-${counter}-${Date.now()}@test.local`, 'Password123!', 'Test', `User${counter}`);
    const token = (await http.post('/households').set(auth(signup)).send({ name: `Foyer ${counter}` }).expect(201)).body.accessToken as string;
    const compte = (await http.post('/accounts').set(auth(token)).send({ name: 'CIH', openingBalance: '1000' }).expect(201)).body;
    const rule = (
      await http
        .post('/recurrence-rules')
        .set(auth(token))
        .send({ frequency: 'MONTHLY', anchorDate: day(1), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: compte.id, includeInTodo: true })
        .expect(201)
    ).body;
    return { token, rule };
  }

  async function todo(token: string, offset: number) {
    return (await http.get(`/todo?monthsOffset=${offset}`).set(auth(token)).expect(200)).body;
  }

  async function stored(token: string, date: string) {
    const all = (await http.get('/planned-operations').set(auth(token)).expect(200)).body as any[];
    return all.filter((p) => p.label === 'Internet' && p.expectedDate.slice(0, 10) === date);
  }

  const internet = (t: any) => t.pending.find((a: any) => a.label === 'Internet');

  it('1/2. accès direct à +20 mois sans jamais ouvrir le Planning : récurrence présente, mois intermédiaires non écrits', async () => {
    const { token } = await withMonthlyInternet();
    const t = await todo(token, 20);
    expect(t.month).toBe(shift(20));
    expect(internet(t)).toEqual(expect.objectContaining({ expectedAmount: 350, remaining: 350, status: 'PENDING' }));
    expect(internet(t).expectedDate.slice(0, 10)).toBe(day(20));
    expect(await stored(token, day(20))).toHaveLength(1);
    for (const n of [16, 17, 18, 19]) expect(await stored(token, day(n))).toHaveLength(0);
  });

  it('3. série arrêtée : absente d\'À faire après son arrêt, présente avant', async () => {
    const { token, rule } = await withMonthlyInternet();
    await http.patch(`/recurrence-rules/${rule.id}`).set(auth(token)).send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: day(3), active: false }).expect(200);
    expect(internet(await todo(token, 14))).toBeUndefined();
    expect(internet(await todo(token, 2))).toBeDefined();
    expect(internet(await todo(token, 3))).toBeUndefined();
  });

  it('4/8. occurrence lointaine modifiée conservée ; appels répétés sans doublon', async () => {
    const { token } = await withMonthlyInternet();
    const first = internet(await todo(token, 15));
    await http.patch(`/planned-operations/${first.plannedOperationId}`).set(auth(token)).send({ expectedAmount: '400' }).expect(200);
    for (let i = 0; i < 3; i++) await todo(token, 15);
    const again = internet(await todo(token, 15));
    expect(again.plannedOperationId).toBe(first.plannedOperationId);
    expect(again.expectedAmount).toBe(400);
    expect(await stored(token, day(15))).toHaveLength(1);
  });

  it('5. occurrence lointaine annulée : jamais recréée', async () => {
    const { token } = await withMonthlyInternet();
    const occ = internet(await todo(token, 15));
    await http.post(`/planned-operations/${occ.plannedOperationId}/cancel`).set(auth(token)).expect(201);
    await todo(token, 15);
    expect(internet(await todo(token, 15))).toBeUndefined();
    expect(await stored(token, day(15))).toEqual([expect.objectContaining({ status: 'CANCELLED' })]);
  });

  it('6. paiement partiel lointain conservé', async () => {
    const { token } = await withMonthlyInternet();
    const occ = internet(await todo(token, 15));
    await http.post(`/planned-operations/${occ.plannedOperationId}/partial-realize`).set(auth(token)).send({ actualAmount: '100' }).expect(201);
    await todo(token, 15);
    const again = internet(await todo(token, 15));
    expect(again).toEqual(expect.objectContaining({ plannedOperationId: occ.plannedOperationId, realizedAmount: 100, remaining: 250 }));
    expect(await stored(token, day(15))).toHaveLength(1);
  });

  it('7. "cette échéance et les suivantes" : nouveau montant sur les mois lointains, déjà matérialisés ou non', async () => {
    const { token, rule } = await withMonthlyInternet();
    await todo(token, 14);
    await http.patch(`/recurrence-rules/${rule.id}`).set(auth(token)).send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: day(2), expectedAmount: '380' }).expect(200);
    expect(internet(await todo(token, 14)).expectedAmount).toBe(380);
    expect(internet(await todo(token, 24)).expectedAmount).toBe(380);
    expect(internet(await todo(token, 1)).expectedAmount).toBe(350);
  });

  it('10. À faire puis Planning, ou Planning puis À faire : mêmes occurrences, aucun doublon', async () => {
    const a = await withMonthlyInternet();
    const fromTodo = internet(await todo(a.token, 18));
    const planningA = (await http.get(`/planning?months=3&from=${shift(18)}`).set(auth(a.token)).expect(200)).body;
    const cellA = planningA.depenses.find((r: any) => r.label === 'Internet').cells[shift(18)];
    expect(cellA.singleOccurrence.plannedOperationId).toBe(fromTodo.plannedOperationId);
    expect(await stored(a.token, day(18))).toHaveLength(1);

    const b = await withMonthlyInternet();
    const planningB = (await http.get(`/planning?months=3&from=${shift(18)}`).set(auth(b.token)).expect(200)).body;
    const cellB = planningB.depenses.find((r: any) => r.label === 'Internet').cells[shift(18)];
    const fromTodoB = internet(await todo(b.token, 18));
    expect(fromTodoB.plannedOperationId).toBe(cellB.singleOccurrence.plannedOperationId);
    expect(fromTodoB.expectedAmount).toBe(cellB.displayAmount);
    expect(await stored(b.token, day(18))).toHaveLength(1);
  });

  it('9. retour au mois courant : À faire du mois courant identique avant et après des consultations lointaines', async () => {
    const { token } = await withMonthlyInternet();
    const before = await todo(token, 0);
    const nextBefore = await todo(token, 1);
    await todo(token, 30);
    await todo(token, 48);
    expect(await todo(token, 0)).toEqual(before);
    expect(await todo(token, 1)).toEqual(nextBefore);
  });
});
