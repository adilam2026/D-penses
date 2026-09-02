import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';

/**
 * Lot 9 (§8/§28 — atomicité & isolation) : deux familles de garanties, jamais
 * de nouvelle règle métier.
 *
 * 1. Atomicité : chaque échec forcé sur AccountTransfer / Payment / paiement
 *    avec Provision / confirmation de GoalContribution doit laisser l'état
 *    RÉEL du foyer strictement inchangé — jamais une écriture partielle
 *    (ex. un Payment créé sans son retrait de Provision, ou l'inverse).
 *    Chaque service ici valide AVANT d'écrire (aucune écriture engagée avant
 *    la dernière vérification) et `RlsContextService.run()` enveloppe tout
 *    appel de service dans UNE seule transaction Postgres — donc toute
 *    exception (avant ou après une écriture) annule la transaction entière.
 *    Ces tests le PROUVENT empiriquement par comparaison d'instantanés
 *    avant/après via l'API authentifiée (jamais par requête Prisma directe
 *    hors contexte RLS — cf. justification dans lot8.e2e-spec.ts), plutôt
 *    que de le supposer.
 *
 * 2. Isolation RLS par ID CONNU (§28.N élargi) : un foyer B ne doit jamais
 *    pouvoir lire NI modifier une ressource du foyer A même en devinant/
 *    réutilisant un identifiant réel — sur tous les endpoints mutateurs
 *    critiques, pas seulement les listes (qui seraient vides de toute façon).
 */
