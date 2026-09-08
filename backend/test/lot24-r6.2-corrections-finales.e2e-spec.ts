import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R6.2 — CORRECTIONS FINALES AVANT VALIDATION (post-recette, avant tout APK).
 *
 * §1 (CRITIQUE) : un paiement "déjà payé" (reprise historique) ne doit JAMAIS
 * débiter la trésorerie ACTUELLE, même quand le compte historique est connu
 * et conservé sur payment.accountId à titre d'information. accountId n'est
 * plus le proxy de "reprise historique" — Payment.isHistoricalImport est le
 * seul marqueur explicite, orthogonal au compte (cf. already-paid.util.ts,
 * ledger_entry.excluded_from_balance, account_current_balance).
 *
 * §3 : "déjà payé" doit être possible SUR CHAQUE tranche (T1/T2/T3) d'un poste
 * trimestriel (Scolarité/Restauration), jamais seulement au niveau global du
 * poste — sans ambiguïté puisque le statut est porté par CHAQUE échéance
 * (déjà supporté côté backend : school-wizard expose alreadyPaid par item, et
 * chaque terme T1/T2/T3 devient un item séparé côté mobile).
 *
 * §4/§5 : le module RecurringTransfer existait déjà (création + moteur) mais
 * n'était pas consultable/gérable — GET (findAll/findOne) génère désormais
 * paresseusement les occurrences avant lecture, PATCH ne touche jamais les
 * occurrences confirmées, et la confirmation d'une occurrence 'prevu' reste
 * l'AccountsService.confirmTransfer déjà existant (jamais un second moteur).
 */
