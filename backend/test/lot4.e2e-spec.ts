import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests Lot 4 (docs/05-roadmap-et-risques.md, TEST 1-15 de la demande + test
 * oracle document 06 §10/§11 — mini-cas scolaire Yanis/Ines). Les valeurs
 * numériques du mini-cas (60 725 / 25 225 / 35 500 / 62 025 / 26 225 / 35 800)
 * sont reproduites EXACTEMENT — aucune formule n'est ajustée pour les faire
 * passer. Seuls provision_coverage/remaining_to_fund divergent volontairement
 * de doc06 (8 000/12 000/27 500/23 800) car Provision (Lot 6) n'existe pas
 * encore : conformément à RG-091, une échéance sans provision liée a
 * couverture_affectée=0, donc remaining_to_fund == remaining_due dans ce lot —
 * exactement le comportement anticipé par la demande Lot 4 §13.
 */
describe('Lot 4 — Charges planifiées & FinancialPlan / module scolaire (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let prisma: PrismaService;
  const run = Date.now();

  let accessToken: string;
  let accountId: string;
  let categoryId: string;
  let yanisId: string;
  let inesId: string;
  let planId: string;

  const deadlines: Record<string, string> = {};
  const chargePlans: Record<string, string> = {};

  const mailer = new FakeMailer();
  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
    prisma = app.get(PrismaService);

    const signupToken = await signupVerified(http, mailer, `lot4+${run}@example.com`, 'password123', 'L4', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: 'Foyer Lot4' })
      .expect(201);
    accessToken = household.body.accessToken;

    const account = await http.post('/accounts').set(...auth()).send({ name: 'Compte École', type: 'courant', initialBalance: 100000 }).expect(201);
    accountId = account.body.id;

    const category = await http.post('/categories').set(...auth()).send({ name: 'Scolarité', kind: 'expense' }).expect(201);
    categoryId = category.body.id;

    const yanis = await http.post('/children').set(...auth()).send({ firstName: 'Yanis', lastName: 'T' }).expect(201);
    yanisId = yanis.body.id;
    const ines = await http.post('/children').set(...auth()).send({ firstName: 'Ines', lastName: 'T' }).expect(201);
    inesId = ines.body.id;

    const plan = await http
      .post('/financial-plans')
      .set(...auth())
      .send({ label: 'École 2026/2027', periodStart: '2026-09-01', periodEnd: '2027-06-30' })
      .expect(201);
    planId = plan.body.id;
    await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: yanisId }).expect(201);
    await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: inesId }).expect(201);

    // §10.1 (doc06) — charges du plan, état au 30 septembre.
    await createItem('Scolarité T1', [yanisId], {
      dueDate: '2026-09-30',
      expectedBillingDate: '2026-09-14',
      billingDate: '2026-09-14',
      amountCurrent: 20000,
      amountStatus: 'confirme',
    });
    await createItem('Scolarité T2', [yanisId], {
      dueDate: '2027-01-28',
      expectedBillingDate: '2027-01-12',
      amountCurrent: 20000,
      amountStatus: 'estime',
    });
    await createItem('Scolarité T3', [yanisId], { dueDate: '2027-04-15', amountCurrent: 14500, amountStatus: 'estime' });
    await createItem('Restauration T1', [yanisId], { dueDate: '2026-09-30', amountCurrent: 1800, amountStatus: 'confirme' });
    await createItem('Restauration T2', [yanisId], { dueDate: '2027-01-28', expectedBillingDate: '2027-01-05', amountStatus: 'inconnu' });
    await createItem('Assurance continuité scolaire', [yanisId], { dueDate: '2026-09-30', amountCurrent: 1575, amountStatus: 'confirme' }, 'optionnelle_souscrite');
    await createItem('Uniforme Yanis', [yanisId], { dueDate: '2026-09-15', amountCurrent: 600, amountStatus: 'confirme' });
    await createItem('Uniforme Ines', [inesId], { dueDate: '2026-09-15', amountCurrent: 500, amountStatus: 'confirme' });
    await createItem('Fournitures Yanis', [yanisId], { dueDate: '2026-09-15', amountCurrent: 400, amountStatus: 'confirme' });
    await createItem('Fournitures Ines', [inesId], { dueDate: '2026-09-15', amountCurrent: 350, amountStatus: 'confirme' });
    await createItem('Garderie', [inesId], { dueDate: '2027-06-30', amountCurrent: 250, amountStatus: 'confirme' }, 'optionnelle_envisagee');
    await createItem('Sorties scolaires', [yanisId, inesId], { dueDate: '2026-10-20', amountCurrent: 1000, amountStatus: 'confirme' });

    // Paiements soldant T1, Restauration T1, Assurance, Uniformes, Fournitures (§10.1 : "soldée").
    await payAndClose('Scolarité T1', 20000);
    await payAndClose('Restauration T1', 1800);
    await payAndClose('Assurance continuité scolaire', 1575);
    await payAndClose('Uniforme Yanis', 600);
    await payAndClose('Uniforme Ines', 500);
    await payAndClose('Fournitures Yanis', 400);
    await payAndClose('Fournitures Ines', 350);
  });

  afterAll(async () => {
    await app.close();
  });

  function auth() {
    return ['Authorization', `Bearer ${accessToken}`] as [string, string];
  }

  async function createItem(
    label: string,
    childIds: string[],
    deadline: { dueDate: string; expectedBillingDate?: string; billingDate?: string; amountCurrent?: number; amountStatus: string },
    obligationStatus?: string,
  ) {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label, categoryId, generationMode: 'calendrier_manuel', obligationStatus, financialPlanId: planId, startDate: '2026-09-01', childIds })
      .expect(201);
    chargePlans[label] = cp.body.id;
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    deadlines[label] = d.body.id;
  }

  async function payAndClose(label: string, amount: number) {
    await http.post(`/deadlines/${deadlines[label]}/payments`).set(...auth()).send({ amount, accountId }).expect(201);
    await http.post(`/deadlines/${deadlines[label]}/close`).set(...auth()).expect(201);
  }

  // ---------- TEST 1 — dates de facturation ne déclenchent jamais un Payment ----------
  it("TEST 1 — expected_billing_date/due_date ne créent jamais de Payment automatique", async () => {
    const payments = await http.get(`/deadlines/${deadlines['Scolarité T2']}/payments`).set(...auth()).expect(200);
    expect(payments.body).toEqual([]);
    const deadline = await http.get(`/deadlines/${deadlines['Scolarité T2']}`).set(...auth()).expect(200);
    expect(deadline.body.expectedBillingDate).toContain('2027-01-12');
    expect(deadline.body.dueDate).toContain('2027-01-28');
    expect(deadline.body.financialStatus).toBe('ouverte');
  });

  // ---------- Snapshot A (30 septembre, doc06 §10.3) ----------
  it('Snapshot A (30 septembre) — known_plan_cost=60725, paid_amount=25225, remaining_due=35500, contient_inconnues', async () => {
    const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    expect(plan.body.knownPlanCost).toBe(60725);
    expect(plan.body.paidAmount).toBe(25225);
    expect(plan.body.remainingDue).toBe(35500);
    expect(plan.body.provisionCoverage).toBe(0); // Lot 6 non livré (RG-091 : sans provision, couverture=0)
    expect(plan.body.remainingToFund).toBe(35500); // == remaining_due tant qu'aucune Provision n'existe
    expect(plan.body.completude).toBe('contient_inconnues'); // Restauration T2
  });

  // ---------- TEST 3 / TEST 14 — montant inconnu, jamais 0, jamais prix×quantité ----------
  it("TEST 3/14 — Restauration T2 inconnue reste NULL, jamais 0, jamais calculée via prix repas × quantité", async () => {
    const deadline = await http.get(`/deadlines/${deadlines['Restauration T2']}`).set(...auth()).expect(200);
    expect(deadline.body.amountCurrent).toBeNull();
    expect(deadline.body.amountStatus).toBe('inconnu');
  });

  // ---------- TEST 2 — confirmation de facture (doc06 §10.4) ----------
  it('TEST 2 — 20 000 estimé → 21 300 confirmé : estimation initiale conservée, reste_a_payer recalculé', async () => {
    const before = await http.get(`/deadlines/${deadlines['Scolarité T2']}`).set(...auth()).expect(200);
    expect(Number(before.body.resteAPayer)).toBe(20000);

    const confirmed = await http
      .patch(`/deadlines/${deadlines['Scolarité T2']}`)
      .set(...auth())
      .send({ billingDate: '2027-01-12', amountCurrent: 21300, amountStatus: 'confirme' })
      .expect(200);
    expect(Number(confirmed.body.amountInitialEstimated)).toBe(20000); // jamais perdue
    expect(Number(confirmed.body.amountCurrent)).toBe(21300);
    expect(confirmed.body.confirmedAt).not.toBeNull();
    expect(Number(confirmed.body.resteAPayer)).toBe(21300); // recalculé immédiatement (IF-21)

    // Toujours aucun Payment créé par la seule confirmation du montant.
    const payments = await http.get(`/deadlines/${deadlines['Scolarité T2']}/payments`).set(...auth()).expect(200);
    expect(payments.body).toEqual([]);
  });

  it('Sorties scolaires réglée entre les deux snapshots (doc06 §10.4)', async () => {
    await payAndClose('Sorties scolaires', 1000);
  });

  // ---------- Snapshot B (12 janvier, doc06 §10.4) ----------
  it('Snapshot B (12 janvier) — known_plan_cost=62025, paid_amount=26225, remaining_due=35800', async () => {
    const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    expect(plan.body.knownPlanCost).toBe(62025);
    expect(plan.body.paidAmount).toBe(26225);
    expect(plan.body.remainingDue).toBe(35800); // T2 21300 + T3 14500
    expect(plan.body.remainingToFund).toBe(35800);
    expect(plan.body.completude).toBe('contient_inconnues'); // Restauration T2 toujours inconnue
  });

  // ---------- TEST 9 (doc06) — charge soldée : known_plan_cost += montant, remaining_due += 0 (IF-28) ----------
  it('TEST 9 (oracle) — Scolarité T1 soldée contribue 20000 à known_plan_cost mais 0 à remaining_due', async () => {
    const deadline = await http.get(`/deadlines/${deadlines['Scolarité T1']}`).set(...auth()).expect(200);
    expect(deadline.body.financialStatus).toBe('soldee');
    expect(Number(deadline.body.resteAPayer)).toBe(0);
    const plan = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    const t1 = plan.body.deadlinesCertain.find((d: { id: string }) => d.id === deadlines['Scolarité T1']);
    expect(t1.resteAPayer).toBe(0);
  });

  // ---------- TEST 15 — vue enfant, charge commune non ventilée : aucun double comptage ----------
  it('TEST 15 — la vue enfant ne double jamais compter une charge commune sans ventilation', async () => {
    const yanis = await http.get(`/children/${yanisId}/costs`).set(...auth()).expect(200);
    expect(yanis.body.coutConnu).toBe(60175); // T1 20000 + T2 21300 + T3 14500 + RestoT1 1800 + Assurance 1575 + UniformeY 600 + FournituresY 400
    expect(yanis.body.chargesCommunesNonVentilees.some((c: { label: string }) => c.label === 'Sorties scolaires')).toBe(true);

    const ines = await http.get(`/children/${inesId}/costs`).set(...auth()).expect(200);
    expect(ines.body.coutConnu).toBe(850); // UniformeI 500 + FournituresI 350 (Garderie envisagée exclue, Sorties non ventilée)
    expect(ines.body.chargesCommunesNonVentilees.some((c: { label: string }) => c.label === 'Sorties scolaires')).toBe(true);

    // Preuve qu'aucun double Payment n'existe pour Sorties scolaires (un seul mouvement réel).
    const payments = await http.get(`/deadlines/${deadlines['Sorties scolaires']}/payments`).set(...auth()).expect(200);
    expect(payments.body).toHaveLength(1);
  });

  // ---------- TEST 5 / TEST 6 — obligation_status : envisagée hors portée certaine, souscrite y entre ----------
  it("TEST 5/6 — Garderie optionnelle_envisagée reste hors known_plan_cost, puis y entre après passage en souscrite", async () => {
    const before = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    const knownBefore = before.body.knownPlanCost;
    expect(before.body.envisagedTotal).toBe(250);
    expect(before.body.envisagedItems.some((i: { label: string }) => i.label === 'Garderie')).toBe(true);
    const garderieCertaine = before.body.deadlinesCertain.some((d: { id: string }) => d.id === deadlines['Garderie']);
    expect(garderieCertaine).toBe(false); // hors portée certaine (RG-106)

    await http.patch(`/charge-plans/${chargePlans['Garderie']}`).set(...auth()).send({ obligationStatus: 'optionnelle_souscrite' }).expect(200);

    const after = await http.get(`/financial-plans/${planId}`).set(...auth()).expect(200);
    expect(after.body.knownPlanCost).toBe(knownBefore + 250); // entre dans la portée certaine (RG-108)
    const garderieCertaineAfter = after.body.deadlinesCertain.some((d: { id: string }) => d.id === deadlines['Garderie']);
    expect(garderieCertaineAfter).toBe(true);
  });

  // ---------- TEST 7 / TEST 8 — charge commune 40000, ventilation valide, un seul Payment réel ----------
  let reinscriptionDeadlineId: string;
  it('TEST 7/8 — charge commune 40000 : une seule Deadline, ventilation 20k+20k acceptée, un seul Payment réel', async () => {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Réinscription groupée 2026/2027', generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [yanisId, inesId] })
      .expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-15', amountCurrent: 40000 }).expect(201);
    reinscriptionDeadlineId = d.body.id;

    await http.post(`/deadlines/${reinscriptionDeadlineId}/allocations`).set(...auth()).send({ childId: yanisId, allocationAmount: 20000 }).expect(201);
    await http.post(`/deadlines/${reinscriptionDeadlineId}/allocations`).set(...auth()).send({ childId: inesId, allocationAmount: 20000 }).expect(201);

    await http.post(`/deadlines/${reinscriptionDeadlineId}/payments`).set(...auth()).send({ amount: 40000, accountId }).expect(201);
    const payments = await http.get(`/deadlines/${reinscriptionDeadlineId}/payments`).set(...auth()).expect(200);
    expect(payments.body).toHaveLength(1); // un seul Payment réel — jamais deux (IF-26)
  });

  // ---------- TEST 10 (Lot4) — baisse du montant après ventilation 20k+20k → refus ----------
  it('TEST 10 — baisser amount_current à 35000 après une ventilation 20k+20k=40k est refusé', async () => {
    await http.patch(`/deadlines/${reinscriptionDeadlineId}`).set(...auth()).send({ amountCurrent: 35000 }).expect(400);
    // La Deadline reste inchangée (35000 n'a jamais été appliqué silencieusement).
    const deadline = await http.get(`/deadlines/${reinscriptionDeadlineId}`).set(...auth()).expect(200);
    expect(Number(deadline.body.amountCurrent)).toBe(40000);
  });

  // ---------- TEST 9 (Lot4) — ventilation 30k+30k sur 40k → refusée ----------
  it('TEST 9 — ventilation 30000+30000 sur une facture de 40000 est refusée (RG-116bis)', async () => {
    const cp = await http
      .post('/charge-plans')
      .set(...auth())
      .send({ label: 'Réinscription bis', generationMode: 'calendrier_manuel', startDate: '2026-09-01', childIds: [yanisId, inesId] })
      .expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-09-15', amountCurrent: 40000 }).expect(201);

    await http.post(`/deadlines/${d.body.id}/allocations`).set(...auth()).send({ childId: yanisId, allocationAmount: 30000 }).expect(201);
    await http.post(`/deadlines/${d.body.id}/allocations`).set(...auth()).send({ childId: inesId, allocationAmount: 30000 }).expect(400);
  });

  // ---------- TEST 12 — doublon FinancialPlanBeneficiary sur le même enfant ----------
  it('TEST 12 — un même enfant ne peut pas être ajouté deux fois comme bénéficiaire du même FinancialPlan', async () => {
    await http.post(`/financial-plans/${planId}/beneficiaries`).set(...auth()).send({ beneficiaryType: 'child', childId: yanisId }).expect(409);
  });

  // ---------- TEST 13 — bénéficiaire d'un autre foyer refusé ----------
  it("TEST 13 — un enfant d'un autre foyer ne peut pas devenir bénéficiaire de ce FinancialPlan", async () => {
    const strangerToken = await signupVerified(http, mailer, `strangerL4+${run}@example.com`, 'password123', 'S', 'T');
    const strangerHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ name: 'Foyer étranger L4' })
      .expect(201);
    const strangerAuth = ['Authorization', `Bearer ${strangerHousehold.body.accessToken}`] as [string, string];
    const strangerChild = await http.post('/children').set(...strangerAuth).send({ firstName: 'Autre', lastName: 'Enfant' }).expect(201);

    await http
      .post(`/financial-plans/${planId}/beneficiaries`)
      .set(...auth())
      .send({ beneficiaryType: 'child', childId: strangerChild.body.id })
      .expect(404);
  });

  // ---------- Isolation stricte par foyer (RLS) ----------
  it('un utilisateur extérieur ne peut ni lire ni modifier le FinancialPlan, ses ChargePlan ni ses allocations', async () => {
    const strangerToken = await signupVerified(http, mailer, `strangerL4b+${run}@example.com`, 'password123', 'S', 'B');
    const strangerHousehold = await http
      .post('/households')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ name: 'Foyer étranger L4b' })
      .expect(201);
    const strangerAuth = ['Authorization', `Bearer ${strangerHousehold.body.accessToken}`] as [string, string];

    await http.get(`/financial-plans/${planId}`).set(...strangerAuth).expect(404);
    await http.patch(`/charge-plans/${chargePlans['Garderie']}`).set(...strangerAuth).send({ obligationStatus: 'obligatoire' }).expect(404);
    await http.get(`/deadlines/${reinscriptionDeadlineId}/allocations`).set(...strangerAuth).expect(404);

    const rows = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${strangerHousehold.body.household.id}, true)`;
      const fp = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "financial_plan" WHERE id = ${planId}`;
      const dca = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "deadline_child_allocation" WHERE deadline_id = ${reinscriptionDeadlineId}`;
      return { fp, dca };
    });
    expect(rows.fp).toHaveLength(0);
    expect(rows.dca).toHaveLength(0);
  });
});