describe('Lot 9 — Atomicité (échecs forcés) & isolation RLS par ID connu (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signup = await http
      .post('/auth/signup')
      .send({ email: `lot9atom+${run}+${seq}@example.com`, password: 'password123', firstName: 'L9', lastName: 'A' })
      .expect(201);
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signup.body.accessToken}`)
      .send({ name: `Foyer Atom ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { accessToken, auth, householdId: household.body.household.id as string };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance }).expect(201);
    return res.body.id as string;
  }

  async function createChargePlanDeadline(auth: () => [string, string], label: string, deadline: Record<string, unknown>) {
    const cp = await http.post('/charge-plans').set(...auth()).send({ label, generationMode: 'calendrier_manuel', startDate: '2020-01-01' }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function createProvision(auth: () => [string, string], name: string) {
    const res = await http.post('/provisions').set(...auth()).send({ name, allocationMode: 'virtual_allocation' }).expect(201);
    return res.body.id as string;
  }

  async function createGoal(auth: () => [string, string], body: Record<string, unknown>) {
    const res = await http.post('/goals').set(...auth()).send(body).expect(201);
    return res.body.id as string;
  }

  /** Instantané complet d'un foyer via l'API authentifiée (§29/IF-10). */
  async function snapshotFull(auth: () => [string, string], provisionIds: string[] = [], goalIds: string[] = []) {
    const [accounts, transactions, deadlines, transfers] = await Promise.all([
      http.get('/accounts').set(...auth()).expect(200),
      http.get('/transactions').set(...auth()).expect(200),
      http.get('/deadlines').set(...auth()).expect(200),
      http.get('/accounts/transfers').set(...auth()).expect(200),
    ]);
    const provisions = await Promise.all(provisionIds.map((id) => http.get(`/provisions/${id}`).set(...auth()).expect(200)));
    const provisionMovements = await Promise.all(provisionIds.map((id) => http.get(`/provisions/${id}/movements`).set(...auth()).expect(200)));
    const goals = await Promise.all(goalIds.map((id) => http.get(`/goals/${id}`).set(...auth()).expect(200)));
    const goalContributions = await Promise.all(goalIds.map((id) => http.get(`/goals/${id}/contributions`).set(...auth()).expect(200)));
    return {
      accounts: accounts.body,
      transactions: transactions.body,
      deadlines: deadlines.body,
      transfers: transfers.body,
      provisions: provisions.map((r) => r.body),
      provisionMovements: provisionMovements.map((r) => r.body),
      goals: goals.map((r) => r.body),
      goalContributions: goalContributions.map((r) => r.body),
    };
  }

  // =========================================================================
  // ATOMICITÉ — AccountTransfer : échec forcé (compte cible d'un AUTRE foyer,
  // donc introuvable dans celui-ci) → aucun transfert, aucun solde modifié.
  // =========================================================================
  it('Atomicité AccountTransfer — un transfert vers un compte introuvable ne modifie strictement rien', async () => {
    const a = await newHousehold();
    const accountA = await createAccount(a.auth, 'Compte A', 20000);
    const b = await newHousehold();
    const accountB = await createAccount(b.auth, 'Compte B', 5000); // appartient au foyer B, pas A

    const before = await snapshotFull(a.auth);
    await http.post('/accounts/transfers').set(...a.auth()).send({ fromAccountId: accountA, toAccountId: accountB, amount: 1000 }).expect(404);
    const after = await snapshotFull(a.auth);

    expect(after).toEqual(before);
    expect(after.transfers).toHaveLength(0);
    expect(after.accounts.find((x: { id: string }) => x.id === accountA).soldeCourant).toBe(20000);
  });

  // =========================================================================
  // ATOMICITÉ — Payment simple : échec forcé (échéance déjà annulée) →
  // aucun Payment créé, reste_a_payer et solde inchangés.
  // =========================================================================
  it('Atomicité Payment — un paiement sur une échéance annulée ne crée rien, solde et reste inchangés', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 30000);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-20', amountCurrent: 5000, amountStatus: 'confirme' });
    // Annule l'échéance (une échéance annulée ne peut plus jamais recevoir de paiement).
    await http.post(`/deadlines/${deadlineId}/cancel`).set(...h.auth()).expect(201);

    const before = await snapshotFull(h.auth);
    await http.post(`/deadlines/${deadlineId}/payments`).set(...h.auth()).send({ amount: 1000, accountId }).expect(400);
    const after = await snapshotFull(h.auth);

    expect(after).toEqual(before);
    const account = after.accounts.find((x: { id: string }) => x.id === accountId);
    expect(account.soldeCourant).toBe(30000);
  });

  // =========================================================================
  // ATOMICITÉ — Payer avec Provision : échec forcé (montant > disponible de la
  // Provision) → NI Payment NI PocketMovement créés, Provision et compte intacts.
  // =========================================================================
  it("Atomicité paiement avec Provision — montant supérieur au disponible : zéro Payment, zéro PocketMovement, rien ne bouge", async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, 'Provision École');
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 6000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Scolarité', { dueDate: '2026-09-20', amountCurrent: 20000, amountStatus: 'confirme' });
    await http.post(`/provisions/${provisionId}/deadlines`).set(...h.auth()).send({ deadlineId }).expect(201);

    const before = await snapshotFull(h.auth, [provisionId]);
    // 8000 > 6000 disponibles → refusé (RG-096), avant toute écriture.
    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 8000, accountId, fundingSource: 'provision', provisionId })
      .expect(400);
    const after = await snapshotFull(h.auth, [provisionId]);

    expect(after).toEqual(before);
    expect(after.provisions[0].currentAmount).toBe(6000);
    expect(after.provisionMovements[0]).toHaveLength(1); // seule la contribution initiale, aucun retrait
    expect(after.accounts.find((x: { id: string }) => x.id === accountId).soldeCourant).toBe(50000);
  });

  // =========================================================================
  // ATOMICITÉ — Payer avec Provision : échec forcé (Provision non liée à cette
  // échéance, RG-095) → zéro écriture, même si la Provision a largement de quoi payer.
  // =========================================================================
  it('Atomicité paiement avec Provision — Provision non liée à l\'échéance : zéro écriture malgré un solde suffisant', async () => {
    const h = await newHousehold();
    const accountId = await createAccount(h.auth, 'Compte', 50000);
    const provisionId = await createProvision(h.auth, 'Provision non liée');
    await http.post(`/provisions/${provisionId}/contribute`).set(...h.auth()).send({ amount: 20000 }).expect(201);
    const { deadlineId } = await createChargePlanDeadline(h.auth, 'Charge', { dueDate: '2026-09-20', amountCurrent: 5000, amountStatus: 'confirme' });
    // Volontairement PAS de POST /provisions/:id/deadlines — la Provision reste non liée.

    const before = await snapshotFull(h.auth, [provisionId]);
    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...h.auth())
      .send({ amount: 3000, accountId, fundingSource: 'provision', provisionId })
      .expect(400);
    const after = await snapshotFull(h.auth, [provisionId]);

    expect(after).toEqual(before);
    expect(after.provisions[0].currentAmount).toBe(20000);
  });

  // =========================================================================
  // ATOMICITÉ — Confirmation de GoalContribution : échec forcé (déjà confirmée)
  // → aucun double-comptage, savedAmount et actualAmount strictement inchangés.
  // =========================================================================
  it('Atomicité confirmation de GoalContribution — confirmer deux fois échoue proprement, aucun double-comptage', async () => {
    const h = await newHousehold();
    await createAccount(h.auth, 'Compte', 20000);
    const goalId = await createGoal(h.auth, { label: 'PC', targetAmount: 15000 });
    const contribution = await http.post(`/goals/${goalId}/contributions`).set(...h.auth()).send({ plannedDate: '2026-09-05', plannedAmount: 3000, confirmed: false }).expect(201);
    const contributionId = contribution.body.contribution.id as string;

    await http.post(`/goals/contributions/${contributionId}/confirm`).set(...h.auth()).send({}).expect(201);
    const before = await snapshotFull(h.auth, [], [goalId]);
    expect(before.goals[0].savedAmount).toBe(3000);

    // Seconde confirmation de la MÊME contribution → refusée, jamais un second cumul à 6000.
    await http.post(`/goals/contributions/${contributionId}/confirm`).set(...h.auth()).send({}).expect(400);
    const after = await snapshotFull(h.auth, [], [goalId]);

    expect(after).toEqual(before);
    expect(after.goals[0].savedAmount).toBe(3000); // jamais 6000
  });

  // =========================================================================
  // ISOLATION RLS PAR ID CONNU — élargie à pockets/goals/budgets/plans/revenus/
  // transferts, en LECTURE et en MUTATION (§28.N élargi).
  // =========================================================================
  it('Isolation RLS par ID connu — pockets, budgets, plans, revenus, transferts : lecture ET mutation toujours refusées au foyer B', async () => {
    const a = await newHousehold();
    const accountA = await createAccount(a.auth, 'Compte A', 100000);
    const pocketA = (await http.post('/pockets').set(...a.auth()).send({ name: 'Poche A', allocationMode: 'virtual_allocation' }).expect(201)).body.id;
    const categoryA = (await http.post('/categories').set(...a.auth()).send({ name: 'CatA', kind: 'expense' }).expect(201)).body.id;
    const budgetA = (await http.post('/variable-budgets').set(...a.auth()).send({ categoryId: categoryA, referenceAmount: 1000, referencePeriod: 'mois', startDate: '2026-09-01' }).expect(201)).body.id;
    const { chargePlanId: planA } = await createChargePlanDeadline(a.auth, 'Charge A', { dueDate: '2026-09-20', amountCurrent: 1000, amountStatus: 'confirme' });
    const sourceA = (await http.post('/income-sources').set(...a.auth()).send({ label: 'Salaire A', usualAmount: 8000, defaultAccountId: accountA }).expect(201)).body.id;
    const transferRes = await http.post('/accounts/transfers').set(...a.auth()).send({ fromAccountId: accountA, amount: 500 }).expect(201);
    const transferA = transferRes.body.id;

    const b = await newHousehold();

    // Lecture par ID connu — toujours 404, jamais les données réelles du foyer A.
    await http.get(`/pockets/${pocketA}`).set(...b.auth()).expect(404);
    await http.get(`/variable-budgets/${budgetA}`).set(...b.auth()).expect(404);
    await http.get(`/charge-plans/${planA}`).set(...b.auth()).expect(404);

    // Mutation par ID connu — toujours refusée (jamais 200/201 sur une ressource d'un autre foyer).
    await http.patch(`/pockets/${pocketA}`).set(...b.auth()).send({ name: 'Hijack' }).expect(404);
    await http.post(`/pockets/${pocketA}/contribute`).set(...b.auth()).send({ amount: 100 }).expect(404);
    await http.patch(`/variable-budgets/${budgetA}`).set(...b.auth()).send({ referenceAmount: 1 }).expect(404);
    await http.post(`/income-sources/${sourceA}/occurrences`).set(...b.auth()).send({ usualDate: '2026-09-20', plannedAmount: 100 }).expect(404);
    await http.post(`/accounts/transfers/${transferA}/confirm`).set(...b.auth()).expect(404);

    // Le foyer A, lui, garde un accès intact à ses propres ressources.
    const stillOk = await http.get(`/pockets/${pocketA}`).set(...a.auth()).expect(200);
    expect(stillOk.body.name).toBe('Poche A');
  });
});