describe('R6.2 corrections finales — avant validation (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot24+${run}+${seq}@example.com`, 'password123', 'L24', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer R6.2cf ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], name: string, initialBalance = 0, includeInOperationalTreasury?: boolean) {
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

  async function newChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'T' }).expect(201);
    return res.body.id as string;
  }

  async function accountBalance(auth: () => [string, string], accountId: string) {
    const res = await http.get(`/accounts/${accountId}`).set(...auth()).expect(200);
    return Number(res.body.currentBalance ?? res.body.soldeCourant);
  }

  // ============================================================
  // §1 CRITIQUE — reprise historique ("déjà payé") jamais un débit réel
  // ============================================================
  describe('§1 CRITIQUE — "déjà payé" ne débite jamais la trésorerie actuelle', () => {
    it('A. historique déjà payé + compte connu → compte historique conservé + solde actuel inchangé', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'SG Adil', 10000);
      const cat = await newCategory(auth, 'Uniforme A');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme A', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);

      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const payments = await http.get(`/deadlines/${deadline.body.id}/payments`).set(...auth()).expect(200);
      expect(payments.body[0].accountId).toBe(account); // compte historique conservé
      expect(payments.body[0].isHistoricalImport).toBe(true);

      expect(await accountBalance(auth, account)).toBe(10000); // solde actuel inchangé
    });

    it('B. historique déjà payé + compte inconnu → solde actuel inchangé', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte B', 10000);
      const cat = await newCategory(auth, 'Uniforme B');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme B', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);

      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25' } })
        .expect(201);

      expect(await accountBalance(auth, account)).toBe(10000);
    });

    it('C. paiement normal avec compte → solde réellement débité', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte C', 10000);
      const cat = await newCategory(auth, 'Charge C');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Charge C', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', amountCurrent: 500, amountStatus: 'confirme' })
        .expect(201);

      await http.post(`/deadlines/${deadline.body.id}/payments`).set(...auth()).send({ amount: 500, accountId: account }).expect(201);

      expect(await accountBalance(auth, account)).toBe(9500); // débit réel — jamais un paiement normal traité comme historique
    });

    it('D. coût du plan inclut le paiement historique', async () => {
      const { auth } = await newHousehold();
      const child = await newChild(auth, 'Wael D');
      const account = await newAccount(auth, 'Compte D', 10000);
      const cat = await newCategory(auth, 'Scolarité D');
      const plan = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'Plan D', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
        .expect(201);
      await http.post(`/financial-plans/${plan.body.id}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: child }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme D', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', financialPlanId: plan.body.id })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-01', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const detail = await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
      expect(detail.body.knownPlanCost).toBe(3400);
      expect(detail.body.paidAmount).toBe(3400);
    });

    it('E. reste à payer = 0 pour une échéance historique soldée', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte E', 10000);
      const cat = await newCategory(auth, 'Uniforme E');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme E', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const detail = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
      expect(detail.body.resteAPayer).toBe(0);
      expect(detail.body.financialStatus).toBe('soldee');
    });

    it('F. la projection future ne redébite jamais le paiement historique', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte F', 10000, true);
      const cat = await newCategory(auth, 'Uniforme F');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme F', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const projection = await http.get('/projection/monthly').query({ at: '2026-09-01', horizonMonths: 3 }).set(...auth()).expect(200);
      const september = projection.body.months.find((m: any) => m.month === '2026-09');
      // une échéance soldée n'est jamais un événement futur de dépense projetée
      expect(september.total_expense).toBe(0);
      expect(await accountBalance(auth, account)).toBe(10000);
    });
  });

  // ============================================================
  // §3 — "déjà payé" par échéance T1/T2/T3 (jamais au niveau global du poste)
  // ============================================================
  describe('§3 — "déjà payé" par tranche T1/T2/T3', () => {
    it('G. Scolarité T1 déjà payée / T2-T3 ouvertes', async () => {
      const { auth } = await newHousehold();
      const child = await newChild(auth, 'Wael G');
      const account = await newAccount(auth, 'SG Adil G', 50000);

      const res = await http
        .post('/school-wizard')
        .set(...auth())
        .send({
          label: 'École Wael G',
          childIds: [child],
          periodStart: '2026-09-01',
          periodEnd: '2027-06-30',
          items: [
            { label: 'Scolarité T1', dueDate: '2026-08-30', alreadyPaid: { amount: 21800, paidDate: '2026-08-30', accountId: account } },
            { label: 'Scolarité T2', amount: 16350, dueDate: '2027-01-05' },
            { label: 'Scolarité T3', amount: 16350, dueDate: '2027-04-05' },
          ],
        })
        .expect(201);

      const chargePlans = res.body.chargePlans as any[];
      const t1 = chargePlans.find((cp) => cp.label === 'Scolarité T1');
      const t2 = chargePlans.find((cp) => cp.label === 'Scolarité T2');
      const t3 = chargePlans.find((cp) => cp.label === 'Scolarité T3');

      const t1Deadlines = await http.get(`/charge-plans/${t1.id}/deadlines`).set(...auth()).expect(200);
      const t2Deadlines = await http.get(`/charge-plans/${t2.id}/deadlines`).set(...auth()).expect(200);
      const t3Deadlines = await http.get(`/charge-plans/${t3.id}/deadlines`).set(...auth()).expect(200);

      expect(t1Deadlines.body[0].financialStatus).toBe('soldee');
      expect(t1Deadlines.body[0].resteAPayer).toBe(0);
      expect(t2Deadlines.body[0].financialStatus).toBe('ouverte');
      expect(t3Deadlines.body[0].financialStatus).toBe('ouverte');

      // le compte historique de T1 n'est jamais débité pour de vrai
      expect(await accountBalance(auth, account)).toBe(50000);
    });

    it('H. Restauration T1 déjà payée / tranches suivantes ouvertes', async () => {
      const { auth } = await newHousehold();
      const child = await newChild(auth, 'Wael H');

      const res = await http
        .post('/school-wizard')
        .set(...auth())
        .send({
          label: 'École Wael H',
          childIds: [child],
          periodStart: '2026-09-01',
          periodEnd: '2027-06-30',
          items: [
            { label: 'Restauration T1', dueDate: '2026-08-30', alreadyPaid: { amount: 1200, paidDate: '2026-08-30' } },
            { label: 'Restauration T2', amount: 1200, dueDate: '2027-01-05' },
            { label: 'Restauration T3', amount: 1200, dueDate: '2027-04-05' },
          ],
        })
        .expect(201);

      const chargePlans = res.body.chargePlans as any[];
      const t1 = chargePlans.find((cp) => cp.label === 'Restauration T1');
      const t2 = chargePlans.find((cp) => cp.label === 'Restauration T2');

      const t1Deadlines = await http.get(`/charge-plans/${t1.id}/deadlines`).set(...auth()).expect(200);
      const t2Deadlines = await http.get(`/charge-plans/${t2.id}/deadlines`).set(...auth()).expect(200);

      expect(t1Deadlines.body[0].financialStatus).toBe('soldee');
      expect(t1Deadlines.body[0].resteAPayer).toBe(0);
      expect(t2Deadlines.body[0].financialStatus).toBe('ouverte');
    });
  });

  // ============================================================
  // §4/§5 — Transferts récurrents : consultation, édition, arrêt, confirmation
  // ============================================================
  describe('§4/§5 — gestion des transferts récurrents', () => {
    it('I. transfert récurrent consultable après création (GET findAll/findOne génèrent les occurrences)', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant I', 10000, true);
      const dest = await newAccount(auth, 'Épargne I', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'Épargne I', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      const list = await http.get('/recurring-transfers').set(...auth()).expect(200);
      expect(list.body.some((t: any) => t.id === rt.body.id)).toBe(true);

      const detail = await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);
      expect(detail.body.id).toBe(rt.body.id);

      // la génération paresseuse doit avoir eu lieu SANS passer par Dashboard/Calendar/Projection
      const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const generated = occurrences.body.filter((t: any) => t.recurringTransferId === rt.body.id);
      expect(generated.length).toBeGreaterThan(0);
      expect(generated[0].status).toBe('prevu');
    });

    it('J. modifier un transfert récurrent ne touche jamais une occurrence déjà confirmée — uniquement les futures', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant J', 10000, true);
      const dest = await newAccount(auth, 'Épargne J', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'J', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);
      // GET /recurring-transfers/:id déclenche la génération paresseuse des occurrences.
      await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);

      const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const firstOccurrence = occurrences.body.find((t: any) => t.recurringTransferId === rt.body.id);
      await http.post(`/accounts/transfers/${firstOccurrence.id}/confirm`).set(...auth()).expect(201);

      await http
        .patch(`/recurring-transfers/${rt.body.id}`)
        .set(...auth())
        .send({ amount: 1500, recurrenceAnchorDate: '2026-10-15' })
        .expect(200);

      const after = await http.get(`/accounts/transfers`).set(...auth()).expect(200);
      const confirmedStillThere = after.body.find((t: any) => t.id === firstOccurrence.id);
      expect(confirmedStillThere.status).toBe('confirme');
      expect(Number(confirmedStillThere.amount)).toBe(1000); // occurrence confirmée jamais réécrite
    });

    it('K. arrêter la récurrence → aucune nouvelle occurrence générée', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant K', 10000, true);
      const dest = await newAccount(auth, 'Épargne K', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'K', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);
      await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);

      const before = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const beforeCount = before.body.filter((t: any) => t.recurringTransferId === rt.body.id).length;
      expect(beforeCount).toBeGreaterThan(0);

      await http.patch(`/recurring-transfers/${rt.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);

      // même horizon relu plusieurs fois : jamais de nouvelle génération pour une récurrence arrêtée
      await http.get('/recurring-transfers').set(...auth()).expect(200);
      await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);
      const after = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const afterCount = after.body.filter((t: any) => t.recurringTransferId === rt.body.id).length;
      expect(afterCount).toBe(beforeCount);

      const detail = await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);
      expect(detail.body.status).toBe('inactif');
    });

    it('L. l\'historique des transferts confirmés reste conservé après arrêt de la récurrence', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant L', 10000, true);
      const dest = await newAccount(auth, 'Épargne L', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'L', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);
      await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);
      const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const firstOccurrence = occurrences.body.find((t: any) => t.recurringTransferId === rt.body.id);
      await http.post(`/accounts/transfers/${firstOccurrence.id}/confirm`).set(...auth()).expect(201);

      await http.patch(`/recurring-transfers/${rt.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);

      const after = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const stillThere = after.body.find((t: any) => t.id === firstOccurrence.id);
      expect(stillThere).toBeDefined();
      expect(stillThere.status).toBe('confirme');
    });

    it('M. confirmer un transfert prévu débite la source et crédite la destination de façon atomique', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant M', 10000, true);
      const dest = await newAccount(auth, 'Épargne M', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'M', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);
      await http.get(`/recurring-transfers/${rt.body.id}`).set(...auth()).expect(200);
      const occurrences = await http.get('/accounts/transfers').set(...auth()).expect(200);
      const firstOccurrence = occurrences.body.find((t: any) => t.recurringTransferId === rt.body.id);

      expect(await accountBalance(auth, source)).toBe(10000);
      expect(await accountBalance(auth, dest)).toBe(2000);

      await http.post(`/accounts/transfers/${firstOccurrence.id}/confirm`).set(...auth()).expect(201);

      expect(await accountBalance(auth, source)).toBe(9000);
      expect(await accountBalance(auth, dest)).toBe(3000);
    });
  });
});
