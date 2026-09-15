import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * M9 — prévision pluriannuelle des postes École (verrouillage architecture
 * Plans avant M7/M8). Couvre les 8 garde-fous validés avant GO code :
 * schoolYear structuré, targetDate dérivée de la ligne réelle source, granularité
 * par ChargePlan (T1/T2/T3 jamais fusionnés), transformation prévision→réel sans
 * doublon, statuts projete/remplacee (aucun nouveau statut FinancialPlan), règles
 * d'évolution (aucune/fixe/pourcentage) avec arrondi déterministe, horizons
 * 1/3/5/custom, et non-fuite dans Montants_engagés (dashboard).
 */
describe('Lot 43 — M9 prévisions pluriannuelles École (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot43+${run}+${seq}@example.com`, 'password123', 'L43', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer M9 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'T' }).expect(201);
    return res.body.id as string;
  }

  /** Plan École réel minimal via l'assistant existant — retourne {financialPlan, chargePlans}. */
  async function newSchoolPlan(
    auth: () => [string, string],
    childId: string,
    schoolYear: string,
    items: { label: string; amount: number | null; dueDate: string }[],
  ) {
    const res = await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: `École ${schoolYear}`,
        childIds: [childId],
        periodStart: `${schoolYear.slice(0, 4)}-09-01`,
        periodEnd: `${schoolYear.slice(5)}-06-30`,
        schoolYear,
        schoolName: 'Lycée Test',
        items: items.map((i) => ({ label: i.label, amount: i.amount, dueDate: i.dueDate })),
      })
      .expect(201);
    return res.body as { financialPlan: { id: string }; chargePlans: { id: string; label: string }[] };
  }

  it('A. hausse fixe — targetDate dérivée de la ligne réelle, montant chaîné année après année', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Aya');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Scolarité T1', amount: 2000, dueDate: '2026-09-15' },
    ]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ targetSchoolYear: '2028/2029', rules: [{ chargePlanId: chargPlanIdOf(chargePlans, 'Scolarité T1'), increaseType: 'fixe', increaseValue: 200 }] })
      .expect(201);

    expect(res.body.skipped).toEqual([]);
    const rows = res.body.created.sort((a: any, b: any) => a.schoolYear.localeCompare(b.schoolYear));
    expect(rows).toHaveLength(2);
    expect(rows[0].schoolYear).toBe('2027/2028');
    expect(Number(rows[0].computedAmount)).toBe(2200);
    expect(rows[0].targetDate.slice(0, 10)).toBe('2027-09-15');
    expect(rows[1].schoolYear).toBe('2028/2029');
    expect(Number(rows[1].computedAmount)).toBe(2400); // chaîné depuis 2200, jamais recalculé depuis 2000
    expect(rows[1].targetDate.slice(0, 10)).toBe('2028-09-15');
    expect(rows[0].status).toBe('projete');
  });

  it('B. hausse pourcentage — arrondi monétaire déterministe (round2, jamais dérivant)', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Bilal');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Restauration', amount: 333.33, dueDate: '2026-10-01' },
    ]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, rules: [{ chargePlanId: chargPlanIdOf(chargePlans, 'Restauration'), increaseType: 'pourcentage', increaseValue: 10 }] })
      .expect(201);

    // 333.33 * 1.10 = 366.663 → round2 → 366.66
    expect(Number(res.body.created[0].computedAmount)).toBe(366.66);
  });

  it('C. granularité — T1/T2/T3 restent 3 chaînes de prévision distinctes, jamais fusionnées', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Chaimae');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Scolarité T1', amount: 3000, dueDate: '2026-09-15' },
      { label: 'Scolarité T2', amount: 3000, dueDate: '2027-01-15' },
      { label: 'Scolarité T3', amount: 3000, dueDate: '2027-04-15' },
    ]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    expect(res.body.created).toHaveLength(3);
    const dates = res.body.created.map((r: any) => r.targetDate.slice(0, 10)).sort();
    // Chaque poste garde sa propre date +1 an EXACTE (T2/T3 sont sur l'année civile
    // suivante dans le calendrier scolaire 2026/2027 : leur cible tombe donc en 2028).
    expect(dates).toEqual(['2027-09-15', '2028-01-15', '2028-04-15']); // 3 dates distinctes, jamais une somme annuelle unique
    const sourceIds = new Set(res.body.created.map((r: any) => r.sourceChargePlanId));
    expect(sourceIds.size).toBe(3);
    expect(chargePlans).toHaveLength(3);
  });

  it("D. transformation prévision→réel — anti-doublon, jamais les deux comptées", async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Driss');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Uniforme', amount: 1500, dueDate: '2026-09-01' },
    ]);
    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    const candidatesBefore = await http
      .get(`/school-projections/candidates?childId=${childId}&schoolYear=2027/2028&schoolName=${encodeURIComponent('Lycée Test')}`)
      .set(...auth())
      .expect(200);
    expect(candidatesBefore.body).toHaveLength(1);
    const projectionId = candidatesBefore.body[0].id;
    expect(candidatesBefore.body[0].computedAmount).toBeDefined();

    // Création du plan réel 2027/2028 en réutilisant la prévision comme base.
    await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2027/2028',
        childIds: [childId],
        periodStart: '2027-09-01',
        periodEnd: '2028-06-30',
        schoolYear: '2027/2028',
        schoolName: 'Lycée Test',
        items: [{ label: 'Uniforme', amount: Number(candidatesBefore.body[0].computedAmount), dueDate: '2027-09-01', sourceProjectionId: projectionId }],
      })
      .expect(201);

    const candidatesAfter = await http
      .get(`/school-projections/candidates?childId=${childId}&schoolYear=2027/2028`)
      .set(...auth())
      .expect(200);
    expect(candidatesAfter.body).toHaveLength(0); // jamais les deux comptées à la fois

    const history = await http.get(`/financial-plans/${financialPlan.id}/school-projections`).set(...auth()).expect(200);
    const replaced = history.body.find((p: any) => p.id === projectionId);
    expect(replaced.status).toBe('remplacee');
    expect(replaced.replacedByFinancialPlanId).toBeDefined();
    expect(replaced.replacedByDeadlineId).toBeDefined();
  });

  it('E. une prévision remplacee ne peut jamais être régénérée', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Emna');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Sorties', amount: 500, dueDate: '2026-11-01' },
    ]);
    const gen = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);
    const projectionId = gen.body.created[0].id;

    await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2027/2028',
        childIds: [childId],
        periodStart: '2027-09-01',
        periodEnd: '2028-06-30',
        items: [{ label: 'Sorties', amount: 500, dueDate: '2027-11-01', sourceProjectionId: projectionId }],
      })
      .expect(201);

    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(409);
  });

  it('F. règle par poste (rules) prime sur applyToAllIncreaseType', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Fatine');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Assurance', amount: 400, dueDate: '2026-09-01' },
      { label: 'Fournitures', amount: 600, dueDate: '2026-09-01' },
    ]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({
        years: 1,
        applyToAllIncreaseType: 'aucune',
        rules: [{ chargePlanId: chargPlanIdOf(chargePlans, 'Assurance'), increaseType: 'fixe', increaseValue: 50 }],
      })
      .expect(201);

    const assurance = res.body.created.find((r: any) => r.label === 'Assurance');
    const fournitures = res.body.created.find((r: any) => r.label === 'Fournitures');
    expect(Number(assurance.computedAmount)).toBe(450); // règle explicite
    expect(Number(fournitures.computedAmount)).toBe(600); // repli applyToAll = aucune
  });

  it('G. horizon incohérent (years + targetSchoolYear) → 400, jamais les deux', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Ghita');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Poste', amount: 100, dueDate: '2026-09-01' }]);

    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, targetSchoolYear: '2029/2030', applyToAllIncreaseType: 'aucune' })
      .expect(400);
  });

  it('H. poste sans montant connu (inconnu) → jamais projeté, jamais 0 inventé', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Hamza');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Inconnu', amount: null, dueDate: '2026-09-01' }]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    expect(res.body.created).toEqual([]);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/montant connu/);
  });

  it('I. horizon custom (targetSchoolYear) — offset calculé, jamais un décompte manuel erroné', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Ines');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Poste', amount: 100, dueDate: '2026-09-01' }]);

    const res = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ targetSchoolYear: '2029/2030', applyToAllIncreaseType: 'aucune' })
      .expect(201);

    expect(res.body.created).toHaveLength(3); // offsets 1,2,3 → 2027/28, 2028/29, 2029/30
    const years = res.body.created.map((r: any) => r.schoolYear).sort();
    expect(years).toEqual(['2027/2028', '2028/2029', '2029/2030']);
  });

  it('J. non-fuite — générer des prévisions ne modifie JAMAIS Montants_engagés (dashboard inchangé)', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Jad');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Poste', amount: 5000, dueDate: '2026-09-01' }]);

    // `at` fixe explicite (§ pattern déjà utilisé ailleurs dans les e2e) — jamais une
    // horloge réelle qui dérive entre les deux appels et fausserait la comparaison.
    const before = await http.get('/dashboard/summary?at=2030-06-01').set(...auth()).expect(200);

    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 5, applyToAllIncreaseType: 'fixe', applyToAllIncreaseValue: 1000 })
      .expect(201);

    const after = await http.get('/dashboard/summary?at=2030-06-01').set(...auth()).expect(200);
    expect(after.body).toEqual(before.body); // aucune SchoolProjection ne compte comme réelle
  });

  function chargPlanIdOf(chargePlans: { id: string; label: string }[], label: string): string {
    const cp = chargePlans.find((c) => c.label === label);
    if (!cp) throw new Error(`ChargePlan "${label}" introuvable dans la fixture de test`);
    return cp.id;
  }
});
