import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * GET /planning?from=AAAA-MM — période de référence indépendante de l'horizon :
 * la plage renvoyée commence au mois demandé, quel que soit `months`.
 */
describe('Finance Maison — Planning : période de référence (from) indépendante de l\'horizon', () => {
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

  async function freshHousehold(): Promise<string> {
    counter += 1;
    const token = await signupVerified(http, mailer, `planning-from-${counter}-${Date.now()}@test.local`, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  async function setup(token: string) {
    const compte = (await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'CIH', openingBalance: '20000' }).expect(201)).body;
    const cat = (await http.post('/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Maison' }).expect(201)).body;
    return { compte, cat };
  }

  async function planned(token: string, label: string, month: string, amount: string, accountId: string, categoryId: string) {
    await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label, expectedDate: `${month}-15`, expectedAmount: amount, categoryId, sourceAccountId: accountId })
      .expect(201);
  }

  async function getPlanning(token: string, query: string) {
    return (await http.get(`/planning?${query}`).set('Authorization', `Bearer ${token}`).expect(200)).body;
  }

  it('sans from : comportement historique (plage depuis le mois courant), currentMonth renvoyé, résultat identique à from=mois courant', async () => {
    const token = await freshHousehold();
    const { compte, cat } = await setup(token);
    await planned(token, 'Loyer', shift(0), '4000', compte.id, cat.id);
    await planned(token, 'Assurance', shift(2), '700', compte.id, cat.id);

    const def = await getPlanning(token, 'months=6');
    expect(def.currentMonth).toBe(shift(0));
    expect(def.months).toEqual([0, 1, 2, 3, 4, 5].map(shift));
    expect(def.synthese[shift(0)].resteDepenses).toBe(4000);

    const explicit = await getPlanning(token, `months=6&from=${shift(0)}`);
    expect(explicit).toEqual(def);
  });

  it('horizon 6 mois + période à +9 mois : acceptée, plage = les 6 mois demandés, données de cette période uniquement', async () => {
    const token = await freshHousehold();
    const { compte, cat } = await setup(token);
    await planned(token, 'Loyer', shift(0), '4000', compte.id, cat.id);
    await planned(token, 'Vacances', shift(9), '2500', compte.id, cat.id);
    await planned(token, 'Rentrée', shift(10), '1200', compte.id, cat.id);

    const from = shift(8);
    const p = await getPlanning(token, `months=6&from=${from}`);
    expect(p.months).toEqual([8, 9, 10, 11, 12, 13].map(shift));
    expect(p.currentMonth).toBe(shift(0));

    const labels = p.depenses.map((r: any) => r.label).sort();
    expect(labels).toEqual(['Rentrée', 'Vacances']);
    const vacances = p.depenses.find((r: any) => r.label === 'Vacances');
    expect(Object.keys(vacances.cells)).toEqual(p.months);
    expect(vacances.cells[shift(9)].displayAmount).toBe(2500);
    expect(vacances.cells[shift(8)].status).toBe('EMPTY');
    expect(Object.keys(p.synthese)).toEqual(p.months);
    expect(p.synthese[shift(9)].totalDepenses).toBe(2500);
    expect(p.occurrences.every((o: any) => p.months.includes(o.month))).toBe(true);
    expect(p.occurrences.map((o: any) => o.label).sort()).toEqual(['Rentrée', 'Vacances']);
  });

  it('période future : reste à exécuter absent partout, projection cumulée toujours comptée depuis le mois courant', async () => {
    const token = await freshHousehold();
    const { compte, cat } = await setup(token);
    await planned(token, 'Loyer', shift(0), '4000', compte.id, cat.id);
    await planned(token, 'Travaux', shift(3), '1000', compte.id, cat.id);
    await planned(token, 'Vacances', shift(9), '2500', compte.id, cat.id);

    const p = await getPlanning(token, `months=3&from=${shift(8)}`);
    for (const m of p.months) {
      expect(p.synthese[m].resteDepenses).toBeNull();
      expect(p.synthese[m].couverte).toBeNull();
    }
    expect(p.synthese[shift(9)].resultatPrevu).toBe(-2500);
    // Mêmes valeurs que la plage complète calculée depuis le mois courant.
    expect(p.synthese[shift(8)].projectionCumulee).toBe(-5000);
    expect(p.synthese[shift(9)].projectionCumulee).toBe(-7500);

    const full = await getPlanning(token, 'months=12');
    for (const m of p.months) expect(p.synthese[m]).toEqual(full.synthese[m]);
  });

  it('période démarrant avant le mois courant : le reste à exécuter reste porté par le vrai mois courant', async () => {
    const token = await freshHousehold();
    const { compte, cat } = await setup(token);
    await planned(token, 'Loyer', shift(0), '4000', compte.id, cat.id);

    const p = await getPlanning(token, `months=3&from=${shift(-1)}`);
    expect(p.months).toEqual([-1, 0, 1].map(shift));
    expect(p.synthese[shift(-1)].resteDepenses).toBeNull();
    expect(p.synthese[shift(0)].resteDepenses).toBe(4000);
    expect(p.synthese[shift(1)].resteDepenses).toBeNull();
  });

  it('projection indépendante du premier mois demandé : null pour un mois passé, identique à la plage par défaut ensuite', async () => {
    const token = await freshHousehold();
    const { compte, cat } = await setup(token);
    await planned(token, 'Ancien', shift(-2), '900', compte.id, cat.id);
    await planned(token, 'Loyer', shift(0), '4000', compte.id, cat.id);
    await planned(token, 'Travaux', shift(1), '1000', compte.id, cat.id);

    const def = await getPlanning(token, 'months=6');
    const past = await getPlanning(token, `months=6&from=${shift(-2)}`);
    expect(past.synthese[shift(-2)].projectionCumulee).toBeNull();
    expect(past.synthese[shift(-1)].projectionCumulee).toBeNull();
    expect(past.synthese[shift(-2)].resultatPrevu).toBe(-900);
    for (const m of [0, 1, 2, 3].map(shift)) expect(past.synthese[m]).toEqual(def.synthese[m]);
    expect(def.synthese[shift(1)].projectionCumulee).toBe(-5000);
  });

  it('from invalide : 400 explicite', async () => {
    const token = await freshHousehold();
    for (const bad of ['2027-13', '2027-7', 'juillet', '2027-07-01']) {
      await http.get(`/planning?months=6&from=${bad}`).set('Authorization', `Bearer ${token}`).expect(400);
    }
  });
});
