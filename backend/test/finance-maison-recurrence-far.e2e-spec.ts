import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Récurrences au-delà de la fenêtre glissante de 12 mois : GET /planning
 * avec from=AAAA-MM matérialise uniquement les occurrences manquantes de la
 * plage affichée, calcule en mémoire celles des mois intermédiaires (pour la
 * projection), et ne recrée/écrase jamais une occurrence existante.
 */
describe('Finance Maison — récurrences au-delà de 12 mois (Planning from=…)', () => {
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

  async function freshHousehold(): Promise<string> {
    counter += 1;
    const token = await signupVerified(http, mailer, `recurrence-far-${counter}-${Date.now()}@test.local`, '482913', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  /** Foyer avec "Salaire Adil" mensuel de 46 500 DH sans fin, à partir du 10 du mois prochain. */
  async function withMonthlySalary() {
    const token = await freshHousehold();
    const compte = (await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '1000' }).expect(201)).body;
    const rule = (
      await http
        .post('/recurrence-rules')
        .set('Authorization', `Bearer ${token}`)
        .send({ frequency: 'MONTHLY', anchorDate: day(1), label: 'Salaire Adil', kind: 'INCOME', expectedAmount: '46500', destinationAccountId: compte.id })
        .expect(201)
    ).body;
    return { token, compte, rule };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function planning(token: string, query: string) {
    return (await http.get(`/planning?${query}`).set(auth(token)).expect(200)).body;
  }

  async function occurrences(token: string, label: string) {
    const all = (await http.get('/planned-operations').set(auth(token)).expect(200)).body as any[];
    return all.filter((p) => p.label === label);
  }

  async function occurrenceOn(token: string, label: string, date: string) {
    const matches = (await occurrences(token, label)).filter((p) => p.expectedDate.slice(0, 10) === date);
    return matches;
  }

  function salaryCell(p: any, month: string) {
    const row = p.revenus.find((r: any) => r.label === 'Salaire Adil');
    return row?.cells[month];
  }

  it('1. récurrence mensuelle sans fin visible au-delà de 12 mois, sans générer les mois intermédiaires en base', async () => {
    const { token } = await withMonthlySalary();
    const p = await planning(token, `months=3&from=${shift(20)}`);
    expect(p.months).toEqual([20, 21, 22].map(shift));
    for (const m of p.months) {
      expect(salaryCell(p, m).displayAmount).toBe(46500);
      expect(salaryCell(p, m).singleOccurrence.plannedOperationId).toBeTruthy();
    }
    // Plage affichée matérialisée (payable/modifiable) ; mois intermédiaires 16-19 jamais écrits.
    const stored = (await occurrences(token, 'Salaire Adil')).map((o) => o.expectedDate.slice(0, 7));
    for (const n of [20, 21, 22]) expect(stored).toContain(shift(n));
    for (const n of [16, 17, 18, 19]) expect(stored).not.toContain(shift(n));
    // Projection : 20 salaires du mois prochain à shift(20), intermédiaires compris.
    expect(p.synthese[shift(20)].projectionCumulee).toBe(20 * 46500);
  });

  it('2. série arrêtée ("et les suivantes" -> active=false) : absente après son arrêt, y compris très loin', async () => {
    const { token, rule } = await withMonthlySalary();
    await http.patch(`/recurrence-rules/${rule.id}`).set(auth(token)).send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: day(3), active: false }).expect(200);

    const far = await planning(token, `months=3&from=${shift(14)}`);
    expect(far.revenus.find((r: any) => r.label === 'Salaire Adil')).toBeUndefined();
    const near = await planning(token, `months=3&from=${shift(1)}`);
    expect(salaryCell(near, shift(1)).displayAmount).toBe(46500);
    expect(salaryCell(near, shift(2)).displayAmount).toBe(46500);
    expect(salaryCell(near, shift(3)).status).toBe('EMPTY');
  });

  it('3/7. occurrence lointaine modifiée individuellement conservée ; appels répétés sans doublon', async () => {
    const { token } = await withMonthlySalary();
    await planning(token, `months=3&from=${shift(14)}`);
    const [occ] = await occurrenceOn(token, 'Salaire Adil', day(15));
    await http.patch(`/planned-operations/${occ.id}`).set(auth(token)).send({ expectedAmount: '50000' }).expect(200);

    for (let i = 0; i < 3; i++) await planning(token, `months=3&from=${shift(14)}`);
    const p = await planning(token, `months=6&from=${shift(13)}`);
    expect(salaryCell(p, shift(15)).displayAmount).toBe(50000);
    expect(salaryCell(p, shift(14)).displayAmount).toBe(46500);
    for (const n of [13, 14, 15, 16, 17, 18]) expect(await occurrenceOn(token, 'Salaire Adil', day(n))).toHaveLength(1);
  });

  it('4. occurrence lointaine annulée ou déplacée : jamais recréée à sa date d\'origine', async () => {
    const { token } = await withMonthlySalary();
    await planning(token, `months=3&from=${shift(14)}`);
    const [cancelled] = await occurrenceOn(token, 'Salaire Adil', day(14));
    await http.post(`/planned-operations/${cancelled.id}/cancel`).set(auth(token)).expect(201);
    const [moved] = await occurrenceOn(token, 'Salaire Adil', day(15));
    await http.patch(`/planned-operations/${moved.id}`).set(auth(token)).send({ expectedDate: `${shift(15)}-20` }).expect(200);

    for (let i = 0; i < 2; i++) await planning(token, `months=3&from=${shift(14)}`);
    const p = await planning(token, `months=3&from=${shift(14)}`);
    expect(salaryCell(p, shift(14)).status).toBe('EMPTY');
    expect(salaryCell(p, shift(15)).displayAmount).toBe(46500);
    expect(await occurrenceOn(token, 'Salaire Adil', day(14))).toEqual([expect.objectContaining({ status: 'CANCELLED' })]);
    // Déplacée sur place : plus rien à sa date d'origine, une seule ligne à la nouvelle date.
    expect(await occurrenceOn(token, 'Salaire Adil', day(15))).toEqual([]);
    expect(await occurrenceOn(token, 'Salaire Adil', `${shift(15)}-20`)).toEqual([expect.objectContaining({ id: moved.id, manuallyEdited: true })]);
  });

  it('5. occurrence lointaine partiellement payée conservée (déjà payé / reste)', async () => {
    const { token } = await withMonthlySalary();
    await planning(token, `months=3&from=${shift(14)}`);
    const [occ] = await occurrenceOn(token, 'Salaire Adil', day(14));
    await http.post(`/planned-operations/${occ.id}/partial-realize`).set(auth(token)).send({ actualAmount: '10000' }).expect(201);

    await planning(token, `months=3&from=${shift(14)}`);
    const p = await planning(token, `months=3&from=${shift(14)}`);
    const cell = salaryCell(p, shift(14));
    expect(cell.realizedAmount).toBe(10000);
    expect(cell.pendingAmount).toBe(36500);
    expect(await occurrenceOn(token, 'Salaire Adil', day(14))).toHaveLength(1);
  });

  it('6. "cette échéance et les suivantes" : nouveau montant sur les occurrences lointaines, déjà matérialisées ou non', async () => {
    const { token, rule } = await withMonthlySalary();
    await planning(token, `months=3&from=${shift(14)}`);
    await http.patch(`/recurrence-rules/${rule.id}`).set(auth(token)).send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: day(2), expectedAmount: '48000' }).expect(200);

    const materialized = await planning(token, `months=3&from=${shift(14)}`);
    for (const n of [14, 15, 16]) expect(salaryCell(materialized, shift(n)).displayAmount).toBe(48000);
    const fresh = await planning(token, `months=3&from=${shift(24)}`);
    for (const n of [24, 25, 26]) expect(salaryCell(fresh, shift(n)).displayAmount).toBe(48000);
    const near = await planning(token, `months=3&from=${shift(1)}`);
    expect(salaryCell(near, shift(1)).displayAmount).toBe(46500);
    expect(salaryCell(near, shift(2)).displayAmount).toBe(48000);
  });

  it('9/10. retour à la période actuelle : Planning par défaut identique avant et après des consultations lointaines', async () => {
    const { token } = await withMonthlySalary();
    const before = await planning(token, 'months=6');
    await planning(token, `months=12&from=${shift(18)}`);
    await planning(token, `months=3&from=${shift(40)}`);
    const after = await planning(token, 'months=6');
    expect(after).toEqual(before);
    expect(after.months[0]).toBe(shift(0));
  });
});
