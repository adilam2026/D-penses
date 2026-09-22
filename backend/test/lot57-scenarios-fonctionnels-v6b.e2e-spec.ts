import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Refonte maquette V6B — les 6 scénarios fonctionnels obligatoires du cahier
 * des charges, exécutés explicitement avec les montants donnés en exemple
 * (jamais une simple référence à des tests "similaires" existants).
 */
describe('V6B — 6 scénarios fonctionnels obligatoires (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot57+${run}+${seq}@example.com`, 'password123', 'L57', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer scénarios ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newAccount(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/accounts').set(...auth()).send({ type: 'courant', initialBalance: 0, ...body }).expect(201);
    return res.body;
  }

  async function newCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function newChargePlanAndDeadline(auth: () => [string, string], opts: { dueDate: string; amountCurrent: number; label?: string }) {
    const plan = await http.post('/charge-plans').set(...auth()).send({ label: opts.label ?? 'Charge test', startDate: opts.dueDate }).expect(201);
    const deadline = await http
      .post(`/charge-plans/${plan.body.id}/deadlines`)
      .set(...auth())
      .send({ dueDate: opts.dueDate, amountCurrent: opts.amountCurrent })
      .expect(201);
    return { chargePlanId: plan.body.id as string, deadlineId: deadline.body.id as string };
  }

  // ================================================================
  // SCÉNARIO 1 — Compte + enveloppes (jamais additif)
  // ================================================================
  it('SCÉNARIO 1 — Compte CIH 8000 DH + enveloppes Scolarité 5000/Voyage 1500/Voiture 1500 → solde = 8000 DH, jamais 16000', async () => {
    const { auth } = await newHousehold();
    const cih = await newAccount(auth, { name: 'CIH', bankName: 'CIH', initialBalance: 8000 });

    for (const [name, amount] of [
      ['Scolarité', 5000],
      ['Voyage', 1500],
      ['Voiture', 1500],
    ] as const) {
      const pocket = await http
        .post('/pockets')
        .set(...auth())
        .send({ name, allocationMode: 'virtual_allocation', linkedAccountId: cih.id })
        .expect(201);
      await http.post(`/pockets/${pocket.body.id}/contribute`).set(...auth()).send({ amount, confirmed: true }).expect(201);
    }

    const detail = await http.get(`/accounts/${cih.id}`).set(...auth()).expect(200);
    expect(detail.body.soldeCourant).toBe(8000);
    expect(detail.body.soldeCourant).not.toBe(16000);
    expect(detail.body.reservedByEnvelopes).toBe(8000);
    expect(detail.body.envelopes).toHaveLength(3);
  });

  // ================================================================
  // SCÉNARIO 2 — Transfert entre comptes (jamais une dépense/un revenu)
  // ================================================================
  it('SCÉNARIO 2 — BP 10000 / CIH 5000, transfert BP→CIH 2000 → BP=8000, CIH=7000, patrimoine total inchangé (15000)', async () => {
    const { auth } = await newHousehold();
    const bp = await newAccount(auth, { name: 'BP', initialBalance: 10000 });
    const cih = await newAccount(auth, { name: 'CIH', initialBalance: 5000 });

    const before = await http.get('/accounts').set(...auth()).expect(200);
    const patrimoineAvant = before.body.reduce((s: number, a: any) => s + a.soldeCourant, 0);
    expect(patrimoineAvant).toBe(15000);

    const transfer = await http
      .post('/accounts/transfers')
      .set(...auth())
      .send({ fromAccountId: bp.id, toAccountId: cih.id, amount: 2000 })
      .expect(201);
    expect(transfer.body.balancesAfter[bp.id]).toBe(8000);
    expect(transfer.body.balancesAfter[cih.id]).toBe(7000);

    const bpAfter = await http.get(`/accounts/${bp.id}`).set(...auth()).expect(200);
    const cihAfter = await http.get(`/accounts/${cih.id}`).set(...auth()).expect(200);
    expect(bpAfter.body.soldeCourant).toBe(8000);
    expect(cihAfter.body.soldeCourant).toBe(7000);

    const after = await http.get('/accounts').set(...auth()).expect(200);
    const patrimoineApres = after.body.reduce((s: number, a: any) => s + a.soldeCourant, 0);
    expect(patrimoineApres).toBe(15000);
    expect(patrimoineApres).toBe(patrimoineAvant);
  });

  // ================================================================
  // SCÉNARIO 3 — Charge planifiée → réelle (jamais d'impact avant paiement)
  // ================================================================
  it('SCÉNARIO 3 — LYDEC planifiée 850 DH : solde inchangé avant paiement, solde-850 + transaction réelle + statut Payée après "Payer"', async () => {
    const { auth } = await newHousehold();
    const compte = await newAccount(auth, { name: 'Compte courant', initialBalance: 4000 });
    const { deadlineId } = await newChargePlanAndDeadline(auth, { dueDate: '2026-11-05', amountCurrent: 850, label: 'LYDEC' });

    // Avant paiement — la charge est "Prévue"/"À payer" mais n'a jamais touché le solde réel.
    const before = await http.get(`/accounts/${compte.id}`).set(...auth()).expect(200);
    expect(before.body.soldeCourant).toBe(4000);
    const deadlineBefore = await http.get(`/deadlines/${deadlineId}`).set(...auth()).expect(200);
    expect(deadlineBefore.body.financialStatus).toBe('ouverte');

    // Clic "Payer" — paiement réel intégral.
    const payment = await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...auth())
      .send({ amount: 850, accountId: compte.id })
      .expect(201);
    expect(payment.body.soldeCourant).toBe(3150);
    expect(Number(payment.body.deadline.resteAPayer)).toBe(0);

    const after = await http.get(`/accounts/${compte.id}`).set(...auth()).expect(200);
    expect(after.body.soldeCourant).toBe(3150);

    // Une transaction réelle (Payment) apparaît bien dans l'historique du compte.
    const history = await http.get('/transactions').set(...auth()).query({ accountId: compte.id }).expect(200);
    expect(history.body.some((t: any) => t.kind === 'payment' && t.amount === -850)).toBe(true);

    // La clôture explicite passe le statut à "Payée" (soldée) — jamais automatique sans action.
    const closed = await http.post(`/deadlines/${deadlineId}/close`).set(...auth()).expect(201);
    expect(closed.body.financialStatus).toBe('soldee');
  });

  // ================================================================
  // SCÉNARIO 4 — Plan financier à échéances : recalcul dynamique mois par mois
  // ================================================================
  describe('SCÉNARIO 4 — Plan Scolarité, échéance 30000 DH le 31/01/2027', () => {
    it('4a. versement réel (3000) inférieur au prévu → la mensualité recommandée pour les mois suivants AUGMENTE', async () => {
      const { auth } = await newHousehold();
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Scolarité', allocationMode: 'virtual_allocation' }).expect(201);
      const { deadlineId } = await newChargePlanAndDeadline(auth, { dueDate: '2027-01-31', amountCurrent: 30000, label: 'Scolarité T1-T3' });
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      // T0 — avant tout versement : mensualité "prévue" de référence.
      const t0 = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2026-08-22' }).expect(200);
      const prevu = t0.body.versementMensuelRecommande as number;
      expect(prevu).toBeGreaterThan(0);

      // Un mois plus tard : seulement 3000 DH réellement versés (au lieu du prévu).
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 3000, confirmed: true }).expect(201);
      const t1 = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2026-09-22' }).expect(200);
      expect(t1.body.currentAmount).toBe(3000);
      const recalcule = t1.body.versementMensuelRecommande as number;

      // Le manque à rattraper (moins de temps, moins d'argent disponible) augmente la mensualité recommandée.
      expect(recalcule).toBeGreaterThan(prevu);

      // Le calendrier mensuel nommé (Octobre/Novembre/Décembre/Janvier) reflète ce même recalcul,
      // jamais un montant unique global — et somme exactement le manque restant (27000 DH).
      expect(Array.isArray(t1.body.monthlyCalendar)).toBe(true);
      const months = t1.body.monthlyCalendar.map((m: any) => m.month);
      expect(months).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
      const total = t1.body.monthlyCalendar.reduce((s: number, m: any) => s + m.recommendedAmount, 0);
      expect(Math.round(total * 100) / 100).toBe(27000);
    });

    it('4b. versement réel (7000) supérieur au prévu → la mensualité recommandée pour les mois suivants DIMINUE', async () => {
      const { auth } = await newHousehold();
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Scolarité', allocationMode: 'virtual_allocation' }).expect(201);
      const { deadlineId } = await newChargePlanAndDeadline(auth, { dueDate: '2027-01-31', amountCurrent: 30000, label: 'Scolarité T1-T3' });
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId }).expect(201);

      const t0 = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2026-08-22' }).expect(200);
      const prevu = t0.body.versementMensuelRecommande as number;

      // Versement supérieur au prévu (7000 au lieu de ~5000).
      await http.post(`/provisions/${provision.body.id}/contribute`).set(...auth()).send({ amount: 7000, confirmed: true }).expect(201);
      const t1 = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2026-09-22' }).expect(200);
      const recalcule = t1.body.versementMensuelRecommande as number;

      expect(recalcule).toBeLessThan(prevu);
    });

    it("4c. après paiement/clôture de l'échéance de janvier, le plan bascule automatiquement sur la suivante (avril) sans redemander le montant déjà couvert", async () => {
      const { auth } = await newHousehold();
      const compte = await newAccount(auth, { name: 'Compte scolarité', initialBalance: 40000 });
      const provision = await http.post('/provisions').set(...auth()).send({ name: 'Scolarité', allocationMode: 'virtual_allocation' }).expect(201);

      const { deadlineId: janvier } = await newChargePlanAndDeadline(auth, { dueDate: '2027-01-31', amountCurrent: 30000, label: 'Scolarité T1-T3' });
      const { deadlineId: avril } = await newChargePlanAndDeadline(auth, { dueDate: '2027-04-30', amountCurrent: 12000, label: 'Scolarité T4' });
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: janvier }).expect(201);
      await http.post(`/provisions/${provision.body.id}/deadlines`).set(...auth()).send({ deadlineId: avril }).expect(201);

      // Les deux échéances sont visibles tant que janvier n'est pas soldée.
      const before = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2026-09-22' }).expect(200);
      expect(before.body.steps.map((s: any) => s.deadlineId)).toEqual([janvier, avril]);

      // L'échéance de janvier est payée intégralement puis clôturée.
      await http.post(`/deadlines/${janvier}/payments`).set(...auth()).send({ amount: 30000, accountId: compte.id }).expect(201);
      const closed = await http.post(`/deadlines/${janvier}/close`).set(...auth()).expect(201);
      expect(closed.body.financialStatus).toBe('soldee');

      // Bascule automatique : seule l'échéance d'avril reste dans le plan, jamais janvier redemandé.
      const after = await http.get(`/provisions/${provision.body.id}/sufficiency`).set(...auth()).query({ at: '2027-02-01' }).expect(200);
      expect(after.body.steps).toHaveLength(1);
      expect(after.body.steps[0].deadlineId).toBe(avril);
      const monthsAfter = after.body.monthlyCalendar.map((m: any) => m.month);
      expect(monthsAfter.every((m: string) => m >= '2027-03')).toBe(true);
    });
  });

  // ================================================================
  // SCÉNARIO 5 — Dépense Santé remboursable par mutuelle
  // ================================================================
  it('SCÉNARIO 5 — Consultation 500 DH, catégorie Santé, remboursable=Oui → transaction réelle -500, dossier mutuelle engagé=500, aucun revenu créé', async () => {
    const { auth } = await newHousehold();
    const compte = await newAccount(auth, { name: 'Compte courant', initialBalance: 5000 });
    const sante = await newCategory(auth, 'Santé');

    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 500, accountId: compte.id, categoryId: sante, label: 'Consultation', spentDate: '2026-09-25', remboursableMutuelle: true })
      .expect(201);

    expect(expense.body.soldeCourant).toBe(4500); // -500
    expect(expense.body.medicalClaim.amountEngaged).toBe(500);
    expect(expense.body.medicalClaim.status).toBe('en_attente');

    const history = await http.get('/transactions').set(...auth()).query({ accountId: compte.id }).expect(200);
    expect(history.body.some((t: any) => t.amount === -500)).toBe(true);

    // Aucun revenu (futur ou présent) n'est créé par une simple dépense remboursable.
    const incomes = await http.get('/income-sources').set(...auth()).expect(200);
    expect(incomes.body).toEqual([]);
  });

  // ================================================================
  // SCÉNARIO 6 — Clôture du remboursement mutuelle
  // ================================================================
  it('SCÉNARIO 6 — engagé 500 / remboursé 420 → compte +420, reste à charge = 80, aucune IncomeOccurrence ; remboursement total (500/500) → statut clôturé', async () => {
    const { auth } = await newHousehold();
    const compteDepense = await newAccount(auth, { name: 'Compte courant', initialBalance: 5000 });
    const compteBeneficiaire = await newAccount(auth, { name: 'Compte remboursement', initialBalance: 0 });
    const sante = await newCategory(auth, 'Santé');

    const expense = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 500, accountId: compteDepense.id, categoryId: sante, label: 'Consultation', spentDate: '2026-09-25', remboursableMutuelle: true })
      .expect(201);
    const claimId = expense.body.medicalClaim.id as string;

    // Remboursement partiel.
    const closedPartiel = await http
      .post(`/medical-claims/${claimId}/close`)
      .set(...auth())
      .send({ amountReceived: 420, reimbursementDate: '2026-10-12', reimbursementAccountId: compteBeneficiaire.id })
      .expect(201);
    expect(closedPartiel.body.claim.amountReimbursed).toBe(420);
    expect(closedPartiel.body.claim.resteACharge).toBe(80);
    expect(closedPartiel.body.claim.status).toBe('partiellement_rembourse');

    const beneficiaire = await http.get(`/accounts/${compteBeneficiaire.id}`).set(...auth()).expect(200);
    expect(beneficiaire.body.soldeCourant).toBe(420);

    const incomes = await http.get('/income-sources').set(...auth()).expect(200);
    expect(incomes.body).toEqual([]);

    // Remboursement total (autre dossier) : 500/500 → statut clôturé.
    const expense2 = await http
      .post('/expenses')
      .set(...auth())
      .send({ amount: 500, accountId: compteDepense.id, categoryId: sante, label: 'Pharmacie', spentDate: '2026-09-26', remboursableMutuelle: true })
      .expect(201);
    const claimId2 = expense2.body.medicalClaim.id as string;

    const closedTotal = await http
      .post(`/medical-claims/${claimId2}/close`)
      .set(...auth())
      .send({ amountReceived: 500, reimbursementDate: '2026-10-13', reimbursementAccountId: compteBeneficiaire.id })
      .expect(201);
    expect(closedTotal.body.claim.amountReimbursed).toBe(500);
    expect(closedTotal.body.claim.resteACharge).toBe(0);
    expect(closedTotal.body.claim.status).toBe('cloture');
  });
});
