import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * M9B — branchement SchoolProjection dans la Projection longue durée
 * (GET /projection/monthly) + traçabilité sourceDeadlineId (granularité réelle
 * d'un ChargePlan pouvant porter plusieurs Deadline distinctes).
 */
describe('Lot 44 — M9B Projection longue durée + granularité (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot44+${run}+${seq}@example.com`, 'password123', 'L44', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer M9B ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  async function newChild(auth: () => [string, string], firstName: string) {
    const res = await http.post('/children').set(...auth()).send({ firstName, lastName: 'T' }).expect(201);
    return res.body.id as string;
  }

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

  it("A. Projection longue durée expose la prévision sous school_projection_items, jamais dans les totaux réels", async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Wael');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Scolarité T1', amount: 4000, dueDate: '2026-09-15' },
    ]);

    // Référence AVANT génération de la prévision (2 ans, pour couvrir 2027-09-15).
    const before = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);

    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'fixe', applyToAllIncreaseValue: 500 })
      .expect(201);

    const after = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);

    const targetMonth = after.body.months.find((m: any) =>
      (m.school_projection_items ?? []).some((i: any) => i.schoolYear === '2027/2028'),
    );
    expect(targetMonth).toBeDefined();
    const item = targetMonth.school_projection_items[0];
    expect(item.amount).toBe(4500); // 4000 + 500 (hausse fixe)
    expect(item.label).toBe('Scolarité T1');
    expect(item.childFirstName).toBe('Wael'); // contextualisation (§4) — jamais dans le label stocké

    // Non-fuite : les totaux réels de CE même mois n'ont pas bougé après génération.
    const beforeMonth = before.body.months.find((m: any) => m.month === targetMonth.month);
    expect(targetMonth.total_income).toBe(beforeMonth?.total_income ?? 0);
    expect(targetMonth.total_expense).toBe(beforeMonth?.total_expense ?? 0);
    expect(targetMonth.balance).toBe(beforeMonth?.balance ?? 0);
    expect(targetMonth.cumulative_balance).toBe(beforeMonth?.cumulative_balance ?? 0);
  });

  it('B. une prévision remplacee disparaît de la Projection longue durée (la vraie Deadline prend le relais)', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Dina');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Uniforme', amount: 1200, dueDate: '2026-09-01' }]);
    const gen = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);
    const projectionId = gen.body.created[0].id;

    const withProjection = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const hasBefore = withProjection.body.months.some((m: any) => (m.school_projection_items ?? []).some((i: any) => i.id === projectionId));
    expect(hasBefore).toBe(true);

    await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2027/2028',
        childIds: [childId],
        periodStart: '2027-09-01',
        periodEnd: '2028-06-30',
        items: [{ label: 'Uniforme', amount: 1200, dueDate: '2027-09-01', sourceProjectionId: projectionId }],
      })
      .expect(201);

    const afterReplace = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const stillThere = afterReplace.body.months.some((m: any) => (m.school_projection_items ?? []).some((i: any) => i.id === projectionId));
    expect(stillThere).toBe(false); // jamais les deux comptées à la fois
  });

  it("C. granularité — un ChargePlan portant 2 Deadline distinctes trace la BONNE échéance source (sourceDeadlineId)", async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Yassmine');
    const { financialPlan, chargePlans } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Fournitures', amount: 800, dueDate: '2026-09-01' },
    ]);
    const chargePlanId = chargePlans[0].id;

    // Une SECONDE échéance distincte ajoutée manuellement sur le MÊME poste (possible
    // via POST /charge-plans/:id/deadlines, jamais limité à une seule échéance) — la
    // plus récente à montant connu devient la référence de la prévision.
    const secondDeadline = await http
      .post(`/charge-plans/${chargePlanId}/deadlines`)
      .set(...auth())
      .send({ dueDate: '2026-11-15', amountCurrent: 950, amountStatus: 'confirme' })
      .expect(201);

    const gen = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    expect(gen.body.created).toHaveLength(1);
    expect(Number(gen.body.created[0].computedAmount)).toBe(950); // référence = échéance la plus récente (950), pas 800
    expect(gen.body.created[0].sourceDeadlineId).toBe(secondDeadline.body.id); // traçabilité exacte, jamais ambiguë
  });

  it('D. une SchoolProjection projetée diminue réellement le solde projeté (projected_cash_balance_with_forecasts), cumulativement', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Ali');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Scolarité T1', amount: 4000, dueDate: '2026-09-15' }]);
    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    const res = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const months = res.body.months as any[];
    const targetIndex = months.findIndex((m) => (m.school_projection_items ?? []).length > 0);
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    const target = months[targetIndex];
    expect(target.school_projection_impact).toBe(-4000); // dépense future prévisionnelle, pas un engagement connu
    expect(target.projected_cash_balance_with_forecasts).toBe(Number((target.projected_cash_balance - 4000).toFixed(2)));
    // jamais mélangée à balance/cumulative_balance/total_expense/projected_cash_balance (engagements connus intact)
    expect(target.total_expense).toBe(0);

    // Cumulatif : le mois suivant reste diminué du même montant (pas remis à zéro).
    const next = months[targetIndex + 1];
    if (next) {
      expect(next.school_projection_impact).toBe(0);
      expect(next.projected_cash_balance_with_forecasts).toBe(Number((next.projected_cash_balance - 4000).toFixed(2)));
    }
  });

  it("E. une SchoolProjection remplacee n'impacte plus le solde projeté (son impact revient à 0)", async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Nora');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Garderie', amount: 1800, dueDate: '2026-09-01' }]);
    const gen = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);
    const projectionId = gen.body.created[0].id;

    const before = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const beforeMonth = (before.body.months as any[]).find((m) => (m.school_projection_items ?? []).some((i: any) => i.id === projectionId));
    expect(beforeMonth.school_projection_impact).toBe(-1800);

    await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2027/2028',
        childIds: [childId],
        periodStart: '2027-09-01',
        periodEnd: '2028-06-30',
        items: [{ label: 'Garderie', amount: 1800, dueDate: '2027-09-01', sourceProjectionId: projectionId }],
      })
      .expect(201);

    const after = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const afterMonth = (after.body.months as any[]).find((m) => m.month === beforeMonth.month);
    expect(afterMonth.school_projection_items).toHaveLength(0);
    expect(afterMonth.school_projection_impact).toBe(0);
  });

  it("F. la vraie Deadline qui remplace une prévision n'est comptée qu'une seule fois dans le solde projeté (jamais prévision+réel ensemble)", async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Sami');
    // Uniforme (pas Garderie) : obligationStatus par défaut = obligatoire côté
    // school-wizard.service.ts (jamais optionnelle_envisagee), donc réellement compté
    // dans les engagements connus une fois la vraie Deadline créée — sinon ce test ne
    // prouverait rien (une charge exclue par défaut de M4 resterait à 0 des deux côtés).
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [{ label: 'Uniforme', amount: 2500, dueDate: '2026-09-01' }]);
    const gen = await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);
    const projectionId = gen.body.created[0].id;

    const before = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const beforeMonth = (before.body.months as any[]).find((m) => (m.school_projection_items ?? []).some((i: any) => i.id === projectionId));
    const cashBeforeReplace = beforeMonth.projected_cash_balance_with_forecasts;

    await http
      .post('/school-wizard')
      .set(...auth())
      .send({
        label: 'École 2027/2028',
        childIds: [childId],
        periodStart: '2027-09-01',
        periodEnd: '2028-06-30',
        items: [{ label: 'Uniforme', amount: 2500, dueDate: '2027-09-01', sourceProjectionId: projectionId }],
      })
      .expect(201);

    const after = await http.get('/projection/monthly?horizonMonths=24&at=2026-09-01').set(...auth()).expect(200);
    const afterMonth = (after.body.months as any[]).find((m) => m.month === beforeMonth.month);
    // La prévision a disparu (remplacee), et la vraie Deadline compte désormais dans les
    // engagements connus (jamais 0 : preuve que ce n'est pas un simple 2500−2500=0 accidentel).
    expect(afterMonth.total_expense).toBe(2500);
    // La prévision a disparu (remplacee), la vraie Deadline produit désormais le MÊME
    // impact net sur le solde projeté qu'avant — jamais 2500 (prévision) + 2500 (réel).
    expect(afterMonth.school_projection_items).toHaveLength(0);
    expect(afterMonth.projected_cash_balance_with_forecasts).toBe(cashBeforeReplace);
  });

  it('G. plusieurs prévisions T1/T2/T3 impactent chacune leur propre mois, cumulativement', async () => {
    const { auth } = await newHousehold();
    const childId = await newChild(auth, 'Yasmine');
    const { financialPlan } = await newSchoolPlan(auth, childId, '2026/2027', [
      { label: 'Scolarité T1', amount: 23300, dueDate: '2026-09-15' },
      { label: 'Scolarité T2', amount: 23300, dueDate: '2027-01-15' },
      { label: 'Scolarité T3', amount: 23300, dueDate: '2027-04-15' },
    ]);
    await http
      .post(`/financial-plans/${financialPlan.id}/school-projections`)
      .set(...auth())
      .send({ years: 1, applyToAllIncreaseType: 'aucune' })
      .expect(201);

    const res = await http.get('/projection/monthly?horizonMonths=36&at=2026-09-01').set(...auth()).expect(200);
    const months = res.body.months as any[];

    const findFor = (label: string) => months.find((m) => (m.school_projection_items ?? []).some((i: any) => i.label === label && i.schoolYear === '2027/2028'));
    const t1 = findFor('Scolarité T1');
    const t2 = findFor('Scolarité T2');
    const t3 = findFor('Scolarité T3');
    expect(t1).toBeDefined();
    expect(t2).toBeDefined();
    expect(t3).toBeDefined();
    expect(t1.month).not.toBe(t2.month); // chacune dans SON propre mois, jamais fusionnées
    expect(t2.month).not.toBe(t3.month);
    expect(t1.school_projection_impact).toBe(-23300);
    expect(t2.school_projection_impact).toBe(-23300);
    expect(t3.school_projection_impact).toBe(-23300);

    // Après T3, le solde reste diminué des 3 échéances cumulées (69900), pas remis à zéro.
    const afterT3 = months[months.indexOf(t3) + 1];
    if (afterT3) {
      expect(afterT3.school_projection_impact).toBe(0);
      expect(afterT3.projected_cash_balance_with_forecasts).toBe(Number((afterT3.projected_cash_balance - 69900).toFixed(2)));
    }
  });
});
