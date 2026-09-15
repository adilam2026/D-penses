import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Tests M4 (TXT réf. §M4) — les 3 niveaux réellement distincts :
 *  1. Solde actuel (operational_treasury, inchangé)
 *  2. Fin de période — engagements connus (closing_physical_treasury, désormais
 *     TOUJOURS sans aucun budget — c'était le bug corrigé par ce lot)
 *  3. Fin de période — prudente (fin_periode_prudente = 2 − restant des budgets
 *     includeInPrudentProjection=true, formule contractuelle, jamais le rythme)
 *
 * CAS1-6 valident le moteur (GET /projection) avec les exemples exacts donnés en
 * validation. CAS7 valide que le Simulateur (POST /simulation/purchase) décide
 * sur le scénario prudent, jamais sur les seuls engagements connus.
 */
describe('M4 — Solde actuel / Fin de période engagements connus / Fin de période prudente (e2e)', () => {
  let app: INestApplication;
  let http: request.Agent;
  const run = Date.now();
  const mailer = new FakeMailer();
  let seq = 0;

  beforeAll(async () => {
    app = await createTestApp(withFakeMailer(mailer));
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  async function newHousehold() {
    seq += 1;
    const signupToken = await signupVerified(http, mailer, `lot35+${run}+${seq}@example.com`, 'password123', 'L35', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot35 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function createAccount(auth: () => [string, string], name: string, initialBalance: number) {
    const res = await http.post('/accounts').set(...auth()).send({ name, type: 'courant', initialBalance, includeInOperationalTreasury: true }).expect(201);
    return res.body.id as string;
  }

  async function createCategory(auth: () => [string, string], name: string) {
    const res = await http.post('/categories').set(...auth()).send({ name, kind: 'expense' }).expect(201);
    return res.body.id as string;
  }

  async function createBudget(
    auth: () => [string, string],
    categoryId: string,
    referenceAmount: number,
    opts: { includeInPrudentProjection?: boolean } = {},
  ) {
    const res = await http
      .post('/variable-budgets')
      .set(...auth())
      .send({ categoryId, referenceAmount, referencePeriod: 'mois', startDate: '2020-01-01', includeInPrudentProjection: opts.includeInPrudentProjection })
      .expect(201);
    return res.body.id as string;
  }

  async function spendOnBudget(auth: () => [string, string], accountId: string, categoryId: string, amount: number, spentDate: string) {
    return http.post('/expenses').set(...auth()).send({ amount, accountId, categoryId, spentDate }).expect(201);
  }

  async function createChargePlanDeadline(auth: () => [string, string], label: string, deadline: { dueDate: string; amountCurrent?: number; amountStatus?: string }) {
    const cp = await http.post('/charge-plans').set(...auth()).send({ label, generationMode: 'calendrier_manuel', startDate: '2020-01-01' }).expect(201);
    const d = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send(deadline).expect(201);
    return { chargePlanId: cp.body.id as string, deadlineId: d.body.id as string };
  }

  async function getProjection(auth: () => [string, string], query: Record<string, string | number>) {
    return http.get('/projection').set(...auth()).query(query).expect(200);
  }

  // =========================================================
  // CAS1 — budget non consommé : prudent = engagements connus − plafond entier
  // =========================================================
  it('CAS1 — Solde=10000, aucun engagement, budget=6000 consommé=0 → Aujourd\'hui=10000, Engagements connus=10000, Prudent=4000', async () => {
    const { auth } = await newHousehold();
    await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses CAS1');
    await createBudget(auth, catId, 6000);

    const proj = await getProjection(auth, { at: '2030-06-02', to: '2030-06-30' });
    expect(proj.body.opening_physical_treasury).toBe(10000); // Solde actuel
    expect(proj.body.closing_physical_treasury).toBe(10000); // Engagements connus — zéro budget
    expect(proj.body.fin_periode_engagements_connus).toBe(10000);
    expect(proj.body.fin_periode_prudente).toBe(4000); // 10000 - 6000
    expect(proj.body.ecart_prudentiel).toBe(6000);
  });

  // =========================================================
  // CAS2 — budget partiellement consommé : impact prudent = restant, jamais le plafond
  // =========================================================
  it('CAS2 — budget=6000 consommé=1500 → impact prudent = 4500, jamais 6000', async () => {
    const { auth } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses CAS2');
    await createBudget(auth, catId, 6000);
    await spendOnBudget(auth, accountId, catId, 1500, '2030-06-05');

    // Solde réel déjà à 8500 (10000-1500 dépensé) — la projection connue ne bouge plus (zéro budget).
    const proj = await getProjection(auth, { at: '2030-06-06', to: '2030-06-30' });
    expect(proj.body.opening_physical_treasury).toBe(8500);
    expect(proj.body.closing_physical_treasury).toBe(8500);
    expect(proj.body.ecart_prudentiel).toBe(4500); // 6000 - 1500, jamais 6000 (le consommé n'est jamais redéduit — IF-13)
    expect(proj.body.fin_periode_prudente).toBe(4000); // 8500 - 4500
  });

  // =========================================================
  // CAS3 — includeInPrudentProjection=false : aucun impact, ni connu ni prudent
  // =========================================================
  it('CAS3 — includeInPrudentProjection=false → aucun impact sur engagements connus ni sur prudent', async () => {
    const { auth } = await newHousehold();
    await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses CAS3');
    await createBudget(auth, catId, 3000, { includeInPrudentProjection: false });

    const proj = await getProjection(auth, { at: '2030-06-02', to: '2030-06-30' });
    expect(proj.body.closing_physical_treasury).toBe(10000);
    expect(proj.body.fin_periode_prudente).toBe(10000); // pas de retrait du tout
    expect(proj.body.ecart_prudentiel).toBe(0);
  });

  // =========================================================
  // CAS4 — budget dépassé : impact prudent = 0, jamais négatif
  // =========================================================
  it('CAS4 — budget dépassé (consommé > plafond) → impact prudent = 0, jamais négatif', async () => {
    const { auth } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses CAS4');
    await createBudget(auth, catId, 2000);
    await spendOnBudget(auth, accountId, catId, 3000, '2030-06-05'); // dépasse le plafond de 1000

    const proj = await getProjection(auth, { at: '2030-06-06', to: '2030-06-30' });
    expect(proj.body.ecart_prudentiel).toBe(0); // jamais -1000
    expect(proj.body.fin_periode_prudente).toBe(proj.body.closing_physical_treasury); // aucun retrait supplémentaire
  });

  // =========================================================
  // CAS5 — échéance partiellement payée : seul le reste à payer est projeté (non-régression)
  // =========================================================
  it('CAS5 — échéance partiellement payée → seul le reste à payer est projeté (non-régression, pas un comportement M4 nouveau)', async () => {
    const { auth } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte', 10000);
    const { deadlineId } = await createChargePlanDeadline(auth, 'Charge CAS5', { dueDate: '2030-06-20', amountCurrent: 1000, amountStatus: 'confirme' });
    await http.post(`/deadlines/${deadlineId}/payments`).set(...auth()).send({ amount: 300, accountId, paidDate: '2030-06-10' }).expect(201);

    const proj = await getProjection(auth, { at: '2030-06-11', to: '2030-06-25' });
    // Solde réel déjà à 9700 (10000-300 payé) — seul le reste (700) doit encore être projeté.
    expect(proj.body.opening_physical_treasury).toBe(9700);
    expect(proj.body.closing_physical_treasury).toBe(9000); // 9700 - 700, jamais 9700-1000
  });

  // =========================================================
  // CAS6 — montant inconnu : jamais transformé silencieusement en 0 (non-régression)
  // =========================================================
  it('CAS6 — une échéance à montant inconnu reste visible et marque le calcul incomplet, jamais silencieusement 0', async () => {
    const { auth } = await newHousehold();
    await createAccount(auth, 'Compte', 10000);
    await createChargePlanDeadline(auth, 'Charge CAS6 inconnue', { dueDate: '2030-06-20' }); // pas de amountCurrent → amount_status=inconnu

    const proj = await getProjection(auth, { at: '2030-06-02', to: '2030-06-30' });
    expect(proj.body.unknown_events_count).toBeGreaterThan(0);
    expect(proj.body.is_complete).toBe(false);
    // Jamais compté comme 0 dans les totaux : la trésorerie connue reste inchangée par cette
    // seule échéance inconnue (rien d'autre dans ce scénario).
    expect(proj.body.closing_physical_treasury).toBe(10000);
  });

  // =========================================================
  // CAS7 — Simulateur : la décision repose sur le scénario prudent, jamais sur les
  // seuls engagements connus (un achat qui semblerait possible sans les budgets doit
  // être refusé une fois le budget prudent pris en compte).
  // =========================================================
  it('CAS7 — le Simulateur refuse un achat que les seuls engagements connus auraient laissé passer, une fois le budget prudent pris en compte', async () => {
    const { auth } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses CAS7');
    await createBudget(auth, catId, 6000); // includeInPrudentProjection=true par défaut

    // Sans le budget : 10000 - 5000 = 5000 ≥ 0, achat possible et prudent.
    // Avec le budget prudent (6000, consommé=0) : 10000 - 6000 - 5000 = -1000 < 0, déficit.
    const res = await http
      .post('/simulation/purchase')
      .set(...auth())
      .query({ at: '2030-06-02' })
      .send({ amount: 5000, date: '2030-06-05', accountId, horizonDays: 30 })
      .expect(201);

    expect(res.body.decision).toBe('IMPOSSIBLE_DEFICIT');
    expect(res.body.decision).not.toBe('POSSIBLE_ET_PRUDENT');
    expect(res.body.physical_low_point_after).toBeLessThan(0);
  });

  // =========================================================
  // Garde-fou documentaire (mini-check §C avant code) — anti-double-compte :
  // une dépense déjà réalisée sur un budget (donc déjà dans consommeADate) ne
  // doit JAMAIS être redéduite une seconde fois par le restant prudent de la
  // même période. Aujourd'hui, aucun générateur d'événement daté n'existe pour
  // une "dépense future déjà rattachée à un budget" (Deadline/ChargePlan n'a pas
  // de FK vers VariableBudget) : ce test verrouille noir sur blanc l'absence de
  // double déduction sur le seul cas réel possible — une dépense déjà consommée
  // (passée OU saisie à l'avance) dans la fenêtre de la période courante.
  // ⚠ Si un futur lot ajoute un événement "dépense prévue rattachée à un budget"
  // dans le moteur, il devra exclure ce même montant du restant prudent de la
  // période concernée pour ne jamais le compter deux fois.
  // =========================================================
  it('garde-fou — une dépense déjà consommée sur un budget (même saisie à l\'avance) n\'est jamais redéduite une 2e fois par le restant prudent', async () => {
    const { auth } = await newHousehold();
    const accountId = await createAccount(auth, 'Compte', 10000);
    const catId = await createCategory(auth, 'Courses garde-fou');
    await createBudget(auth, catId, 6000);
    // Dépense saisie À L'AVANCE dans la période courante (spentDate futur mais
    // toujours dans la fenêtre de la période) — déjà comptée dans consommeADate.
    await spendOnBudget(auth, accountId, catId, 1500, '2030-06-20');

    const proj = await getProjection(auth, { at: '2030-06-02', to: '2030-06-30' });
    // 6000 - 1500 = 4500, jamais 6000 (pas comptée), jamais 3000 (pas comptée deux fois).
    expect(proj.body.ecart_prudentiel).toBe(4500);
  });
});
