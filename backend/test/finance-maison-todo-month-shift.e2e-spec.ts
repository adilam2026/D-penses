import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';
import { pinClockAt, restoreClock } from './support/clock';

/**
 * GET /todo?monthsOffset=N en fin de mois : le mois consulté est le mois
 * courant + N MOIS (31/10 + 1 = novembre, jamais décembre). Horloge fixée
 * à chaque date testée ; aucune donnée de recette touchée.
 */
describe('Finance Maison — À faire : changement de mois en fin de mois', () => {
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

  afterEach(() => restoreClock());

  async function householdWith(actionDates: string[]) {
    counter += 1;
    const signup = await signupVerified(http, mailer, `todo-shift-${counter}-${Date.now()}@test.local`, '482913', 'Test', `User${counter}`);
    const token = (await http.post('/households').set(auth(signup)).send({ name: `Foyer ${counter}` }).expect(201)).body.accessToken as string;
    const compte = (await http.post('/accounts').set(auth(token)).send({ name: 'CIH', openingBalance: '1000' }).expect(201)).body;
    const ids: Record<string, string> = {};
    for (const date of actionDates) {
      const res = await http
        .post('/planned-operations')
        .set(auth(token))
        .send({ kind: 'EXPENSE', label: `Échéance ${date}`, expectedDate: date, expectedAmount: '100', sourceAccountId: compte.id, includeInTodo: true })
        .expect(201);
      ids[date] = res.body.id;
    }
    return { token, ids };
  }

  const todo = async (token: string, offset: number) => (await http.get(`/todo?monthsOffset=${offset}`).set(auth(token)).expect(200)).body;
  const pendingIds = (t: any) => t.pending.map((a: any) => a.plannedOperationId).sort();

  it('31/10 à 23:30 : +1 = novembre (ses échéances), +2 = décembre, -1 = septembre', async () => {
    pinClockAt('2026-10-31T23:30:00Z');
    const { token, ids } = await householdWith(['2026-11-10', '2026-12-10', '2026-09-10']);
    const nov = await todo(token, 1);
    expect(nov.month).toBe('2026-11');
    expect(pendingIds(nov)).toEqual([ids['2026-11-10']]);
    expect((await todo(token, 2)).month).toBe('2026-12');
    const sept = await todo(token, -1);
    expect(sept.month).toBe('2026-09');
    expect(pendingIds(sept)).toEqual([ids['2026-09-10']]);
  });

  it('du 28 au 31 octobre : +1 est toujours novembre', async () => {
    for (const day of [28, 29, 30, 31]) {
      pinClockAt(`2026-10-${day}T12:00:00Z`);
      const { token } = await householdWith([]);
      expect((await todo(token, 1)).month).toBe('2026-11');
      restoreClock();
    }
  });

  it('31/01 : +1 = février (non bissextile et bissextile), +2 = mars', async () => {
    pinClockAt('2027-01-31T12:00:00Z');
    let h = await householdWith(['2027-02-15']);
    const fev = await todo(h.token, 1);
    expect(fev.month).toBe('2027-02');
    expect(pendingIds(fev)).toEqual([h.ids['2027-02-15']]);
    expect((await todo(h.token, 2)).month).toBe('2027-03');
    restoreClock();

    pinClockAt('2028-01-31T12:00:00Z');
    h = await householdWith(['2028-02-29']);
    const fevBis = await todo(h.token, 1);
    expect(fevBis.month).toBe('2028-02');
    expect(pendingIds(fevBis)).toEqual([h.ids['2028-02-29']]);
  });

  it('31/03 : -1 = février ; 31/12 : +1 = janvier ; 01/01 : -1 = décembre', async () => {
    pinClockAt('2027-03-31T12:00:00Z');
    expect((await todo((await householdWith([])).token, -1)).month).toBe('2027-02');
    restoreClock();
    pinClockAt('2026-12-31T23:30:00Z');
    expect((await todo((await householdWith([])).token, 1)).month).toBe('2027-01');
    restoreClock();
    pinClockAt('2027-01-01T00:30:00Z');
    expect((await todo((await householdWith([])).token, -1)).month).toBe('2026-12');
  });

  it('plusieurs mois de décalage depuis un 31 : +4 = février, +16 = février bissextile, -8 = février', async () => {
    pinClockAt('2026-10-31T12:00:00Z');
    const { token } = await householdWith([]);
    expect((await todo(token, 4)).month).toBe('2027-02');
    expect((await todo(token, 16)).month).toBe('2028-02');
    expect((await todo(token, -8)).month).toBe('2026-02');
  });
});
