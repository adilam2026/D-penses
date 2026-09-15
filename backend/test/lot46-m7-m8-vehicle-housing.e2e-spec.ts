import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * M7+M8 — Vehicle/Housing ultra-simples, Plans Voiture/Maison/Abonnements
 * (réutilisent ChargePlan/Deadline/moteur de récurrence existant, jamais un
 * moteur financier parallèle), participants Voyage (FinancialPlanBeneficiary
 * existant), contextualisation "Libellé · Entité" (Transactions/Calendrier/
 * Projection/détail Plan).
 */
describe('Lot 46 — M7+M8 Vehicle/Housing/Abonnements/Voyage participants (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot46+${run}+${seq}@example.com`, 'password123', 'L46', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer M7M8 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  it("A. référentiel Vehicle ultra-simple : nom uniquement, jamais de fiche technique", async () => {
    const { auth } = await newHousehold();
    const res = await http.post('/vehicles').set(...auth()).send({ name: 'Audi Q5' }).expect(201);
    expect(res.body.name).toBe('Audi Q5');
    expect(res.body.status).toBe('active');
    // Ultra simple : aucun champ marque/modèle/immatriculation/etc.
    expect(res.body.brand).toBeUndefined();
    expect(res.body.plate).toBeUndefined();

    const list = await http.get('/vehicles').set(...auth()).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe('Audi Q5');
  });

  it("B. référentiel Housing ultra-simple : nom uniquement", async () => {
    const { auth } = await newHousehold();
    const res = await http.post('/housing').set(...auth()).send({ name: 'Villa Almaz' }).expect(201);
    expect(res.body.name).toBe('Villa Almaz');
    expect(res.body.address).toBeUndefined();

    const list = await http.get('/housing').set(...auth()).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it("C. Plan Voiture : création inline du véhicule + postes avec périodicités LIBRES (jamais imposées)", async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({
        vehicleName: 'Opel Corsa',
        items: [
          { label: 'Assurance', amount: 4000, recurrenceRule: 'annuel', dueDate: '2027-01-15' },
          { label: 'Vidange', amount: 1200, recurrenceRule: 'semestriel', dueDate: '2026-12-10' },
          { label: 'Réparation', amount: 2500, recurrenceRule: 'ponctuel', dueDate: '2026-10-20' },
        ],
      })
      .expect(201);

    expect(res.body.vehicle.name).toBe('Opel Corsa');
    expect(res.body.financialPlan.planType).toBe('vehicle');
    expect(res.body.financialPlan.vehicleId).toBe(res.body.vehicle.id);
    expect(res.body.chargePlans).toHaveLength(3);

    const assurance = res.body.chargePlans.find((cp: any) => cp.label === 'Assurance');
    const vidange = res.body.chargePlans.find((cp: any) => cp.label === 'Vidange');
    const reparation = res.body.chargePlans.find((cp: any) => cp.label === 'Réparation');
    // Périodicité TOUJOURS celle choisie par l'utilisateur, jamais une valeur fixe imposée.
    expect(assurance.recurrenceRule).toBe('annuel');
    expect(assurance.generationMode).toBe('auto_frequence');
    expect(vidange.recurrenceRule).toBe('semestriel');
    expect(reparation.recurrenceRule).toBe('ponctuel');
    expect(reparation.generationMode).toBe('calendrier_manuel');
    expect(assurance.vehicleId).toBe(res.body.vehicle.id);
  });

  it("D. Plan Voiture : réutilisation d'un véhicule EXISTANT (jamais de doublon de référentiel)", async () => {
    const { auth } = await newHousehold();
    const v = await http.post('/vehicles').set(...auth()).send({ name: 'Voiture Lamiaa' }).expect(201);

    const res = await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleId: v.body.id, items: [{ label: 'Carburant', amount: 500, recurrenceRule: 'mensuel', dueDate: '2026-10-05' }] })
      .expect(201);

    expect(res.body.vehicle.id).toBe(v.body.id);
    const list = await http.get('/vehicles').set(...auth()).expect(200);
    expect(list.body).toHaveLength(1); // jamais un second véhicule créé
  });

  it("E. Plan Maison : postes avec périodicités variées (mensuel/toutes_les_2_semaines non forcées, ponctuel)", async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/housing-wizard')
      .set(...auth())
      .send({
        housingName: 'Villa Almaz',
        items: [
          { label: 'Jardinier', amount: 600, recurrenceRule: 'mensuel', dueDate: '2026-10-01' },
          { label: 'Assurance habitation', amount: 2500, recurrenceRule: 'annuel', dueDate: '2027-02-01' },
          { label: 'Réparation plomberie', amount: 1500, recurrenceRule: 'ponctuel', dueDate: '2026-10-15' },
        ],
      })
      .expect(201);

    expect(res.body.housing.name).toBe('Villa Almaz');
    expect(res.body.financialPlan.planType).toBe('housing');
    expect(res.body.chargePlans).toHaveLength(3);
    const jardinier = res.body.chargePlans.find((cp: any) => cp.label === 'Jardinier');
    expect(jardinier.recurrenceRule).toBe('mensuel');
    expect(jardinier.housingId).toBe(res.body.housing.id);
  });

  it("F. Plan Abonnements : vue regroupée SANS référentiel, jamais mensuel imposé (Netflix mensuel, Microsoft 365 annuel)", async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/subscriptions-wizard')
      .set(...auth())
      .send({
        label: 'Abonnements',
        items: [
          { label: 'Netflix', amount: 100, recurrenceRule: 'mensuel', dueDate: '2026-10-01' },
          { label: 'Microsoft 365', amount: 700, recurrenceRule: 'annuel', dueDate: '2027-03-01' },
        ],
      })
      .expect(201);

    expect(res.body.financialPlan.planType).toBe('subscriptions');
    expect(res.body.financialPlan.vehicleId).toBeNull();
    expect(res.body.financialPlan.housingId).toBeNull();
    const netflix = res.body.chargePlans.find((cp: any) => cp.label === 'Netflix');
    const office = res.body.chargePlans.find((cp: any) => cp.label === 'Microsoft 365');
    expect(netflix.recurrenceRule).toBe('mensuel');
    expect(office.recurrenceRule).toBe('annuel'); // jamais forcé à mensuel
  });

  it("G. Voyage participants : réutilise FinancialPlanBeneficiary existant, aucun nouveau modèle", async () => {
    const { auth } = await newHousehold();
    const me = await http.get('/households/me').set(...auth()).expect(200);
    const userId = me.body.memberships[0].user.id as string;
    const child = await http.post('/children').set(...auth()).send({ firstName: 'Yasmine', lastName: 'T' }).expect(201);

    const res = await http
      .post('/travel-wizard')
      .set(...auth())
      .send({
        label: 'Voyage Agadir',
        destination: 'Agadir',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-10',
        participantUserIds: [userId],
        participantChildIds: [child.body.id],
        items: [{ label: 'Hôtel', amount: 3000, dueDate: '2026-11-01' }],
      })
      .expect(201);

    const beneficiaries = await http.get(`/financial-plans/${res.body.financialPlan.id}/beneficiaries`).set(...auth()).expect(200);
    expect(beneficiaries.body).toHaveLength(2);
    expect(beneficiaries.body.some((b: any) => b.userId === userId)).toBe(true);
    expect(beneficiaries.body.some((b: any) => b.childId === child.body.id)).toBe(true);
  });

  it('H. contextualisation "Libellé · Entité" dans le détail du Plan (jamais le nom stocké dans le libellé)', async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleName: 'Audi Q5', items: [{ label: 'Vidange', amount: 1200, recurrenceRule: 'ponctuel', dueDate: '2026-11-10' }] })
      .expect(201);

    const detail = await http.get(`/financial-plans/${res.body.financialPlan.id}`).set(...auth()).expect(200);
    expect(detail.body.chargePlans[0].label).toBe('Vidange · Audi Q5');
    expect(detail.body.deadlinesCertain[0].chargePlanLabel).toBe('Vidange · Audi Q5');
  });

  it('I. contextualisation dans le Calendrier ("Libellé · Entité" sur l\'événement échéance)', async () => {
    const { auth } = await newHousehold();
    await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleName: 'Audi Q5', items: [{ label: 'Assurance', amount: 4000, recurrenceRule: 'ponctuel', dueDate: '2026-11-20' }] })
      .expect(201);

    const cal = await http.get('/calendar?at=2026-11-01&to=2026-12-01').set(...auth()).expect(200);
    const event = cal.body.events.find((e: any) => e.kind === 'echeance');
    expect(event).toBeDefined();
    expect(event.label).toBe('Assurance · Audi Q5');
  });

  it('J. contextualisation dans les Transactions (paiement d\'une charge Maison)', async () => {
    const { auth } = await newHousehold();
    const acc = await http.post('/accounts').set(...auth()).send({ name: 'Compte Courant', type: 'courant', initialBalance: 10000 }).expect(201);
    const wiz = await http
      .post('/housing-wizard')
      .set(...auth())
      .send({ housingName: 'Villa Almaz', items: [{ label: 'Électricité', amount: 300, recurrenceRule: 'ponctuel', dueDate: '2026-10-15' }] })
      .expect(201);
    const chargePlanId = wiz.body.chargePlans[0].id as string;

    const detail = await http.get(`/financial-plans/${wiz.body.financialPlan.id}`).set(...auth()).expect(200);
    const deadlineId = detail.body.deadlinesCertain.find((d: any) => d.chargePlanId === chargePlanId).id as string;

    await http
      .post(`/deadlines/${deadlineId}/payments`)
      .set(...auth())
      .send({ amount: 300, accountId: acc.body.id })
      .expect(201);

    const txs = await http.get('/transactions?kind=payment').set(...auth()).expect(200);
    expect(txs.body[0].label).toBe('Électricité · Villa Almaz');
  });

  it('K. anti-doublon : un seul ChargePlan + une seule Deadline créés par poste (jamais un moteur parallèle)', async () => {
    const { auth } = await newHousehold();
    const res = await http
      .post('/vehicle-wizard')
      .set(...auth())
      .send({ vehicleName: 'Voiture Test', items: [{ label: 'Pneus', amount: 800, recurrenceRule: 'ponctuel', dueDate: '2026-10-22' }] })
      .expect(201);

    const detail = await http.get(`/financial-plans/${res.body.financialPlan.id}`).set(...auth()).expect(200);
    expect(detail.body.chargePlans).toHaveLength(1);
    expect(detail.body.deadlinesCertain).toHaveLength(1);
  });
});
