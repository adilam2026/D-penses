import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';
import { pinClockAt, restoreClock } from './support/clock';

/**
 * Moteur de récurrence par n° d'occurrence (jour d'origine permanent,
 * dernier jour du mois si absent) — bout en bout via Planning et À faire.
 * Horloge fixée au 15/10/2026 : résultats indépendants du jour d'exécution.
 */
describe('Finance Maison — moteur de récurrence (n° d’occurrence, jour d’origine)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let prisma: PrismaService;
  let counter = 0;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => pinClockAt('2026-10-15T12:00:00Z'));
  afterEach(() => restoreClock());

  async function householdWithRule(anchorDate: string, frequency = 'MONTHLY', label = 'Loyer') {
    counter += 1;
    const signup = await signupVerified(http, mailer, `rec-engine-${counter}-${Date.now()}@test.local`, 'Password123!', 'Test', `User${counter}`);
    const created = (await http.post('/households').set(auth(signup)).send({ name: `Foyer ${counter}` }).expect(201)).body;
    const token = created.accessToken as string;
    const compte = (await http.post('/accounts').set(auth(token)).send({ name: 'CIH', openingBalance: '100000' }).expect(201)).body;
    const rule = (
      await http
        .post('/recurrence-rules')
        .set(auth(token))
        .send({ frequency, anchorDate, kind: 'EXPENSE', label, expectedAmount: '100', sourceAccountId: compte.id, includeInTodo: true })
        .expect(201)
    ).body;
    return { token, rule, householdId: created.household.id as string };
  }

  async function rows(token: string, ruleId: string) {
    const all = (await http.get('/planned-operations').set(auth(token)).expect(200)).body as any[];
    return all.filter((p) => p.recurrenceRuleId === ruleId).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  }
  const planning = async (token: string, from: string, months = 6) => (await http.get(`/planning?months=${months}&from=${from}`).set(auth(token)).expect(200)).body;
  const todo = async (token: string, offset: number) => (await http.get(`/todo?monthsOffset=${offset}`).set(auth(token)).expect(200)).body;

  it('31/01/2027 → 28/02 → 31/03 → 30/04 → 31/05 → 30/06 en base, n° 0..5', async () => {
    const { token, rule } = await householdWithRule('2027-01-31');
    await planning(token, '2027-01');
    const stored = await rows(token, rule.id);
    expect(stored.slice(0, 6).map((r) => [r.occurrenceIndex, r.expectedDate.slice(0, 10)])).toEqual([
      [0, '2027-01-31'],
      [1, '2027-02-28'],
      [2, '2027-03-31'],
      [3, '2027-04-30'],
      [4, '2027-05-31'],
      [5, '2027-06-30'],
    ]);
    expect(stored.every((r) => r.seriesVersion === 0 && r.manuallyEdited === false)).toBe(true);
  });

  it('31/10/2026 : novembre a bien son occurrence (30/11), décembre au 31 — fini le mois sauté', async () => {
    const { token, rule } = await householdWithRule('2026-10-31');
    const nov = await todo(token, 1);
    expect(nov.month).toBe('2026-11');
    expect(nov.pending.map((a: any) => a.expectedDate.slice(0, 10))).toEqual(['2026-11-30']);
    const dates = (await rows(token, rule.id)).map((r) => r.expectedDate.slice(0, 10));
    expect(dates.slice(0, 4)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31']);
  });

  it('matérialisation répétée (Planning, À faire, plages lointaines) : jamais de doublon', async () => {
    const { token, rule } = await householdWithRule('2026-10-31');
    for (let i = 0; i < 3; i++) {
      await planning(token, '2026-10', 12);
      await planning(token, '2028-01', 6);
      await todo(token, 1);
      await todo(token, 20);
    }
    const stored = await rows(token, rule.id);
    const indexes = stored.map((r) => r.occurrenceIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
    const dates = stored.map((r) => r.expectedDate.slice(0, 10));
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain('2028-02-29');
    expect(dates).toContain('2028-06-30');
  });

  it('Planning et À faire désignent la même occurrence logique (même id, même n°)', async () => {
    const { token, rule } = await householdWithRule('2027-01-31');
    const fev = await todo(token, 4); // février 2027
    expect(fev.month).toBe('2027-02');
    const action = fev.pending.find((a: any) => a.label === 'Loyer');
    expect(action.expectedDate.slice(0, 10)).toBe('2027-02-28');
    const p = await planning(token, '2027-01', 3);
    const cell = p.depenses.find((r: any) => r.label === 'Loyer').cells['2027-02'];
    expect(cell.singleOccurrence.plannedOperationId).toBe(action.plannedOperationId);
    const stored = (await rows(token, rule.id)).find((r) => r.id === action.plannedOperationId);
    expect(stored.occurrenceIndex).toBe(1);
  });

  it('projection virtuelle = projection après matérialisation des mêmes mois (mêmes occurrences)', async () => {
    const { token } = await householdWithRule('2026-10-31');
    // Plage lointaine : les mois intermédiaires sont projetés en mémoire.
    const before = await planning(token, '2028-06', 3);
    // Matérialise réellement ces mois intermédiaires, puis recalcule.
    await planning(token, '2027-10', 9);
    const after = await planning(token, '2028-06', 3);
    for (const m of ['2028-06', '2028-07', '2028-08']) expect(after.synthese[m].projectionCumulee).toBe(before.synthese[m].projectionCumulee);
    // 21 mois d'octobre 2026 à juin 2028 inclus, 100 DH chacun.
    expect(before.synthese['2028-06'].projectionCumulee).toBe(-2100);
  });

  it('une occurrence dont la date a changé en base ne réapparaît jamais à sa date théorique', async () => {
    const { token, rule, householdId } = await householdWithRule('2026-10-31');
    const nov = (await rows(token, rule.id)).find((r) => r.occurrenceIndex === 1);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      await tx.plannedOperation.update({ where: { id: nov.id }, data: { expectedDate: new Date('2026-11-12T00:00:00Z') } });
    });
    for (let i = 0; i < 2; i++) {
      await planning(token, '2026-10', 12);
      await todo(token, 1);
    }
    const dates = (await rows(token, rule.id)).map((r) => r.expectedDate.slice(0, 10));
    expect(dates).toContain('2026-11-12');
    expect(dates).not.toContain('2026-11-30');
  });

  it('cohabitation avant reprise : anciennes lignes sans n° (dates dérivées) jamais doublées', async () => {
    const { token, rule, householdId } = await householdWithRule('2026-10-31');
    // Reproduit l'état d'avant ce lot : n° NULL, dates de l'ancien calcul
    // (31/10, 01/12, 01/01, 01/02…) — exactement ce qui est en base aujourd'hui.
    const legacy = ['2026-10-31', '2026-12-01', '2027-01-01', '2027-02-01'];
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      await tx.plannedOperation.deleteMany({ where: { recurrenceRuleId: rule.id } });
      for (const date of legacy) {
        await tx.plannedOperation.create({
          data: { householdId, kind: 'EXPENSE', recurrenceRuleId: rule.id, expectedAmount: 100, expectedDate: new Date(`${date}T00:00:00Z`), label: 'Loyer', includeInTodo: true },
        });
      }
    });
    for (let i = 0; i < 2; i++) await planning(token, '2026-10', 12);
    const stored = await rows(token, rule.id);
    const dates = stored.map((r) => r.expectedDate.slice(0, 10));
    // Les 4 anciennes lignes occupent les n° 0..3 : rien n'est recréé au
    // 30/11, 31/12, 31/01 ; la suite (n° 4+) suit la nouvelle règle.
    expect(dates).not.toContain('2026-11-30');
    expect(dates).not.toContain('2026-12-31');
    expect(dates).not.toContain('2027-01-31');
    expect(dates.slice(0, 6)).toEqual([...legacy, '2027-02-28', '2027-03-31']);
    expect(stored.filter((r) => r.occurrenceIndex === null)).toHaveLength(4);
  });
});
