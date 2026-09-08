import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * R6.2 — corrections diagnostiquées lors de la recette Samsung après R6.1 :
 * (§2) "Charges récurrentes" (GET /charge-plans, jamais le même endpoint que
 * le détail d'un plan déjà corrigé en R6.1) affichait "NaN DH" pour une
 * charge à montant pourtant connu, faute de reste_a_payer calculé sur la
 * prochaine échéance incluse par cette liste. Aucun moteur financier
 * recalculé ici : getDeadlineBalances (deadline_with_balance) est réutilisé
 * tel quel, seul l'endpoint liste était en cause.
 */
describe('R6.2 — corrections (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot23+${run}+${seq}@example.com`, 'password123', 'L23', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer R6.2 ${seq}` })
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

  // ============================================================
  // §2 / TEST G-H — "Charges récurrentes" (liste) jamais NaN DH
  // ============================================================
  describe('§2 — GET /charge-plans (liste "Charges récurrentes") jamais NaN DH', () => {
    it('G. une charge dont la prochaine échéance a un montant confirmé renvoie resteAPayer (nombre), jamais undefined/NaN', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte G', 5000);
      const cat = await newCategory(auth, 'Charge G');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Loyer G', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', defaultAccountId: account })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: 500, amountStatus: 'confirme' })
        .expect(201);

      const list = await http.get('/charge-plans').set(...auth()).expect(200);
      const plan = list.body.find((p: any) => p.id === cp.body.id);
      expect(plan).toBeDefined();
      expect(plan.deadlines).toHaveLength(1);
      const next = plan.deadlines[0];
      expect(next.resteAPayer).toBe(500);
      expect(typeof next.resteAPayer).toBe('number');
      expect(Number.isNaN(next.resteAPayer)).toBe(false);
    });

    it('H. une charge dont la prochaine échéance est à montant réellement inconnu renvoie resteAPayer=null (jamais NaN, jamais 0)', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge H');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Charge inconnue H', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-15', amountStatus: 'inconnu' })
        .expect(201);

      const list = await http.get('/charge-plans').set(...auth()).expect(200);
      const plan = list.body.find((p: any) => p.id === cp.body.id);
      expect(plan.deadlines[0].resteAPayer).toBeNull();
      expect(plan.deadlines[0].amountStatus).toBe('inconnu');
    });

    it('une charge avec plusieurs échéances passées payées et une prochaine échéance ouverte ne renvoie que la prochaine, avec son solde exact', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte G2', 5000);
      const cat = await newCategory(auth, 'Charge G2');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Internet G2', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-08-01', defaultAccountId: account })
        .expect(201);
      const paid = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-08-30', amountCurrent: 299, amountStatus: 'confirme' })
        .expect(201);
      await http
        .post(`/deadlines/${paid.body.id}/payments`)
        .set(...auth())
        .send({ amount: 299, accountId: account })
        .expect(201);
      // recalcFinancialStatus ne clôture jamais automatiquement (RG-014) : une
      // confirmation explicite est requise même à 100% payé.
      await http.post(`/deadlines/${paid.body.id}/close`).set(...auth()).expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: 349, amountStatus: 'confirme' })
        .expect(201);

      const list = await http.get('/charge-plans').set(...auth()).expect(200);
      const plan = list.body.find((p: any) => p.id === cp.body.id);
      expect(plan.deadlines).toHaveLength(1);
      expect(plan.deadlines[0].resteAPayer).toBe(349);
    });
  });

  // ============================================================
  // §1 — règle unique de récurrence pour les charges (Fréquence + Prochaine échéance)
  // ============================================================
  describe('§1 — ChargePlan.recurrenceAnchorDate ("prochaine échéance") pilote la génération, jamais un anchorDay séparé', () => {
    async function chargesDueDates(auth: () => [string, string], chargePlanId: string) {
      const list = await http.get(`/charge-plans/${chargePlanId}/deadlines`).set(...auth()).expect(200);
      return list.body.map((d: any) => String(d.dueDate).slice(0, 10)).sort();
    }

    it('C. charge mensuelle générée à partir de la prochaine échéance (jamais de startDate lorsqu\'une ancre est fournie)', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge C');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge mensuelle C',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'mensuel',
          startDate: '2020-01-01', // ancienne date de création, jamais utilisée pour la génération si une ancre est fournie
          recurrenceAnchorDate: '2026-09-27',
        })
        .expect(201);

      await http.get('/projection').query({ at: '2026-09-01', horizon: 100 }).set(...auth()).expect(200);

      const dueDates = await chargesDueDates(auth, cp.body.id);
      expect(dueDates).toEqual(['2026-09-27', '2026-10-27', '2026-11-27']);
    });

    it('D. charge annuelle générée à partir de la prochaine échéance', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge D');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge annuelle D',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'annuel',
          startDate: '2020-01-01',
          recurrenceAnchorDate: '2026-12-15',
        })
        .expect(201);

      await http.get('/projection').query({ at: '2026-01-01', horizon: 1100 }).set(...auth()).expect(200);

      const dueDates = await chargesDueDates(auth, cp.body.id);
      expect(dueDates).toEqual(['2026-12-15', '2027-12-15', '2028-12-15']);
    });

    it('E. charge trimestrielle générée à partir de la prochaine échéance', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge E');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge trimestrielle E',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'trimestriel',
          startDate: '2020-01-01',
          recurrenceAnchorDate: '2026-10-15',
        })
        .expect(201);

      await http.get('/projection').query({ at: '2026-10-01', horizon: 200 }).set(...auth()).expect(200);

      const dueDates = await chargesDueDates(auth, cp.body.id);
      expect(dueDates).toEqual(['2026-10-15', '2027-01-15', '2027-04-15']);
    });

    it('F. fin de mois : ancre le 31 janvier ne dérive jamais (février clampé, mars repart du 31 d\'origine)', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge F');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge fin de mois F',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'mensuel',
          startDate: '2020-01-01',
          recurrenceAnchorDate: '2027-01-31',
        })
        .expect(201);

      await http.get('/projection').query({ at: '2027-01-01', horizon: 100 }).set(...auth()).expect(200);

      const dueDates = await chargesDueDates(auth, cp.body.id);
      // 2027 n'est pas bissextile : février clampé à 28, mars repart de l'ancre
      // réelle (31), jamais de "28 + 1 mois" qui donnerait un 28 mars dérivé.
      expect(dueDates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    });
  });

  // ============================================================
  // §3 — édition d'une charge récurrente (montant/fréquence/prochaine échéance)
  // ============================================================
  describe('§3 — PATCH /charge-plans/:id — montant/fréquence/prochaine échéance jamais rétroactifs', () => {
    it('I. modifier le montant s\'applique aux échéances futures ouvertes, jamais à une échéance déjà payée', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte I', 5000);
      const cat = await newCategory(auth, 'Charge I');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Internet I', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-08-01', defaultAccountId: account })
        .expect(201);
      const septPaid = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-30', amountCurrent: 299, amountStatus: 'confirme' })
        .expect(201);
      await http.post(`/deadlines/${septPaid.body.id}/payments`).set(...auth()).send({ amount: 299, accountId: account }).expect(201);
      await http.post(`/deadlines/${septPaid.body.id}/close`).set(...auth()).expect(201);
      const octOpen = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-10-31', amountCurrent: 299, amountStatus: 'confirme' })
        .expect(201);

      await http
        .patch(`/charge-plans/${cp.body.id}`)
        .set(...auth())
        .send({ amountCurrent: 349, amountStatus: 'confirme' })
        .expect(200);

      const list = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      const sept = list.body.find((d: any) => d.id === septPaid.body.id);
      const oct = list.body.find((d: any) => d.id === octOpen.body.id);
      expect(Number(sept.amountCurrent)).toBe(299); // J. échéance déjà payée inchangée
      expect(Number(oct.amountCurrent)).toBe(349);
    });

    it('K. modifier la fréquence ne touche jamais l\'historique — seules les échéances ouvertes sans paiement sont régénérées', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte K', 5000);
      const cat = await newCategory(auth, 'Charge K');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge K',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'mensuel',
          startDate: '2020-01-01',
          recurrenceAnchorDate: '2026-09-27',
          defaultAccountId: account,
        })
        .expect(201);
      await http.get('/projection').query({ at: '2026-09-01', horizon: 100 }).set(...auth()).expect(200);
      const before = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      expect(before.body).toHaveLength(3); // 27/09, 27/10, 27/11 — toutes ouvertes, sans paiement

      // paie explicitement la première pour prouver qu'elle survit au changement de fréquence
      await http.post(`/deadlines/${before.body[0].id}/payments`).set(...auth()).send({ amount: before.body[0].amountCurrent ?? 100, accountId: account }).expect(201);

      await http
        .patch(`/charge-plans/${cp.body.id}`)
        .set(...auth())
        .send({ recurrenceRule: 'trimestriel' })
        .expect(200);

      const after = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      // la seule échéance payée doit toujours exister, inchangée
      expect(after.body.some((d: any) => d.id === before.body[0].id)).toBe(true);
      // les 2 échéances ouvertes sans paiement (27/10, 27/11, alignées sur l'ancienne
      // fréquence mensuelle) ont été supprimées — plus aucune trace de l'ancien calendrier
      expect(after.body.some((d: any) => d.id === before.body[1].id)).toBe(false);
      expect(after.body.some((d: any) => d.id === before.body[2].id)).toBe(false);
    });

    it('L. modifier la prochaine échéance change l\'ancre de génération future sans toucher l\'historique', async () => {
      const { auth } = await newHousehold();
      const cat = await newCategory(auth, 'Charge L');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({
          label: 'Charge L',
          categoryId: cat,
          generationMode: 'auto_frequence',
          recurrenceRule: 'mensuel',
          startDate: '2020-01-01',
          recurrenceAnchorDate: '2026-09-27',
        })
        .expect(201);
      await http
        .patch(`/charge-plans/${cp.body.id}`)
        .set(...auth())
        .send({ recurrenceAnchorDate: '2026-10-15' })
        .expect(200);

      await http.get('/projection').query({ at: '2026-09-01', horizon: 100 }).set(...auth()).expect(200);

      const list = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      const dueDates = list.body.map((d: any) => String(d.dueDate).slice(0, 10)).sort();
      expect(dueDates).toEqual(['2026-10-15', '2026-11-15']);
    });
  });

  // ============================================================
  // §4-9 — "Échéance/charge déjà payée"
  // ============================================================
  describe('§4-9 — échéance "déjà payée" (CAS A compte connu / CAS B compte inconnu)', () => {
    async function newChild(auth: () => [string, string], firstName: string) {
      const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'T' }).expect(201);
      return res.body.id as string;
    }

    it('M/S. CAS A — compte connu : reste à payer 0, compte historique conservé à titre d\'information, MAIS solde actuel jamais débité (corrections finales §1 CRITIQUE)', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'SG Adil', 10000);
      const cat = await newCategory(auth, 'Uniforme M');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme M', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);

      // paid_date choisie APRÈS la création du compte (donc après le snapshot déclaré à
      // la création) — même avec une date postérieure au snapshot, is_historical_import
      // exclut la ligne de account_current_balance : la preuve est robuste indépendamment
      // de la date, contrairement à l'ancien comportement (CAS A) qui n'était protégé que
      // par un paid_date antérieur au snapshot.
      const paidDate = '2030-01-01';
      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate, accountId: account } })
        .expect(201);

      expect(deadline.body.financialStatus).toBe('soldee'); // M. reste à payer 0
      expect(Number(deadline.body.amountCurrent)).toBe(3400);

      const detail = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
      expect(detail.body.resteAPayer).toBe(0);

      const payments = await http.get(`/deadlines/${deadline.body.id}/payments`).set(...auth()).expect(200);
      expect(payments.body).toHaveLength(1);
      expect(payments.body[0].accountId).toBe(account); // S. compte connu → conservé à titre d'information
      expect(String(payments.body[0].paidDate).slice(0, 10)).toBe(paidDate); // R. date réelle conservée

      // Corrections finales §1 (CRITIQUE) — le paiement a déjà eu lieu AVANT la reprise de
      // données : jamais un débit réel du solde ACTUEL de SG Adil aujourd'hui.
      const balance = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(Number(balance.body.currentBalance ?? balance.body.soldeCourant)).toBe(10000);
    });

    it('T. CAS B — compte inconnu : reste à payer 0 mais aucun débit artificiel du solde actuel d\'aucun compte', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte T', 10000);
      const cat = await newCategory(auth, 'Uniforme T');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme T', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01' })
        .expect(201);

      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25' } }) // pas de accountId
        .expect(201);

      expect(deadline.body.financialStatus).toBe('soldee');
      const detail = await http.get(`/deadlines/${deadline.body.id}`).set(...auth()).expect(200);
      expect(detail.body.resteAPayer).toBe(0);

      const payments = await http.get(`/deadlines/${deadline.body.id}/payments`).set(...auth()).expect(200);
      expect(payments.body[0].accountId).toBeNull();

      // Aucun compte du foyer n'a été débité — le seul compte existant garde son solde initial intact.
      const balance = await http.get(`/accounts/${account}`).set(...auth()).expect(200);
      expect(Number(balance.body.currentBalance ?? balance.body.soldeCourant)).toBe(10000);
    });

    it('N/O/U. une échéance "déjà payée" n\'apparaît jamais dans les échéances ouvertes ni reproposée dans "Payer"', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte N', 10000);
      const cat = await newCategory(auth, 'Uniforme N');
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme N', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', defaultAccountId: account })
        .expect(201);
      const deadline = await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-05', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const open = await http.get('/deadlines').set(...auth()).expect(200);
      expect(open.body.some((d: any) => d.id === deadline.body.id)).toBe(false); // U/N. jamais reproposée dans Payer

      const planDetail = await http.get(`/financial-plans`).set(...auth()).expect(200);
      // pas de FinancialPlan ici (ChargePlan non rattaché) — on vérifie simplement via
      // GET /charge-plans que la charge reste visible dans son plan (§ suivant traite le cas plan).
      const chargePlan = await http.get(`/charge-plans/${cp.body.id}`).set(...auth()).expect(200);
      expect(chargePlan.body.id).toBe(cp.body.id); // O. reste visible (jamais supprimée), juste hors "ouvertes"
    });

    it('P/Q — coût total du plan scolaire inclut le paiement historique ("déjà payé"), reste à payer/reste à financer non impactés', async () => {
      const { auth } = await newHousehold();
      const child = await newChild(auth, 'Wael');
      const account = await newAccount(auth, 'SG Adil', 50000);
      const cat = await newCategory(auth, 'Scolarité');

      const plan = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'Plan École Wael', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
        .expect(201);
      await http.post(`/financial-plans/${plan.body.id}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: child }).expect(201);

      // poste déjà payé (Uniforme, 3400 DH, payé le 25/08)
      const cpUniforme = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', financialPlanId: plan.body.id })
        .expect(201);
      await http
        .post(`/charge-plans/${cpUniforme.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-01', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      // poste encore ouvert (Réinscription, 5000 DH)
      const cpReinscription = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Réinscription', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', financialPlanId: plan.body.id })
        .expect(201);
      await http
        .post(`/charge-plans/${cpReinscription.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-10', amountCurrent: 5000, amountStatus: 'confirme' })
        .expect(201);

      const detail = await http.get(`/financial-plans/${plan.body.id}`).set(...auth()).expect(200);
      expect(detail.body.knownPlanCost).toBe(8400); // 3400 déjà payé + 5000 ouvert — coût total réel
      expect(detail.body.paidAmount).toBe(3400); // Q. apparaît dans "Déjà payé"
      expect(detail.body.remainingDue).toBe(5000); // P. n'entre pas dans le reste à payer/à financer — seul le poste ouvert compte
    });

    it('V. dupliquer un plan scolaire ne duplique jamais les paiements historiques réels ("déjà payé")', async () => {
      const { auth } = await newHousehold();
      const account = await newAccount(auth, 'Compte V', 10000);
      const cat = await newCategory(auth, 'Uniforme V');
      const plan = await http
        .post('/financial-plans')
        .set(...auth())
        .send({ label: 'Plan École V', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
        .expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Uniforme V', categoryId: cat, generationMode: 'calendrier_manuel', startDate: '2026-09-01', financialPlanId: plan.body.id })
        .expect(201);
      await http
        .post(`/charge-plans/${cp.body.id}/deadlines`)
        .set(...auth())
        .send({ dueDate: '2026-09-01', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } })
        .expect(201);

      const dup = await http.post(`/financial-plans/${plan.body.id}/duplicate`).set(...auth()).send({ label: 'Plan École V (copie)' }).expect(201);
      // la copie repart d'une échéance ouverte, avec le même montant connu, mais SANS le
      // paiement historique ni le statut soldé — jamais une duplication de l'historique réel.
      expect(dup.body.paidAmount).toBe(0);
      expect(dup.body.knownPlanCost).toBe(3400);
      expect(dup.body.remainingDue).toBe(3400);
    });

    it('§8 — POST /school-wizard : un poste "Déjà payé" crée directement une échéance soldée avec son historique', async () => {
      const { auth } = await newHousehold();
      const child = await newChild(auth, 'Wael');
      const account = await newAccount(auth, 'SG Adil', 20000);

      const res = await http
        .post('/school-wizard')
        .set(...auth())
        .send({
          label: 'École Wael 2026-2027',
          childIds: [child],
          periodStart: '2026-09-01',
          periodEnd: '2027-06-30',
          items: [
            { label: 'Uniforme', dueDate: '2026-09-01', alreadyPaid: { amount: 3400, paidDate: '2026-08-25', accountId: account } },
            { label: 'Réinscription', amount: 5000, dueDate: '2026-09-10' },
          ],
        })
        .expect(201);

      const uniformePlan = res.body.chargePlans.find((cp: any) => cp.label === 'Uniforme');
      const deadlines = await http.get(`/charge-plans/${uniformePlan.id}/deadlines`).set(...auth()).expect(200);
      expect(deadlines.body).toHaveLength(1);
      expect(deadlines.body[0].financialStatus).toBe('soldee');
      expect(deadlines.body[0].resteAPayer).toBe(0);

      const planDetail = await http.get(`/financial-plans/${res.body.financialPlan.id}`).set(...auth()).expect(200);
      expect(planDetail.body.knownPlanCost).toBe(8400);
      expect(planDetail.body.paidAmount).toBe(3400);
      expect(planDetail.body.remainingDue).toBe(5000);
    });
  });

  // ============================================================
  // §10-12 — Transfert récurrent (objet séparé, jamais une ChargePlan)
  // ============================================================
  describe('§10-12 — RecurringTransfer : jamais une charge, pilotage à 4 combinaisons, projection', () => {
    async function generatedTransfers(auth: () => [string, string], recurringTransferId: string) {
      const list = await http.get('/accounts/transfers').set(...auth()).expect(200);
      return list.body
        .filter((t: any) => t.recurringTransferId === recurringTransferId)
        .sort((a: any, b: any) => String(a.plannedDate).localeCompare(String(b.plannedDate)));
    }

    async function monthImpact(auth: () => [string, string], at: string, month: string) {
      const res = await http.get('/projection/monthly').query({ at, horizonMonths: 3 }).set(...auth()).expect(200);
      const bucket = res.body.months.find((m: any) => m.month === month);
      return bucket;
    }

    it('W. transfert récurrent piloté→piloté : généré en `prevu`, jamais une charge, 0 impact sur la trésorerie projetée', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant W', 10000, true);
      const dest = await newAccount(auth, 'Épargne W', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'Épargne W', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      const bucket = await monthImpact(auth, '2026-09-01', '2026-09');
      const transfers = await generatedTransfers(auth, rt.body.id);
      expect(transfers.length).toBeGreaterThan(0);
      expect(transfers[0].status).toBe('prevu');
      expect(bucket.planned_transfer_net_treasury_impact).toBe(0); // CAS A : les deux comptes sont pilotés, ça s'annule
      // jamais une charge : aucune ChargePlan créée, jamais compté dans les dépenses du mois
      expect(bucket.total_expense).toBe(0);
    });

    it('X. transfert récurrent piloté→hors pilotage : reste un TRANSFERT (jamais une dépense de consommation), réduit la trésorerie pilotée projetée', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Compte courant X', 10000, true);
      const dest = await newAccount(auth, 'Épargne perso Lamiaa X', 20000, false); // hors pilotage

      await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'Épargne Lamiaa', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      const bucket = await monthImpact(auth, '2026-09-01', '2026-09');
      expect(bucket.planned_transfer_net_treasury_impact).toBe(-1000);
      expect(bucket.total_expense).toBe(0); // jamais une dépense de consommation
    });

    it('Y. transfert récurrent hors pilotage→piloté : augmente la trésorerie pilotée projetée', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Compte hors pilotage Y', 20000, false);
      const dest = await newAccount(auth, 'Compte courant Y', 10000, true);

      await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'Réinjection Y', fromAccountId: source, toAccountId: dest, amount: 500, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      const bucket = await monthImpact(auth, '2026-09-01', '2026-09');
      expect(bucket.planned_transfer_net_treasury_impact).toBe(500);
    });

    it('Z. transfert récurrent hors pilotage→hors pilotage : 0 impact sur la trésorerie pilotée', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Hors pilotage A Z', 20000, false);
      const dest = await newAccount(auth, 'Hors pilotage B Z', 5000, false);

      await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'Z', fromAccountId: source, toAccountId: dest, amount: 300, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      const bucket = await monthImpact(auth, '2026-09-01', '2026-09');
      expect(bucket.planned_transfer_net_treasury_impact).toBe(0);
    });

    it('AA/AB. un transfert `prevu` ne modifie aucun solde réel ; une fois confirmé, il modifie les 2 comptes', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Courant AA', 10000, true);
      const dest = await newAccount(auth, 'Épargne AA', 2000, true);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'AA', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);
      await http.get('/projection').query({ at: '2026-09-01', horizon: 30 }).set(...auth()).expect(200);
      const [firstOccurrence] = await generatedTransfers(auth, rt.body.id);
      expect(firstOccurrence).toBeDefined();

      // AA — encore prévu : aucun solde réel modifié
      const beforeSource = await http.get(`/accounts/${source}`).set(...auth()).expect(200);
      const beforeDest = await http.get(`/accounts/${dest}`).set(...auth()).expect(200);
      expect(Number(beforeSource.body.soldeCourant)).toBe(10000);
      expect(Number(beforeDest.body.soldeCourant)).toBe(2000);

      // AB — confirmé explicitement : les 2 comptes bougent (moteur déjà existant, réutilisé tel quel)
      await http.post(`/accounts/transfers/${firstOccurrence.id}/confirm`).set(...auth()).expect(201);
      const afterSource = await http.get(`/accounts/${source}`).set(...auth()).expect(200);
      const afterDest = await http.get(`/accounts/${dest}`).set(...auth()).expect(200);
      expect(Number(afterSource.body.soldeCourant)).toBe(9000);
      expect(Number(afterDest.body.soldeCourant)).toBe(3000);
    });

    it('AD. aucune double comptabilisation : un transfert récurrent piloté→hors-pilotage n\'entre jamais dans revenus/dépenses, et sa génération est idempotente', async () => {
      const { auth } = await newHousehold();
      const source = await newAccount(auth, 'Compte courant AD', 10000, true);
      const dest = await newAccount(auth, 'Épargne perso AD', 20000, false);

      const rt = await http
        .post('/recurring-transfers')
        .set(...auth())
        .send({ label: 'AD', fromAccountId: source, toAccountId: dest, amount: 1000, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-09-28' })
        .expect(201);

      // appelée deux fois (deux endpoints différents déclenchent la même génération) — jamais de doublon
      await http.get('/projection').query({ at: '2026-09-01', horizon: 100 }).set(...auth()).expect(200);
      await http.get('/projection/monthly').query({ at: '2026-09-01', horizonMonths: 3 }).set(...auth()).expect(200);

      const transfers = await generatedTransfers(auth, rt.body.id);
      const septemberOccurrences = transfers.filter((t: any) => String(t.plannedDate).startsWith('2026-09'));
      expect(septemberOccurrences).toHaveLength(1); // jamais dupliqué (skipDuplicates)

      const bucket = await monthImpact(auth, '2026-09-01', '2026-09');
      expect(bucket.total_income).toBe(0);
      expect(bucket.total_expense).toBe(0); // jamais compté comme dépense de consommation
      expect(bucket.planned_transfer_net_treasury_impact).toBe(-1000); // impact réel, mais séparé, jamais fusionné
    });
  });
});
