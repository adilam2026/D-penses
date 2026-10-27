import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';
import { pinClockAt, restoreClock } from './support/clock';

/**
 * Flux métier d'une série récurrente avec identité (règle, version, n°) :
 * une action de l'utilisateur (déplacement, modification, annulation,
 * paiement) prime toujours sur la règle automatique, et l'occurrence logique
 * concernée n'est jamais recréée. Horloge fixée au 15/10/2026.
 * Série de référence : loyer mensuel du 31, à partir du 31/10/2026
 * (n°0 31/10, n°1 30/11, n°2 31/12, n°3 31/01, n°4 28/02, n°5 31/03…).
 */
describe('Finance Maison — flux d’une série récurrente (n° d’occurrence)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let counter = 0;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => pinClockAt('2026-10-15T12:00:00Z'));
  afterEach(() => restoreClock());

  async function loyerDu31() {
    counter += 1;
    const signup = await signupVerified(http, mailer, `rec-flows-${counter}-${Date.now()}@test.local`, 'Password123!', 'Test', `User${counter}`);
    const token = (await http.post('/households').set(auth(signup)).send({ name: `Foyer ${counter}` }).expect(201)).body.accessToken as string;
    const compte = (await http.post('/accounts').set(auth(token)).send({ name: 'CIH', openingBalance: '100000' }).expect(201)).body;
    const rule = (
      await http
        .post('/recurrence-rules')
        .set(auth(token))
        .send({ frequency: 'MONTHLY', anchorDate: '2026-10-31', kind: 'EXPENSE', label: 'Loyer', expectedAmount: '1000', sourceAccountId: compte.id, includeInTodo: true })
        .expect(201)
    ).body;
    return { token, rule };
  }

  async function series(token: string, ruleId: string) {
    const all = (await http.get('/planned-operations').set(auth(token)).expect(200)).body as any[];
    return all.filter((p) => p.recurrenceRuleId === ruleId).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  }
  const byIndex = async (token: string, ruleId: string, k: number, version = 0) =>
    (await series(token, ruleId)).find((r) => r.occurrenceIndex === k && r.seriesVersion === version);
  const planning = async (token: string, from = '2026-10', months = 12) => (await http.get(`/planning?months=${months}&from=${from}`).set(auth(token)).expect(200)).body;
  const todo = async (token: string, offset: number) => (await http.get(`/todo?monthsOffset=${offset}`).set(auth(token)).expect(200)).body;
  const loyerCell = (p: any, month: string) => p.depenses.find((r: any) => r.label === 'Loyer')?.cells[month];
  async function regenerate(token: string) {
    for (let i = 0; i < 2; i++) {
      await planning(token);
      await planning(token, '2027-06', 6);
      for (const k of [1, 2, 3, 4]) await todo(token, k);
    }
  }
  const dates = (rows: any[]) => rows.map((r) => r.expectedDate.slice(0, 10));
  const assertNoDuplicate = (rows: any[]) => {
    const keys = rows.map((r) => `${r.seriesVersion}|${r.occurrenceIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  };

  it('occurrence intacte : à sa date théorique, jamais marquée modifiée', async () => {
    const { token, rule } = await loyerDu31();
    await regenerate(token);
    const rows = await series(token, rule.id);
    expect(dates(rows).slice(0, 6)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
    expect(rows.every((r) => r.manuallyEdited === false && r.seriesVersion === 0)).toBe(true);
    assertNoDuplicate(rows);
  });

  it('déplacée manuellement : même ligne, nouvelle date, ne réapparaît JAMAIS à sa date théorique', async () => {
    const { token, rule } = await loyerDu31();
    const nov = await byIndex(token, rule.id, 1);
    const moved = (await http.patch(`/planned-operations/${nov.id}`).set(auth(token)).send({ expectedDate: '2026-11-12' }).expect(200)).body;
    expect(moved).toEqual(expect.objectContaining({ id: nov.id, recurrenceRuleId: rule.id, occurrenceIndex: 1, seriesVersion: 0, manuallyEdited: true }));
    await regenerate(token);
    const rows = await series(token, rule.id);
    expect(dates(rows)).toContain('2026-11-12');
    expect(dates(rows)).not.toContain('2026-11-30');
    expect(rows.filter((r) => r.status === 'CANCELLED')).toHaveLength(0);
    assertNoDuplicate(rows);
    // Planning et À faire : novembre montre l'occurrence déplacée, une seule fois.
    expect(loyerCell(await planning(token), '2026-11').singleOccurrence.plannedOperationId).toBe(nov.id);
    expect((await todo(token, 1)).pending.map((a: any) => a.plannedOperationId)).toEqual([nov.id]);
  });

  it('modifiée manuellement (montant) : conservée, date inchangée, les autres intactes', async () => {
    const { token, rule } = await loyerDu31();
    const dec = await byIndex(token, rule.id, 2);
    await http.patch(`/planned-operations/${dec.id}`).set(auth(token)).send({ expectedAmount: '1200' }).expect(200);
    await regenerate(token);
    const after = await byIndex(token, rule.id, 2);
    expect(after).toEqual(expect.objectContaining({ id: dec.id, expectedAmount: 1200, manuallyEdited: true }));
    expect(after.expectedDate.slice(0, 10)).toBe('2026-12-31');
    const rows = await series(token, rule.id);
    expect(rows.filter((r) => r.id !== dec.id).every((r) => r.expectedAmount === 1000 && !r.manuallyEdited)).toBe(true);
    assertNoDuplicate(rows);
  });

  it('annulée : reste annulée, rien de recréé dans son mois', async () => {
    const { token, rule } = await loyerDu31();
    const jan = await byIndex(token, rule.id, 3);
    await http.post(`/planned-operations/${jan.id}/cancel`).set(auth(token)).expect(201);
    await regenerate(token);
    const rows = await series(token, rule.id);
    expect(rows.filter((r) => r.expectedDate.startsWith('2027-01'))).toEqual([expect.objectContaining({ id: jan.id, status: 'CANCELLED' })]);
    expect(loyerCell(await planning(token), '2027-01').status).toBe('EMPTY');
    assertNoDuplicate(rows);
  });

  it('réalisée et partiellement payée : conservées, jamais doublées', async () => {
    const { token, rule } = await loyerDu31();
    const nov = await byIndex(token, rule.id, 1);
    const dec = await byIndex(token, rule.id, 2);
    await http.post(`/planned-operations/${nov.id}/realize`).set(auth(token)).send({ actualAmount: '1000' }).expect(201);
    await http.post(`/planned-operations/${dec.id}/partial-realize`).set(auth(token)).send({ actualAmount: '400' }).expect(201);
    await regenerate(token);
    const rows = await series(token, rule.id);
    expect(rows.filter((r) => r.expectedDate.startsWith('2026-11'))).toEqual([expect.objectContaining({ id: nov.id, status: 'REALIZED' })]);
    expect(rows.filter((r) => r.expectedDate.startsWith('2026-12'))).toEqual([expect.objectContaining({ id: dec.id, status: 'PENDING' })]);
    assertNoDuplicate(rows);
  });

  it('« cette échéance et les suivantes » (montant, libellé) : la déplacée garde SA date et reste modifiée ; les suivantes changent', async () => {
    const { token, rule } = await loyerDu31();
    const nov = await byIndex(token, rule.id, 1);
    await http.patch(`/planned-operations/${nov.id}`).set(auth(token)).send({ expectedDate: '2026-11-12' }).expect(200);
    await http
      .patch(`/recurrence-rules/${rule.id}`)
      .set(auth(token))
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-11-12', expectedAmount: '1100', label: 'Loyer appartement' })
      .expect(200);
    await regenerate(token);
    const movedAfter = await byIndex(token, rule.id, 1);
    expect(movedAfter).toEqual(expect.objectContaining({ id: nov.id, expectedAmount: 1100, label: 'Loyer appartement', manuallyEdited: true }));
    expect(movedAfter.expectedDate.slice(0, 10)).toBe('2026-11-12');
    const rows = await series(token, rule.id);
    const later = rows.filter((r) => r.occurrenceIndex >= 2);
    expect(later.length).toBeGreaterThan(3);
    expect(later.every((r) => r.expectedAmount === 1100 && r.label === 'Loyer appartement' && !r.manuallyEdited)).toBe(true);
    expect(dates(later).slice(0, 3)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28']);
    // Avant le pivot : intact.
    expect(await byIndex(token, rule.id, 0)).toEqual(expect.objectContaining({ expectedAmount: 1000, label: 'Loyer' }));
    assertNoDuplicate(rows);
  });

  it('« cette échéance uniquement » ne touche ni la règle ni les autres occurrences', async () => {
    const { token, rule } = await loyerDu31();
    const dec = await byIndex(token, rule.id, 2);
    await http.patch(`/planned-operations/${dec.id}`).set(auth(token)).send({ label: 'Loyer + charges', expectedAmount: '1300' }).expect(200);
    const rules = (await http.get('/recurrence-rules').set(auth(token)).expect(200)).body;
    expect(rules.find((r: any) => r.id === rule.id)).toEqual(expect.objectContaining({ label: 'Loyer', expectedAmount: 1000, seriesVersion: 0, anchorDay: 31 }));
    await regenerate(token);
    const rows = await series(token, rule.id);
    expect(rows.filter((r) => r.id !== dec.id).every((r) => r.label === 'Loyer' && r.expectedAmount === 1000)).toBe(true);
  });

  it('changement de cadence : payée, partielle, déplacée, annulée restent dans l’ancienne version ; la nouvelle ne les recrée jamais', async () => {
    const { token, rule } = await loyerDu31();
    const [nov, dec, jan, feb, mar] = await Promise.all([1, 2, 3, 4, 5].map((k) => byIndex(token, rule.id, k)));
    await http.post(`/planned-operations/${nov.id}/realize`).set(auth(token)).send({ actualAmount: '1000' }).expect(201); // réalisée
    await http.patch(`/planned-operations/${dec.id}`).set(auth(token)).send({ expectedDate: '2026-12-10' }).expect(200); // déplacée
    await http.post(`/planned-operations/${jan.id}/cancel`).set(auth(token)).expect(201); // annulée
    await http.post(`/planned-operations/${feb.id}/partial-realize`).set(auth(token)).send({ actualAmount: '300' }).expect(201); // partielle

    // À partir de novembre, le loyer passe au 15 de chaque mois.
    await http
      .patch(`/recurrence-rules/${rule.id}`)
      .set(auth(token))
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-11-30', anchorDate: '2026-11-15' })
      .expect(200);
    await regenerate(token);

    const ruleAfter = (await http.get('/recurrence-rules').set(auth(token)).expect(200)).body.find((r: any) => r.id === rule.id);
    expect(ruleAfter).toEqual(expect.objectContaining({ seriesVersion: 1, anchorDay: 15 }));

    const rows = await series(token, rule.id);
    // Ancienne version : protégées conservées telles quelles ; l'intacte (mars) retirée.
    const v0 = rows.filter((r) => r.seriesVersion === 0);
    expect(v0.find((r) => r.id === nov.id)).toEqual(expect.objectContaining({ status: 'REALIZED', occurrenceIndex: 1 }));
    expect(v0.find((r) => r.id === dec.id)).toEqual(expect.objectContaining({ status: 'PENDING', manuallyEdited: true }));
    expect(v0.find((r) => r.id === dec.id).expectedDate.slice(0, 10)).toBe('2026-12-10');
    expect(v0.find((r) => r.id === jan.id)).toEqual(expect.objectContaining({ status: 'CANCELLED' }));
    expect(v0.find((r) => r.id === feb.id)).toEqual(expect.objectContaining({ status: 'PENDING', occurrenceIndex: 4 }));
    expect(v0.find((r) => r.id === mar.id)).toBeUndefined();

    // Nouvelle version : rien en novembre, décembre, janvier, février (déjà
    // couverts par une action utilisateur) ; le 15 à partir de mars.
    const v1 = rows.filter((r) => r.seriesVersion === 1);
    expect(dates(v1).slice(0, 3)).toEqual(['2027-03-15', '2027-04-15', '2027-05-15']);
    expect(v1[0].occurrenceIndex).toBe(4);
    for (const month of ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']) {
      expect(rows.filter((r) => r.expectedDate.startsWith(month) && r.status !== 'CANCELLED').length).toBeLessThanOrEqual(1);
    }
    assertNoDuplicate(rows);
  });

  it('changement de fréquence sans nouveau jour : le jour d’origine (31) est conservé après un pivot au 28/02', async () => {
    const { token, rule } = await loyerDu31();
    await http
      .patch(`/recurrence-rules/${rule.id}`)
      .set(auth(token))
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2027-02-28', frequency: 'BIMONTHLY' })
      .expect(200);
    await planning(token, '2027-02', 12);
    const v1 = (await series(token, rule.id)).filter((r) => r.seriesVersion === 1);
    expect(dates(v1).slice(0, 4)).toEqual(['2027-02-28', '2027-04-30', '2027-06-30', '2027-08-31']);
    const v0 = (await series(token, rule.id)).filter((r) => r.seriesVersion === 0);
    expect(dates(v0)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('arrêt de la série : occurrences en attente annulées à partir du pivot, plus aucune génération', async () => {
    const { token, rule } = await loyerDu31();
    const nov = await byIndex(token, rule.id, 1);
    await http.post(`/planned-operations/${nov.id}/realize`).set(auth(token)).send({ actualAmount: '1000' }).expect(201);
    await http
      .patch(`/recurrence-rules/${rule.id}`)
      .set(auth(token))
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: '2026-12-31', active: false })
      .expect(200);
    await regenerate(token);
    await planning(token, '2028-01', 6);
    const rows = await series(token, rule.id);
    expect(rows.filter((r) => r.status === 'PENDING').map((r) => r.expectedDate.slice(0, 10))).toEqual(['2026-10-31']);
    expect(rows.find((r) => r.id === nov.id).status).toBe('REALIZED');
    expect(rows.filter((r) => r.expectedDate >= '2026-12-31').every((r) => r.status === 'CANCELLED')).toBe(true);
    expect(rows.some((r) => r.expectedDate.startsWith('2028'))).toBe(false);
    assertNoDuplicate(rows);
  });
});
