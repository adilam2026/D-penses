import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R6.1 — corrections diagnostiquées lors de la recette Samsung avant refonte
 * visuelle : (1) une échéance avec un montant pourtant connu affichait un
 * calcul invalide (NaN, décrit par l'utilisateur comme « N/A ») dans le détail
 * d'une charge, faute de reste_a_payer calculé par l'endpoint concerné ;
 * (2) aucun moyen de sortir un compte du pilotage (trésorerie/disponible
 * libre/projection) tout en le gardant visible et son historique intact.
 * Aucun moteur financier recalculé ici : ces tests prouvent que treasury.util.ts/
 * monthly-projection.util.ts (déjà existants) produisent le bon résultat une
 * fois le flag réellement modifiable et réellement respecté partout.
 */
describe('R6.1 — corrections (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot22+${run}+${seq}@example.com`, 'password123', 'L22', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer R6.1 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(
    auth: () => [string, string],
    name: string,
    initialBalance = 0,
    includeInOperationalTreasury?: boolean,
  ) {
    const res = await http
      .post('/accounts')
      .set(...auth())
      .send({ name, type: 'courant', initialBalance, includeInOperationalTreasury })
      .expect(201);
    return res.body.id as string;
  }

  async function newCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function dashboard(auth: () => [string, string]) {
    const res = await http.get('/dashboard/summary').set(...auth()).expect(200);
    return res.body;
  }

  async function monthly(auth: () => [string, string], at = '2026-09-01') {
    const res = await http.get(`/projection/monthly?at=${at}`).set(...auth()).expect(200);
    return res.body;
  }

  // ============================================================
  // M — échéance connue jamais N/A / NaN
  // ============================================================
  describe('§13 — échéance connue jamais N/A', () => {
    it('M. une échéance créée avec un montant confirmé renvoie reste_a_payer (nombre), jamais undefined/NaN, dans la liste des échéances du plan', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte M', 5000);
      const cat = await newCategory(auth, 'Charge M');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Internet M', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', defaultAccountId: account })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: 299, amountStatus: 'confirme' })
        .expect(201);

      const list = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      expect(list.body).toHaveLength(1);
      const d = list.body[0];
      expect(d.resteAPayer).toBe(299);
      expect(typeof d.resteAPayer).toBe('number');
      expect(Number.isNaN(d.resteAPayer)).toBe(false);
    });

    it("M-bis. une échéance réellement à montant inconnu renvoie resteAPayer=null (jamais NaN, jamais 0)", async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge M2');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Charge inconnue M2', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountStatus: 'inconnu' })
        .expect(201);

      const list = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      expect(list.body[0].resteAPayer).toBeNull();
    });
  });

  // ============================================================
  // A-L — compte inclus/exclu du pilotage
  // ============================================================
  describe('§6-§9 — compte inclus/exclu du pilotage financier', () => {
    it('A. un compte créé sans préciser le flag est inclus par défaut', async () => {
      const { auth } = await newHousehold();
      const id = await newAccount(auth, 'Compte A', 1000);
      const detail = await http.get(`/accounts/${id}`).set(...auth()).expect(200);
      expect(detail.body.includeInOperationalTreasury).toBe(true);
    });

    it('B. un compte exclu reste visible dans la liste des comptes avec son solde', async () => {
      const { auth } = await newHousehold();
      const id = await newAccount(auth, 'Épargne épouse B', 3000, false);

      const list = await http.get('/accounts').set(...auth()).expect(200);
      const found = list.body.find((a: any) => a.id === id);
      expect(found).toBeDefined();
      expect(found.includeInOperationalTreasury).toBe(false);
      expect(found.soldeCourant).toBe(3000);
    });

    it('C. un compte exclu est absent de la trésorerie opérationnelle (patrimoine total, lui, l\'inclut)', async () => {
      const { auth } = await newHousehold();
      await newAccount(auth, 'Compte courant C', 4000, true);
      await newAccount(auth, 'Épargne exclue C', 6000, false);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.patrimoineLiquideTotal).toBe(10000);
      expect(summary.body.tresorerieOperationnelle).toBe(4000);
    });

    it('D. un compte exclu est absent du disponible libre (via GET /dashboard/summary)', async () => {
      const { auth } = await newHousehold();
      await newAccount(auth, 'Compte courant D', 5000, true);
      await newAccount(auth, 'Épargne exclue D', 20000, false);

      const body = await dashboard(auth);
      expect(body.operational_treasury).toBe(5000);
      expect(body.patrimoine_liquide_total).toBe(25000);
      expect(body.free_available).toBe(5000); // aucun engagement/réserve/coussin dans ce foyer neuf
    });

    it('E. un compte exclu est absent de la trésorerie initiale de la Projection', async () => {
      const { auth } = await newHousehold();
      const included = await newAccount(auth, 'Compte courant E', 7000, true);
      await newAccount(auth, 'Épargne exclue E', 15000, false);

      const body = await monthly(auth);
      expect(body.summary.opening_cash_balance).toBe(7000);
      expect(body.summary.treasury_account_ids).toEqual([included]);
    });

    it('F. un compte inclus (explicitement true) est bien pris en compte partout', async () => {
      const { auth } = await newHousehold();
      const id = await newAccount(auth, 'Compte inclus F', 2500, true);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(2500);
      const body = await monthly(auth);
      expect(body.summary.treasury_account_ids).toEqual([id]);
    });

    it('G. un transfert inclus→exclu diminue la trésorerie pilotée sans changer le patrimoine total', async () => {
      const { auth } = await newHousehold();
      const from = await newAccount(auth, 'Compte courant G', 10000, true);
      const to = await newAccount(auth, 'Épargne exclue G', 0, false);

      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: from, toAccountId: to, amount: 2000 }).expect(201);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.patrimoineLiquideTotal).toBe(10000); // rien ne quitte le foyer
      expect(summary.body.tresorerieOperationnelle).toBe(8000); // 10000 - 2000 sorti du pilotage
    });

    it('H. un transfert exclu→inclus augmente la trésorerie pilotée', async () => {
      const { auth } = await newHousehold();
      const from = await newAccount(auth, 'Épargne exclue H', 5000, false);
      const to = await newAccount(auth, 'Compte courant H', 1000, true);

      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: from, toAccountId: to, amount: 1500 }).expect(201);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.patrimoineLiquideTotal).toBe(6000);
      expect(summary.body.tresorerieOperationnelle).toBe(2500); // 1000 + 1500 entré dans le pilotage
    });

    it('I. un transfert inclus→inclus est net zéro sur la trésorerie pilotée', async () => {
      const { auth } = await newHousehold();
      const from = await newAccount(auth, 'Compte courant I1', 3000, true);
      const to = await newAccount(auth, 'Compte courant I2', 1000, true);

      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: from, toAccountId: to, amount: 1000 }).expect(201);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(4000); // inchangé : 3000+1000 avant, 2000+2000 après
    });

    it('J. un transfert exclu→exclu reste hors pilotage (trésorerie pilotée inchangée)', async () => {
      const { auth } = await newHousehold();
      const from = await newAccount(auth, 'Épargne exclue J1', 3000, false);
      const to = await newAccount(auth, 'Épargne exclue J2', 500, false);
      await newAccount(auth, 'Compte courant J témoin', 200, true);

      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: from, toAccountId: to, amount: 1000 }).expect(201);

      const summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(200); // seul le témoin compte
      expect(summary.body.patrimoineLiquideTotal).toBe(3700);
    });

    it('K. changer le flag d\'un compte déjà créé recalcule immédiatement et correctement la trésorerie pilotée', async () => {
      const { auth } = await newHousehold();
      const id = await newAccount(auth, 'Compte à basculer K', 4000, true);
      await newAccount(auth, 'Témoin K', 1000, true);

      let summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(5000);

      await http.patch(`/accounts/${id}`).set(...auth()).send({ includeInOperationalTreasury: false }).expect(200);

      summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(1000);
      expect(summary.body.patrimoineLiquideTotal).toBe(5000); // le compte existe toujours, solde intact

      await http.patch(`/accounts/${id}`).set(...auth()).send({ includeInOperationalTreasury: true }).expect(200);
      summary = await http.get('/accounts/summary').set(...auth()).expect(200);
      expect(summary.body.tresorerieOperationnelle).toBe(5000);
    });

    it("L. exclure un compte ne touche jamais son historique de transferts", async () => {
      const { auth } = await newHousehold();
      const a = await newAccount(auth, 'Compte L1', 2000, true);
      const b = await newAccount(auth, 'Compte L2', 0, true);
      await http.post('/accounts/transfers').set(...auth()).send({ fromAccountId: a, toAccountId: b, amount: 500 }).expect(201);

      await http.patch(`/accounts/${a}`).set(...auth()).send({ includeInOperationalTreasury: false }).expect(200);

      const transfers = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const found = transfers.body.find((t: any) => t.fromAccountId === a && t.toAccountId === b);
      expect(found).toBeDefined();
      expect(Number(found.amount)).toBe(500);

      const detail = await http.get(`/accounts/${a}`).set(...auth()).expect(200);
      expect(detail.body.soldeCourant).toBe(1500); // solde/historique inchangés par le simple flag
    });
  });
});
