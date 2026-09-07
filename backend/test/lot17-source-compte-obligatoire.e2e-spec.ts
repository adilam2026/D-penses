import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { RlsContextService } from '../src/common/prisma/rls-context.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Round 3 (« DERNIÈRE SÉCURISATION AVANT BUILD » §17) — chaque mouvement
 * financier RÉEL (paiement, dépense, revenu reçu) débite/crédite obligatoirement
 * un compte réel. Une Provision/enveloppe indique CE POUR QUOI l'argent est
 * réservé, jamais D'OÙ il sort physiquement — les deux ne sont jamais confondus
 * (RG-095). PLANIFIÉ ≠ RÉEL (RG-000) : un revenu encore `prevu` ne crédite rien.
 * Scénarios A à L, un describe par lettre.
 */
describe('Round 3 §17 — source de compte obligatoire pour tout mouvement réel (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let rlsContext: RlsContextService;
  const run = Date.now();
  let seq = 0;

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    rlsContext = app.get(RlsContextService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot17+${run}+${seq}@example.com`, 'password123', 'L17', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot17 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function soldeCourant(auth: () => [string, string], accountId: string): Promise<number> {
    const accounts = await http.get('/accounts').set(...auth()).expect(200);
    const found = accounts.body.find((a: { id: string }) => a.id === accountId);
    return found.soldeCourant;
  }

  async function newDeadline(auth: () => [string, string], categoryId: string, amount: number) {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Échéance test', categoryId, generationMode: 'calendrier_manuel', startDate: '2026-01-01' })
      .expect(201);
    const deadline = await http
      .post(`/charge-plans/${cp.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-02-01', amountCurrent: amount, amountStatus: 'confirme' })
      .expect(201);
    return deadline.body.id as string;
  }

  describe('A — paiement sans compte : refusé', () => {
    it('POST /deadlines/:id/payments sans accountId → 400', async () => {
      const { auth } = await newHousehold();
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat A', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 1200);

      await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 1200 }).expect(400);
    });
  });

  describe('B — paiement total débite le compte exactement du montant payé', () => {
    it('Compte courant 10 000 DH, paiement 1 200 DH → 8 800 DH', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte courant', type: 'courant', initialBalance: 10000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat B', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 1200);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 1200, accountId: account.body.id, paidDate: '2026-09-10' })
        .expect(201);

      expect(await soldeCourant(auth, account.body.id)).toBe(8800);
      // RG-014 : le passage à "soldée" n'est jamais automatique (le montant peut
      // encore être révisé) — reste_a_payer=0 mais une clôture explicite est requise.
      const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(deadline.body.resteAPayer).toBe(0);
      await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);
      const closed = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(closed.body.financialStatus).toBe('soldee');
    });
  });

  describe('C — paiement partiel : reste dû réduit, compte débité du seul montant payé', () => {
    it('Échéance 10 000 DH, paiement 4 000 DH depuis BP → BP -4000, reste 6 000, partiellement payée', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 4000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat C', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 10000);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 4000, accountId: account.body.id, paidDate: '2026-09-10' })
        .expect(201);

      expect(await soldeCourant(auth, account.body.id)).toBe(0);
      const deadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(deadline.body.financialStatus).toBe('partiellement_payee');
      expect(deadline.body.resteAPayer).toBe(6000);

      // Le paiement suivant peut venir d'un compte différent, chaque paiement garde sa propre source.
      const account2 = await http.post('/accounts').set(...auth()).send({ name: 'CIH', type: 'courant', initialBalance: 6000 }).expect(201);
      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 6000, accountId: account2.body.id, paidDate: '2026-09-11' })
        .expect(201);
      expect(await soldeCourant(auth, account2.body.id)).toBe(0);
      const finalDeadline = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(finalDeadline.body.resteAPayer).toBe(0);
      await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);
      const closed = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
      expect(closed.body.financialStatus).toBe('soldee');
    });
  });

  describe('D — le Cash est un compte réel, débité comme les autres', () => {
    it('Cash 2 000 DH, paiement 600 DH → 1 400 DH', async () => {
      const { auth } = await newHousehold();
      const cash = await http.post('/accounts').set(...auth()).send({ name: 'Espèces', type: 'especes', initialBalance: 2000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat D', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 600);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 600, accountId: cash.body.id, paidDate: '2026-09-10' })
        .expect(201);

      expect(await soldeCourant(auth, cash.body.id)).toBe(1400);
    });
  });

  describe('E — paiement avec enveloppe : un SEUL débit physique, l\'enveloppe est consommée', () => {
    it('Enveloppe École 5 000 DH, Compte courant 10 000 DH, paiement 3 000 DH → compte 7 000, enveloppe 2 000', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte courant', type: 'courant', initialBalance: 10000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat E', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 3000);

      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'École', allocationMode: 'virtual_allocation' })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 3000, accountId: account.body.id, fundingSource: 'provision', provisionId: provision.body.id, paidDate: '2026-09-10' })
        .expect(201);

      // Un seul débit physique de 3000 sur le compte — jamais un double débit.
      expect(await soldeCourant(auth, account.body.id)).toBe(7000);
      const updatedProvision = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(Number(updatedProvision.body.currentAmount)).toBe(2000);
    });
  });

  describe('F — enveloppe localisée sur un AUTRE compte que celui du paiement (cross-compte)', () => {
    it('Enveloppe École (virtual, indicative CIH) 5 000 DH ; paiement 3 000 DH depuis BP → BP débité, CIH inchangé, enveloppe → 2 000', async () => {
      const { auth } = await newHousehold();
      const cih = await http.post('/accounts').set(...auth()).send({ name: 'CIH', type: 'courant', initialBalance: 5000 }).expect(201);
      const bp = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 8000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat F', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 3000);

      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'École', allocationMode: 'virtual_allocation', linkedAccountId: cih.body.id })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 3000, accountId: bp.body.id, fundingSource: 'provision', provisionId: provision.body.id, paidDate: '2026-09-10' })
        .expect(201);

      expect(await soldeCourant(auth, bp.body.id)).toBe(5000);
      expect(await soldeCourant(auth, cih.body.id)).toBe(5000); // CIH physiquement inchangé : l'enveloppe n'est qu'indicative.
      const updatedProvision = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(Number(updatedProvision.body.currentAmount)).toBe(2000);
    });

    it('« Payer sans utiliser l\'enveloppe » : BP débité, enveloppe reste à 5 000', async () => {
      const { auth } = await newHousehold();
      const cih = await http.post('/accounts').set(...auth()).send({ name: 'CIH', type: 'courant', initialBalance: 5000 }).expect(201);
      const bp = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 8000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat F2', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 3000);

      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'École', allocationMode: 'virtual_allocation', linkedAccountId: cih.body.id })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 5000 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 3000, accountId: bp.body.id, paidDate: '2026-09-10' })
        .expect(201);

      expect(await soldeCourant(auth, bp.body.id)).toBe(5000);
      const updatedProvision = await http.get(`/provisions/${provision.body.id}`).set(...auth()).expect(200);
      expect(Number(updatedProvision.body.currentAmount)).toBe(5000);
    });
  });

  describe('G — dépense rapide sans compte : refusée', () => {
    it('POST /expenses sans accountId → 400', async () => {
      const { auth } = await newHousehold();
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat G', kind: 'expense' }).expect(201);

      await http.post('/expenses').set(...auth()).send({ amount: 200, categoryId: category.body.id }).expect(400);
    });
  });

  describe('H — dépense rapide avec compte : débit réel', () => {
    it('Compte courant 3 000 DH, dépense 250 DH → 2 750 DH', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte courant', type: 'courant', initialBalance: 3000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat H', kind: 'expense' }).expect(201);

      await http.post('/expenses').set(...auth()).send({ amount: 250, accountId: account.body.id, categoryId: category.body.id }).expect(201);

      expect(await soldeCourant(auth, account.body.id)).toBe(2750);
    });
  });

  describe('I — revenu confirmé « Reçu » crédite réellement un compte', () => {
    it('Salaire 29 500 DH, Reçu sur Compte courant → Compte courant +29 500 DH', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte courant', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'Salaire', usualAmount: 29500, defaultAccountId: account.body.id, isRecurring: false })
        .expect(201);
      const occurrence = await http
        .post(`/income-sources/${source.body.id}/occurrences`)
        .set(...auth())
        .send({ usualDate: '2026-02-01' })
        .expect(201);

      await http
        .post(`/income-occurrences/${occurrence.body.id}/confirm`)
        .set(...auth())
        .send({ actualAmount: 29500, actualDate: '2026-09-10', accountId: account.body.id })
        .expect(201);

      expect(await soldeCourant(auth, account.body.id)).toBe(29500);
    });
  });

  describe('J — PLANIFIÉ ≠ RÉEL : un revenu encore prévu ne crédite rien', () => {
    it('Occurrence planifiée non confirmée → solde du compte inchangé', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte courant', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'Salaire prévu', usualAmount: 15000, defaultAccountId: account.body.id, isRecurring: false })
        .expect(201);
      await http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate: '2026-03-01' }).expect(201);

      expect(await soldeCourant(auth, account.body.id)).toBe(0);
    });
  });

  describe('K — un compte inactif n\'est plus proposé pour un nouveau paiement', () => {
    it('GET /accounts n\'inclut pas un compte status=archive (aucune UI de désactivation de compte n\'existe encore : vérifié au niveau de la requête elle-même)', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Ancien compte', type: 'courant', initialBalance: 500 }).expect(201);

      await rlsContext.run('test-user', account.body.householdId, () =>
        rlsContext.getClient().financialAccount.update({ where: { id: account.body.id }, data: { status: 'archive' } }),
      );

      const accounts = await http.get('/accounts').set(...auth()).expect(200);
      expect(accounts.body.find((a: { id: string }) => a.id === account.body.id)).toBeUndefined();
    });
  });

  describe('L — l\'historique des paiements affiche le compte débité (et l\'enveloppe si utilisée)', () => {
    it('GET /deadlines/:id/payments renvoie accountId et provisionId pour chaque paiement', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte BP', type: 'courant', initialBalance: 10000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat L', kind: 'expense' }).expect(201);
      const deadlineId = await newDeadline(auth, category.body.id, 4000);

      const provision = await http
        .post('/provisions')
        .set(...auth())
        .send({ name: 'École', allocationMode: 'virtual_allocation' })
        .expect(201);
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 4000 }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      await http
        .post(`/deadlines/${deadlineId}/payments`)
        .set(...auth())
        .send({ amount: 4000, accountId: account.body.id, fundingSource: 'provision', provisionId: provision.body.id, paidDate: '2026-09-10' })
        .expect(201);

      const payments = await http.get(`/deadlines/${deadlineId}/payments`).set(...auth()).expect(200);
      expect(payments.body).toHaveLength(1);
      expect(payments.body[0].accountId).toBe(account.body.id);
      expect(payments.body[0].provisionId).toBe(provision.body.id);
    });
  });
});
