import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';

/**
 * Lot 9 — Suite de recette V1 (§8/§28-30 : scénarios A-P). Aucune règle métier
 * nouvelle : cette suite REJOUE le comportement des Lots 2-8 sur un scénario
 * familial réaliste et vérifie la cohérence transverse entre écrans/moteurs
 * (Dashboard/Projection/Simulateur/Plans/Provisions), la persistance, l'isolation
 * multi-foyer par ID connu, et la pureté du simulateur — jamais une réécriture
 * d'un oracle existant pour forcer un passage (§31).
 */
describe('Lot 9 — Recette V1 (scénario familial complet, A-P) (e2e)', () => {
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

  // ---------- Aides communes (mêmes conventions que test/lot6-8.e2e-spec.ts) ----------

  /** Le JWT d'accès porte déjà `sub` (userId) — signup/login ne renvoient pas d'objet `user` séparé. */
  function userIdFromToken(accessToken: string): string {
    const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'));
    return payload.sub as string;
  }

  async function signup(label: string) {
    seq += 1;
    const email = `lot9+${run}+${seq}@example.com`;
    await http
      .post('/auth/signup')
      .send({ email, password: 'password123', firstName: label, lastName: 'T' })
      .expect(201);
    const code = mailer.lastCodeFor(email);
    const verified = await http.post('/auth/verify-email-otp').send({ email, code }).expect(200);
    const accessToken = verified.body.accessToken as string;
    return { userId: userIdFromToken(accessToken), accessToken };
  }

  async function newHousehold(name = 'Foyer') {
    const owner = await signup('Adulte1');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: `${name} ${seq}` })
      .expect(201);
    let accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return {
      householdId: household.body.household.id as string,
      userId: owner.userId,
      auth,
      setToken: (t: string) => (accessToken = t),
      email: `lot9+${run}+${seq}@example.com`,
    };
  }

  async function login(email: string) {
    const res = await http.post('/auth/login').send({ email, password: 'password123' }).expect(200);
    return res.body.accessToken as string;
  }

  async function inviteSecondAdult(h: { auth: () => [string, string] }) {
    const invite = await http.post('/households/invites').set(...h.auth()).send({ role: 'admin' }).expect(201);
    const second = await signup('Adulte2');
    const joined = await http
      .post('/households/join')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .send({ code: invite.body.code })
      .expect(201);
    const accessToken = joined.body.accessToken as string;
    return { userId: second.userId, auth: () => ['Authorization', `Bearer ${accessToken}`] as [string, string] };
  }

  async function createAccount(auth: () => [string, string], name: string, type: string, initialBalance: number, includeInOperationalTreasury = true) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type, initialBalance, includeInOperationalTreasury }).expect(201);
    return res.body.id as string;
  }

  async function createChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'Enfant' }).expect(201);
    return res.body.id as string;
  }

  async function createIncomeSource(auth: () => [string, string], accountId: string, label: string, amount: number) {
    const res = await http.post('/income-sources').set(...auth()).send({ label, usualAmount: amount, defaultAccountId: accountId }).expect(201);
    return res.body.id as string;
  }

  async function createOccurrence(auth: () => [string, string], sourceId: string, usualDate: string, plannedAmount?: number) {
    const res = await http.post(`/income-sources/${sourceId}/occurrences`).set(...auth()).send({ usualDate, plannedAmount }).expect(201);
    return res.body.id as string;
  }

  async function confirmOccurrence(auth: () => [string, string], occurrenceId: string, actualAmount: number, accountId?: string) {
    return http.post(`/income-occurrences/${occurrenceId}/confirm`).set(...auth()).send({ actualAmount, accountId }).expect(201);
  }

  async function createChargePlanDeadline(auth: () => [string, string], label: string, deadline: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    const cp = await http.post('/charge-plans').set(...auth()).send({ label, generationMode: 'calendrier_manuel', startDate: '2020-01-01', ...extra }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createProvision(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/provisions').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function contribute(auth: () => [string, string], provisionId: string, amount: number, confirmed = true) {
    return http.post(`/provisions/${provisionId}/contribute`).set(...auth()).send({ amount, confirmed }).expect(201);
  }

  async function createGoal(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/goals').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  async function getDashboard(auth: () => [string, string], at?: string) {
    return http.get('/dashboard/summary').set(...auth()).query(at ? { at } : {}).expect(200);
  }

  async function getProjection(auth: () => [string, string], at: string, horizon: number) {
    return http.get('/projection').set(...auth()).query({ at, horizon }).expect(200);
  }

  async function simulatePurchase(auth: () => [string, string], at: string, body: Record<string, unknown>) {
    return http.post('/simulation/purchase').set(...auth()).query({ at }).send(body).expect(201);
  }

  /** Instantané via l'API authentifiée uniquement (§29/IF-10 — cf. justification dans lot8.e2e-spec.ts). */
  async function snapshotHousehold(h: { auth: () => [string, string] }) {
    const [accounts, transactions, deadlines, children, plans] = await Promise.all([
      http.get('/accounts').set(...h.auth()).expect(200),
      http.get('/transactions').set(...h.auth()).expect(200),
      http.get('/deadlines').set(...h.auth()).expect(200),
      http.get('/children').set(...h.auth()).expect(200),
      http.get('/financial-plans').set(...h.auth()).expect(200),
    ]);
    return { accounts: accounts.body, transactions: transactions.body, deadlines: deadlines.body, children: children.body, plans: plans.body };
  }

  // =========================================================================
  // SCÉNARIO A — Foyer complet : création, second adulte, enfants, comptes,
  // soldes, persistance après reconnexion (§1/§28.A).
  // =========================================================================
  it('A — foyer complet : 2 adultes, 2 enfants, 5 comptes, soldes corrects, persiste après reconnexion', async () => {
    const h = await newHousehold('Famille Alami');
    const second = await inviteSecondAdult(h);

    const wael = await createChild(h.auth, 'Wael');
    const dina = await createChild(h.auth, 'Dina');

    const courant = await createAccount(h.auth, 'Compte courant', 'courant', 50000);
    const especes = await createAccount(h.auth, 'Espèces', 'especes', 1500);
    const epargne = await createAccount(h.auth, 'Épargne famille', 'epargne', 30000);
    const epargneWael = await createAccount(h.auth, 'Épargne Wael', 'epargne', 4000, false);
    const epargneDina = await createAccount(h.auth, 'Épargne Dina', 'epargne', 2500, false);

    // Reconnexion : nouvelle session (login), jamais le même token — simule fermeture/réouverture de l'app.
    const freshToken = await login(h.email);
    h.setToken(freshToken);

    const accountsRes = await http.get('/accounts').set(...h.auth()).expect(200);
    const balances = Object.fromEntries(accountsRes.body.map((a: { id: string; soldeCourant: number }) => [a.id, a.soldeCourant]));
    expect(balances[courant]).toBe(50000);
    expect(balances[especes]).toBe(1500);
    expect(balances[epargne]).toBe(30000);
    expect(balances[epargneWael]).toBe(4000);
    expect(balances[epargneDina]).toBe(2500);
    expect(accountsRes.body).toHaveLength(5);

    const childrenRes = await http.get('/children').set(...h.auth()).expect(200);
    expect(childrenRes.body.map((c: { id: string }) => c.id).sort()).toEqual([wael, dina].sort());

    // Le second adulte, avec sa PROPRE session, voit exactement le même foyer (§28.M en germe).
    const meFromSecond = await http.get('/households/me').set(...second.auth()).expect(200);
    expect(meFromSecond.body.id).toBe(h.householdId);
    expect(meFromSecond.body.id).not.toBe(second.userId);
  });

  // =========================================================================
  // SCÉNARIO B — Salaire prévu → reçu, sans double-projection (§1/§28.B, IF-06).
  // =========================================================================
  it('B — salaire prévu puis reçu : le solde ne bouge qu\'à la confirmation, jamais compté deux fois en projection', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 10000);
    const sourceId = await createIncomeSource(h.auth, accountId, 'Salaire', 15000);
    const occId = await createOccurrence(h.auth, sourceId, '2026-09-20', 15000);

    // Avant confirmation : le solde réel reste inchangé, mais la projection voit l'événement futur une seule fois.
    const before = await http.get('/accounts').set(...h.auth()).expect(200);
    expect(before.body.find((a: { id: string }) => a.id === accountId).soldeCourant).toBe(10000);
    const projBefore = await getProjection(h.auth, '2026-09-01', 30);
    expect(projBefore.body.closing_physical_treasury).toBe(25000); // 10000 + 15000 prévu

    await confirmOccurrence(h.auth, occId, 15000, accountId);

    const after = await http.get('/accounts').set(...h.auth()).expect(200);
    expect(after.body.find((a: { id: string }) => a.id === accountId).soldeCourant).toBe(25000);

    // Après confirmation, la projection depuis AUJOURD'HUI (après la date de réception) ne doit
    // plus ajouter une seconde fois ce salaire : le solde d'ouverture l'intègre déjà (IF-06).
    const projAfter = await getProjection(h.auth, '2026-09-21', 30);
    expect(projAfter.body.opening_physical_treasury).toBe(25000);
    expect(projAfter.body.closing_physical_treasury).toBe(25000);
  });

  // =========================================================================
  // SCÉNARIO C — Dépense variable (BudgetExpense) vs dépense ad-hoc (AdHocExpense) (§28.C).
  // =========================================================================
  it('C — une dépense qui correspond à un budget actif devient BudgetExpense, sinon AdHocExpense', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 5000);
    const alimentation = (await http.post('/categories').set(...h.auth()).send({ name: 'Alimentation', kind: 'expense' }).expect(201)).body.id;
    const loisirs = (await http.post('/categories').set(...h.auth()).send({ name: 'Loisirs', kind: 'expense' }).expect(201)).body.id;

    await http.post('/variable-budgets').set(...h.auth()).send({
      categoryId: alimentation, referenceAmount: 2000, referencePeriod: 'mois', startDate: '2026-09-01',
    }).expect(201);

    const budgetExpense = await http.post('/expenses').set(...h.auth()).send({
      amount: 300, accountId, categoryId: alimentation, spentDate: '2026-09-05',
    }).expect(201);
    const adhocExpense = await http.post('/expenses').set(...h.auth()).send({
      amount: 150, accountId, categoryId: loisirs, spentDate: '2026-09-06',
    }).expect(201);

    expect(budgetExpense.body.kind).toBe('budget_expense');
    expect(adhocExpense.body.kind).toBe('adhoc_expense');

    const account = (await http.get('/accounts').set(...h.auth()).expect(200)).body.find((a: { id: string }) => a.id === accountId);
    expect(account.soldeCourant).toBe(5000 - 300 - 150); // les deux réduisent bien le même compte réel
  });

  // =========================================================================
  // SCÉNARIO D — Plan financier « École » via l'assistant : T1/T2/T3, fournitures,
  // uniformes, sorties, restauration à montant inconnu — NULL ≠ 0, complétude,
  // vue enfant, jamais de doublon (§1/§28.D, RG-103/RG-119).
  // =========================================================================
  it('D — assistant frais scolaires : NULL ≠ 0, complétude « contient_inconnues », vue enfant cohérente', async () => {
    const h = await newHousehold();
    const wael = await createChild(h.auth, 'Wael');
    const dina = await createChild(h.auth, 'Dina');

    const wizard = await http.post('/school-wizard').set(...h.auth()).send({
      label: 'École 2026-2027',
      childIds: [wael, dina],
      periodStart: '2026-09-01',
      periodEnd: '2027-06-30',
      items: [
        { label: 'Scolarité T1', amount: 8000, dueDate: '2026-09-15' },
        { label: 'Scolarité T2', amount: 8000, dueDate: '2027-01-10' },
        { label: 'Scolarité T3', amount: 8000, dueDate: '2027-04-10' },
        { label: 'Fournitures', amount: 1200, dueDate: '2026-09-01' },
        { label: 'Uniformes', amount: 900, dueDate: '2026-09-01' },
        { label: 'Sorties scolaires', amount: 600, dueDate: '2026-10-01' },
        { label: 'Restauration', amount: null, dueDate: '2026-09-15' }, // « je ne sais pas encore » (§17)
        // Fournitures ventilées par enfant (§16) — sans ceci, une charge à 2 enfants reste
        // « commune non ventilée » et n'apparaît jamais dans le coût connu d'un enfant précis.
        { label: 'Fournitures Wael', amount: 300, dueDate: '2026-09-01', childIds: [wael] },
        { label: 'Fournitures Dina', amount: 250, dueDate: '2026-09-01', childIds: [dina] },
      ],
    }).expect(201);
    const planId = wizard.body.financialPlan.id as string;

    const plan = await http.get(`/financial-plans/${planId}`).set(...h.auth()).expect(200);
    expect(plan.body.completude).toBe('contient_inconnues');
    // 24000 (scolarité) + 1200 + 900 + 600 + 300 + 250 = 27250 — la restauration inconnue est EXCLUE, jamais comptée 0.
    expect(plan.body.knownPlanCost).toBe(27250);
    expect(plan.body.unknownItems).toHaveLength(1);
    expect(plan.body.unknownItems[0].label).toBe('Restauration');

    // Vue par enfant : chaque enfant bénéficiaire retrouve au moins sa part ventilée, sans duplication du montant total du foyer.
    const costsWael = await http.get(`/children/${wael}/costs`).set(...h.auth()).expect(200);
    const costsDina = await http.get(`/children/${dina}/costs`).set(...h.auth()).expect(200);
    expect(costsWael.body.coutConnu).toBeGreaterThanOrEqual(300);
    expect(costsDina.body.coutConnu).toBeGreaterThanOrEqual(250);
    // Les charges communes (T1/T2/T3/uniformes/sorties) restent listées comme non ventilées,
    // jamais doublées dans le total de chaque enfant (RG-016bis).
    expect(costsWael.body.chargesCommunesNonVentilees.length).toBeGreaterThan(0);

    // Aucune duplication : un seul FinancialPlan, un seul ChargePlan par ligne (9 lignes).
    const allPlans = await http.get('/financial-plans').set(...h.auth()).expect(200);
    expect(allPlans.body.filter((p: { id: string }) => p.id === planId)).toHaveLength(1);
    const chargePlans = await http.get('/charge-plans').set(...h.auth()).expect(200);
    expect(chargePlans.body.filter((cp: { financialPlanId: string | null }) => cp.financialPlanId === planId)).toHaveLength(9);
  });

  // =========================================================================
  // SCÉNARIO E — Estimation → confirmation d'une facture : amount_initial_estimated
  // préservé, propagation immédiate au Plan/Dashboard/Projection/Simulateur (§1/§28.E, RG-104).
  // =========================================================================
  it('E — facture estimée 20000 confirmée à 21300 : montant initial préservé, propagation immédiate partout', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 50000);
    const { chargePlanId, deadlineId } = await createChargePlanDeadline(h.auth, 'Assurance voiture', {
      dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'estime',
    });

    const beforeProj = await getProjection(h.auth, '2026-09-01', 30);
    expect(beforeProj.body.closing_physical_treasury).toBe(30000); // 50000 - 20000 estimé

    const confirmed = await http.patch(`/deadlines/${deadlineId}`).set(...h.auth()).send({ amountCurrent: 21300, amountStatus: 'confirme' }).expect(200);
    expect(confirmed.body.amountCurrent).toBe(21300);
    expect(confirmed.body.amountInitialEstimated).toBe(20000); // RG-104 : jamais écrasé

    const plan = await http.get('/charge-plans').set(...h.auth()).expect(200);
    const cp = plan.body.find((c: { id: string }) => c.id === chargePlanId);
    expect(cp).toBeDefined();

    const dashboard = await getDashboard(h.auth, '2026-09-01');
    expect(dashboard.body.deadlineItems.find((d: { id: string }) => d.id === deadlineId).resteAPayer).toBe(21300);

    const afterProj = await getProjection(h.auth, '2026-09-01', 30);
    expect(afterProj.body.closing_physical_treasury).toBe(50000 - 21300); // propagation immédiate, nouveau montant seul compte

    const sim = await simulatePurchase(h.auth, '2026-09-01', { amount: 1000, date: '2026-09-01', accountId, horizonDays: 30 });
    expect(sim.body.baseline.closing_physical_treasury).toBe(50000 - 21300); // baseline réel, jamais influencé par l'achat simulé (IF-10)
    expect(sim.body.scenario.closing_physical_treasury).toBe(50000 - 21300 - 1000); // scénario simulé : nouveau montant confirmé + achat
  });

  // =========================================================================
  // SCÉNARIO F — Provision « virtual_allocation » : compte inchangé, réservé +12000,
  // disponible −12000, liée à des échéances par ordre chronologique (§1/§28.F, RG-090).
  // =========================================================================
  it('F — provision virtuelle 12000 : compte inchangé, réservé +12000, disponible −12000, couverture chronologique', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });

    const before = await getDashboard(h.auth, '2026-09-01');
    await contribute(h.auth, provisionId, 12000);
    const after = await getDashboard(h.auth, '2026-09-01');

    const account = (await http.get('/accounts').set(...h.auth()).expect(200)).body.find((a: { id: string }) => a.id === accountId);
    expect(account.soldeCourant).toBe(50000); // compte physique inchangé (RG-071)
    expect(after.body.reserved_amount).toBe(before.body.reserved_amount + 12000);
    expect(after.body.free_available).toBe(before.body.free_available - 12000);

    // Deux échéances liées, couverture chronologique : la plus proche est couverte en priorité.
    const { deadlineId: d1 } = await createChargePlanDeadline(h.auth, 'T1', { dueDate: '2026-09-15', amountCurrent: 7000, amountStatus: 'confirme' });
    const { deadlineId: d2 } = await createChargePlanDeadline(h.auth, 'T2', { dueDate: '2027-01-10', amountCurrent: 8000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: d1 }).expect(201);
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId: d2 }).expect(201);

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    const cov1 = provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === d1);
    const cov2 = provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === d2);
    expect(cov1.coverageAffectee).toBe(7000); // la première échéance (plus proche) épuise sa part en premier
    expect(cov2.coverageAffectee).toBe(5000); // reste 12000-7000 = 5000 pour la seconde
  });

  // =========================================================================
  // SCÉNARIO G — « Payer avec Provision » (§1/§28.G, scénario chiffré exact) :
  // Compte=50000, Provision=12000, Deadline=20000 → paie 5000 avec Provision
  // → Compte=45000, Provision=7000, reste=15000, couverture=7000, non couvert=8000.
  // Cohérence stricte entre Comptes/Transactions/Plan/Provision/Dashboard/Projection/Simulateur.
  // =========================================================================
  it('G — payer 5000 avec une Provision : 50000→45000, 12000→7000, reste 15000, couverture 7000, non couvert 8000, cohérent partout', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 50000);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await contribute(h.auth, provisionId, 12000);
    const { chargePlanId, deadlineId } = await createChargePlanDeadline(h.auth, 'Scolarité annuelle', {
      dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'confirme',
    });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 5000, accountId, fundingSource: 'provision', provisionId })
      .expect(201);

    const account = (await http.get('/accounts').set(...h.auth()).expect(200)).body.find((a: { id: string }) => a.id === accountId);
    expect(account.soldeCourant).toBe(45000);

    const provision = await http.get(`/provisions/${provisionId}`).set(...h.auth()).expect(200);
    expect(provision.body.currentAmount).toBe(7000);
    const cov = provision.body.coverage.find((c: { deadlineId: string }) => c.deadlineId === deadlineId);
    expect(cov.resteAPayer).toBe(15000);
    expect(cov.coverageAffectee).toBe(7000);
    expect(cov.engagementNonCouvert).toBe(8000);
    expect(cov.coverageAffectee + cov.engagementNonCouvert).toBe(cov.resteAPayer); // RG-092 : jamais 12000+20000

    const deadlineRes = await http.get(`/deadlines/${deadlineId}`).set(...h.auth()).expect(200);
    expect(deadlineRes.body.resteAPayer).toBe(15000);

    const transactions = await http.get('/transactions').set(...h.auth()).expect(200);
    expect(transactions.body.some((t: { amount: number; kind: string }) => t.kind === 'payment' && Math.abs(t.amount) === 5000)).toBe(true);

    const dashboard = await getDashboard(h.auth, '2026-09-01');
    const dashDeadline = dashboard.body.deadlineItems.find((d: { id: string }) => d.id === deadlineId);
    expect(dashDeadline.resteAPayer).toBe(15000);
    const dashProvision = dashboard.body.provisions?.find?.((p: { id: string }) => p.id === provisionId) ?? null;
    if (dashProvision) {
      expect(dashProvision.currentAmount).toBe(7000);
      expect(dashProvision.totalUncovered).toBe(8000);
    }

    const proj = await getProjection(h.auth, '2026-09-01', 30);
    expect(proj.body.closing_physical_treasury).toBe(45000 - 15000); // reste dû (15000) toujours à payer avant l'échéance
  });

  // =========================================================================
  // SCÉNARIO H — Épargne enfant protégée (Wael, Dina, RG-047) : jamais proposée
  // comme argent libre, ni comme source de couverture automatique, ni comme
  // source de financement du simulateur (§1/§28.H).
  // =========================================================================
  it('H — épargne protégée de Wael et Dina jamais comptée comme disponible ni proposée au simulateur', async () => {
    const h = await newHousehold();
    const wael = await createChild(h.auth, 'Wael');
    const dina = await createChild(h.auth, 'Dina');
    const compteCourant = await createAccount(h.auth, 'Compte courant', 'courant', 10000);
    const epargneWael = await createAccount(h.auth, 'Épargne Wael', 'epargne', 6000, false);
    const epargneDina = await createAccount(h.auth, 'Épargne Dina', 'epargne', 4000, false);
    await http.post('/pockets').set(...h.auth()).send({
      name: 'Épargne Wael', allocationMode: 'backed_by_account', linkedAccountId: epargneWael, beneficiaryChildId: wael, hasRecurringContribution: true,
    }).expect(201);
    await http.post('/pockets').set(...h.auth()).send({
      name: 'Épargne Dina', allocationMode: 'backed_by_account', linkedAccountId: epargneDina, beneficiaryChildId: dina, hasRecurringContribution: true,
    }).expect(201);

    // Le dashboard n'inclut jamais ces comptes dédiés dans le disponible libre (includeInOperationalTreasury=false).
    const dashboard = await getDashboard(h.auth, '2026-09-01');
    expect(dashboard.body.operational_treasury).toBe(10000);

    // Le simulateur refuse de présenter ces comptes protégés comme un moyen prudent d'achat.
    const simWael = await simulatePurchase(h.auth, '2026-09-01', { amount: 3000, date: '2026-09-01', accountId: epargneWael, horizonDays: 10 });
    expect(simWael.body.reason_codes).toContain('PROTECTED_SAVINGS');
    expect(simWael.body.decision).not.toBe('POSSIBLE_ET_PRUDENT');
    const simDina = await simulatePurchase(h.auth, '2026-09-01', { amount: 2000, date: '2026-09-01', accountId: epargneDina, horizonDays: 10 });
    expect(simDina.body.reason_codes).toContain('PROTECTED_SAVINGS');
  });

  // =========================================================================
  // SCÉNARIO I — Objectif PC (cible 15000, déjà 5000 → reste 10000) : « puis-je
  // acheter maintenant ? » / « après salaire ? » / « date recommandée ? » (§1/§28.I).
  // =========================================================================
  it('I — Goal PC 15000 avec 5000 déjà mis de côté : progression 5000/10000, possible ≠ recommandé', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 6000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 5000 }).expect(200);
    const goalId = await createGoal(h.auth, { label: 'PC portable', targetAmount: 15000 });
    await http.post(`/goals/${goalId}/contributions`).set(...h.auth()).send({ plannedDate: '2026-08-15', plannedAmount: 5000, confirmed: true }).expect(201);
    const sourceId = await createIncomeSource(h.auth, accountId, 'Salaire', 12000);
    await createOccurrence(h.auth, sourceId, '2026-09-28', 12000);

    const goal = await http.get(`/goals/${goalId}`).set(...h.auth()).expect(200);
    expect(goal.body.savedAmount).toBe(5000);
    expect(goal.body.remainingToConstitute).toBe(10000);

    // « Puis-je acheter maintenant ? » — achat 15000 sur un compte à 6000, avant le salaire.
    const now = await simulatePurchase(h.auth, '2026-09-01', { amount: 15000, date: '2026-09-01', accountId, horizonDays: 40 });
    expect(now.body.decision).toBe('IMPOSSIBLE_DEFICIT');

    // « Après salaire ? » — la première date possible correspond à l'arrivée du salaire.
    expect(now.body.possible_date).toContain('2026-09-28');

    // « Date recommandée ? » — peut différer de la date « juste possible » (marge de sécurité).
    expect(now.body.recommended_date).toBeDefined();
  });

  // =========================================================================
  // SCÉNARIO J — Projection aux 4 horizons réglementaires 7/30/60/90j (§1/§28.J).
  // =========================================================================
  it('J — projection cohérente aux horizons 7/30/60/90 jours (ouverture/fermeture/point bas/mêmes revenus et charges)', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 40000);
    const sourceId = await createIncomeSource(h.auth, accountId, 'Salaire', 12000);
    await createOccurrence(h.auth, sourceId, '2026-09-28', 12000);
    await createOccurrence(h.auth, sourceId, '2026-10-28', 12000);
    await createOccurrence(h.auth, sourceId, '2026-11-28', 12000);
    await createChargePlanDeadline(h.auth, 'Loyer sept.', { dueDate: '2026-09-05', amountCurrent: 6000, amountStatus: 'confirme' });
    await createChargePlanDeadline(h.auth, 'Assurance auto', { dueDate: '2026-10-15', amountCurrent: 3000, amountStatus: 'confirme' });

    const p7 = await getProjection(h.auth, '2026-09-01', 7);
    const p30 = await getProjection(h.auth, '2026-09-01', 30);
    const p60 = await getProjection(h.auth, '2026-09-01', 60);
    const p90 = await getProjection(h.auth, '2026-09-01', 90);

    // Même point de départ pour les 4 horizons (même moteur, même foyer, même référence).
    expect(p7.body.opening_physical_treasury).toBe(40000);
    expect(p30.body.opening_physical_treasury).toBe(40000);
    expect(p60.body.opening_physical_treasury).toBe(40000);
    expect(p90.body.opening_physical_treasury).toBe(40000);

    // Un horizon plus long ne peut jamais « oublier » un événement déjà visible dans un horizon plus court.
    expect(p7.body.closing_physical_treasury).toBe(40000 - 6000); // seul le loyer du 5 est dans les 7 jours
    expect(p30.body.closing_physical_treasury).toBe(40000 - 6000 + 12000); // + salaire du 28
    expect(p60.body.closing_physical_treasury).toBe(40000 - 6000 + 12000 - 3000 + 12000); // + assurance + salaire oct.
    expect(p90.body.closing_physical_treasury).toBeGreaterThanOrEqual(p60.body.closing_physical_treasury);
  });

  // =========================================================================
  // SCÉNARIO K — Simulateur : décisions cohérentes sur le même foyer familial (§1/§28.K).
  // =========================================================================
  it('K — simulateur : achat prudent, tension et déficit correctement distingués sur le foyer familial', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 30000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 8000 }).expect(200);

    const prudent = await simulatePurchase(h.auth, '2026-09-01', { amount: 5000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(prudent.body.decision).toBe('POSSIBLE_ET_PRUDENT');

    // physique après = 30000-23000 = 7000 (>=0) ; marge = 7000-8000(coussin) = -1000 (<0) → tension, jamais un déficit physique.
    const tension = await simulatePurchase(h.auth, '2026-09-01', { amount: 23000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(tension.body.decision).toBe('POSSIBLE_MAIS_TENSION');

    const deficit = await simulatePurchase(h.auth, '2026-09-01', { amount: 50000, date: '2026-09-01', accountId, horizonDays: 10 });
    expect(deficit.body.decision).toBe('IMPOSSIBLE_DEFICIT');
  });

  // =========================================================================
  // SCÉNARIO L — Persistance : fermeture/reconnexion/rafraîchissement/navigation —
  // rien n'est perdu, dupliqué, recréé, ni auto-confirmé (§1/§28.L).
  // =========================================================================
  it('L — persistance stricte après reconnexion : identique bit à bit, aucune donnée auto-confirmée', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 22000);
    const sourceId = await createIncomeSource(h.auth, accountId, 'Salaire', 12000);
    await createOccurrence(h.auth, sourceId, '2026-09-28', 12000); // reste "prevu" — ne doit jamais s'auto-confirmer
    await createChargePlanDeadline(h.auth, 'Facture', { dueDate: '2026-09-20', amountCurrent: 4000, amountStatus: 'confirme' });

    const before = await snapshotHousehold(h);

    // "Fermer/rouvrir l'app" : nouvelle session, plusieurs relectures successives (rafraîchissement, navigation).
    h.setToken(await login(h.email));
    await snapshotHousehold(h);
    await snapshotHousehold(h);
    const after = await snapshotHousehold(h);

    expect(after).toEqual(before);
    const occurrences = await http.get(`/income-sources/${sourceId}/occurrences`).set(...h.auth()).expect(200);
    expect(occurrences.body[0].status).toBe('prevu'); // jamais auto-confirmé par une simple relecture
  });

  // =========================================================================
  // SCÉNARIO M — Multi-adultes : visibilité et cohérence croisées, recorded_by_user_id (§1/§28.M).
  // =========================================================================
  it('M — deux adultes du même foyer voient les mêmes données et le même Dashboard, avec traçabilité recorded_by', async () => {
    const h = await newHousehold();
    const b = await inviteSecondAdult(h);
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 15000);

    // Adulte A crée une échéance.
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge A', { dueDate: '2026-09-15', amountCurrent: 2000, amountStatus: 'confirme' });
    const seenByB = await http.get('/deadlines').set(...b.auth()).expect(200);
    expect(seenByB.body.some((d: { id: string }) => d.id === deadlineId)).toBe(true);

    // Adulte B ajoute une dépense.
    const catId = (await http.post('/categories').set(...b.auth()).send({ name: 'Divers', kind: 'expense' }).expect(201)).body.id;
    const expense = await http.post('/expenses').set(...b.auth()).send({ amount: 300, accountId, categoryId: catId, spentDate: '2026-09-02' }).expect(201);
    const seenByA = await http.get('/transactions').set(...h.auth()).expect(200);
    expect(seenByA.body.some((t: { id: string }) => t.id === expense.body.expense.id)).toBe(true);
    expect(expense.body.expense.recordedById).toBe(b.userId); // traçabilité de l'auteur réel de l'écriture

    // Dashboard/Projection identiques pour les deux, à la même date de référence.
    const dashA = await getDashboard(h.auth, '2026-09-01');
    const dashB = await getDashboard(b.auth, '2026-09-01');
    expect(dashA.body).toEqual(dashB.body);
    const projA = await getProjection(h.auth, '2026-09-01', 30);
    const projB = await getProjection(b.auth, '2026-09-01', 30);
    expect(projA.body).toEqual(projB.body);
  });

  // =========================================================================
  // SCÉNARIO N — Isolation stricte du foyer par tentative d'accès à un ID CONNU
  // (pas seulement des listes vides) sur les endpoints critiques (§1/§28.N).
  // =========================================================================
  it('N — un foyer B ne peut jamais accéder, même par ID connu, aux données réelles du foyer A', async () => {
    const a = await newHousehold();
    const accountA = await createAccount(a.auth, 'Compte A', 'courant', 100000);
    const { deadlineId: deadlineA } = await createChargePlanDeadline(a.auth, 'Charge A', { dueDate: '2026-09-15', amountCurrent: 5000, amountStatus: 'confirme' });
    const provisionA = await createProvision(a.auth, { name: 'Provision A', allocationMode: 'virtual_allocation' });
    const goalA = await createGoal(a.auth, { label: 'Goal A', targetAmount: 10000 });
    const childA = await createChild(a.auth, 'EnfantA');

    const b = await newHousehold();

    await http.get(`/accounts/${accountA}`).set(...b.auth()).expect(404);
    await http.get(`/deadlines/${deadlineA}`).set(...b.auth()).expect(404);
    await http.get(`/provisions/${provisionA}`).set(...b.auth()).expect(404);
    await http.get(`/goals/${goalA}`).set(...b.auth()).expect(404);
    await http.get(`/children/${childA}`).set(...b.auth()).expect(404);
    await http.patch(`/deadlines/${deadlineA}`).set(...b.auth()).send({ amountCurrent: 1 }).expect(404);
    await http
      .post(`/deadlines/${deadlineA}/payments`)
      .set(...b.auth())
      .send({ amount: 100, accountId: accountA })
      .expect(404);
    await http.post(`/provisions/${provisionA}/contribute`).set(...b.auth()).send({ amount: 100 }).expect(404);
    await http.post('/simulation/purchase').set(...b.auth()).query({ at: '2026-09-01' }).send({ amount: 100, date: '2026-09-01', accountId: accountA, horizonDays: 10 }).expect(404);
  });

  // =========================================================================
  // SCÉNARIO O — Cohérence numérique stricte Dashboard ↔ Projection à la même
  // date de référence (§1/§28.O) : trésorerie opérationnelle = ouverture J0
  // physique ; disponible libre cohérent avec la capacité libre J0.
  // =========================================================================
  it('O — Dashboard.operational_treasury == Projection.opening_physical_treasury (J0), même référence', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 'courant', 27000);
    await http.patch('/households/settings').set(...h.auth()).send({ securityMarginAmount: 4000 }).expect(200);
    const provisionId = await createProvision(h.auth, { name: 'Provision', allocationMode: 'virtual_allocation' });
    await contribute(h.auth, provisionId, 3000);
    await createChargePlanDeadline(h.auth, 'Charge proche', { dueDate: '2026-09-10', amountCurrent: 2000, amountStatus: 'confirme' });

    const ref = '2026-09-01';
    const dashboard = await getDashboard(h.auth, ref);
    const projection = await getProjection(h.auth, ref, 30);

    expect(dashboard.body.operational_treasury).toBe(projection.body.opening_physical_treasury);
    expect(dashboard.body.free_available).toBe(projection.body.opening_free_capacity);
  });

  // =========================================================================
  // SCÉNARIO P — Simulation sans écriture, avec toute la richesse du scénario
  // familial en place (Provision, Goal, plan École, épargne enfant) (§1/§28.P, IF-10).
  // =========================================================================
  it('P — simulateur : aucune écriture réelle même sur un foyer riche (provisions, goal, plan, épargne enfant)', async () => {
    const h = await newHousehold();
    const wael = await createChild(h.auth, 'Wael');
    const accountId = await createAccount(h.auth, 'Compte', 'courant', 40000);
    const epargneWael = await createAccount(h.auth, 'Épargne Wael', 'epargne', 5000, false);
    await http.post('/pockets').set(...h.auth()).send({
      name: 'Épargne Wael', allocationMode: 'backed_by_account', linkedAccountId: epargneWael, beneficiaryChildId: wael, hasRecurringContribution: true,
    }).expect(201);
    const provisionId = await createProvision(h.auth, { name: 'Provision École', allocationMode: 'virtual_allocation' });
    await contribute(h.auth, provisionId, 6000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000 });
    await http.post(`/goals/${goalId}/contributions`).set(...h.auth()).send({ plannedDate: '2026-08-01', plannedAmount: 3000, confirmed: true }).expect(201);
    await http.post('/school-wizard').set(...h.auth()).send({
      label: 'École', childIds: [wael], periodStart: '2026-09-01', periodEnd: '2027-06-30',
      items: [{ label: 'Scolarité T1', amount: 5000, dueDate: '2026-09-15' }],
    }).expect(201);

    const before = await snapshotHousehold(h);
    await simulatePurchase(h.auth, '2026-09-01', { amount: 8000, date: '2026-09-01', accountId, horizonDays: 30 });
    await simulatePurchase(h.auth, '2026-09-01', { amount: 8000, date: '2026-09-01', accountId: epargneWael, horizonDays: 30 });
    await http.post('/simulation/goal-contribution').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, amount: 2000, date: '2026-09-01' }).expect(201);
    await http.post('/simulation/savings-capacity').set(...h.auth()).query({ at: '2026-09-01' }).send({ horizonDays: 30 }).expect(201);
    await http.post('/simulation/goal').set(...h.auth()).query({ at: '2026-09-01' }).send({ goalId, horizonDays: 60 }).expect(201);
    const after = await snapshotHousehold(h);

    expect(after).toEqual(before);
  }, 20000);
});
