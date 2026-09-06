import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './setup-app';
import { FakeMailer, withFakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';

/**
 * Recette post-Vague 3 (§4/§5/§17) — Modifier/Désactiver/Supprimer une charge
 * récurrente (ChargePlan) ou une source de revenu (IncomeSource). "Désactiver"
 * (status=inactif) réutilise EXCLUSIVEMENT le filtre déjà présent dans
 * ensureChargeDeadlinesUntil/ensureIncomeOccurrencesUntil (occurrence-
 * generation.util.ts) — jamais une seconde logique dupliquée ici. "Supprimer"
 * est bloqué (409) dès qu'un historique financier réel existe (Payment /
 * financialStatus avancé pour une charge, occurrence 'recu' pour un revenu).
 */
describe('Recette post-Vague 3 — Modifier/Désactiver/Supprimer charges et revenus (e2e)', () => {
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
    const signupToken = await signupVerified(http, mailer, `lot16+${run}+${seq}@example.com`, 'password123', 'L16', 'T');
    const household = await http
      .post('/households')
      .set('Authorization', `Bearer ${signupToken}`)
      .send({ name: `Foyer Lot16 ${seq}` })
      .expect(201);
    const accessToken = household.body.accessToken as string;
    const auth = () => ['Authorization', `Bearer ${accessToken}`] as [string, string];
    return { auth };
  }

  describe('ChargePlan — modifier', () => {
    it('modifie label/catégorie/fréquence/compte', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP', type: 'courant', initialBalance: 1000 }).expect(201);
      const catA = await http.post('/categories').set(...auth()).send({ name: 'Cat A', kind: 'expense' }).expect(201);
      const catB = await http.post('/categories').set(...auth()).send({ name: 'Cat B', kind: 'expense' }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Internet', categoryId: catA.body.id, generationMode: 'auto_frequence', recurrenceRule: 'mensuel', startDate: '2026-01-01' })
        .expect(201);

      const updated = await http
        .patch(`/charge-plans/${cp.body.id}`)
        .set(...auth())
        .send({ label: 'Internet fibre', categoryId: catB.body.id, recurrenceRule: 'trimestriel', defaultAccountId: account.body.id })
        .expect(200);

      expect(updated.body.label).toBe('Internet fibre');
      expect(updated.body.categoryId).toBe(catB.body.id);
      expect(updated.body.recurrenceRule).toBe('trimestriel');
      expect(updated.body.defaultAccountId).toBe(account.body.id);
    });
  });

  describe('ChargePlan — désactiver arrête la génération future (jamais une 2e logique)', () => {
    it('status=inactif : aucune nouvelle Deadline générée, les Deadline existantes restent intactes', async () => {
      const { auth } = await newHousehold();
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat désactivation', kind: 'expense' }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Loyer', categoryId: category.body.id, generationMode: 'auto_frequence', recurrenceRule: 'mensuel', startDate: '2026-01-01' })
        .expect(201);
      await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-01-01', amountCurrent: 500, amountStatus: 'confirme' }).expect(201);

      await http.patch(`/charge-plans/${cp.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);

      // Déclenche la génération (dashboard = ensureChargeDeadlinesUntil sur horizon 30j) :
      // aucune nouvelle échéance ne doit apparaître pour ce plan désactivé.
      await http.get('/dashboard/summary').set(...auth()).expect(200);
      const deadlines = await http.get(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).expect(200);
      expect(deadlines.body).toHaveLength(1);
      expect(deadlines.body[0].dueDate).toContain('2026-01-01');
    });
  });

  describe('ChargePlan — supprimer', () => {
    it('sans historique : suppression autorisée', async () => {
      const { auth } = await newHousehold();
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat suppr OK', kind: 'expense' }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'À supprimer', categoryId: category.body.id, generationMode: 'calendrier_manuel', startDate: '2026-01-01' })
        .expect(201);
      await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-02-01', amountCurrent: 100, amountStatus: 'confirme' }).expect(201);

      await http.delete(`/charge-plans/${cp.body.id}`).set(...auth()).expect(200);
      await http.get(`/charge-plans/${cp.body.id}`).set(...auth()).expect(404);
    });

    it('avec un paiement enregistré : suppression refusée (409), désactivation reste possible', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP paiement', type: 'courant', initialBalance: 5000 }).expect(201);
      const category = await http.post('/categories').set(...auth()).send({ name: 'Cat suppr refusée', kind: 'expense' }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...auth())
        .send({ label: 'Avec historique', categoryId: category.body.id, generationMode: 'calendrier_manuel', startDate: '2026-01-01' })
        .expect(201);
      const deadline = await http.post(`/charge-plans/${cp.body.id}/deadlines`).set(...auth()).send({ dueDate: '2026-02-01', amountCurrent: 100, amountStatus: 'confirme' }).expect(201);
      await http.post(`/deadlines/${deadline.body.id}/payments`).set(...auth()).send({ amount: 100, accountId: account.body.id, paidDate: '2026-02-01' }).expect(201);

      const res = await http.delete(`/charge-plans/${cp.body.id}`).set(...auth()).expect(409);
      expect(res.body.message).toContain('Désactivez');

      await http.patch(`/charge-plans/${cp.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);
    });
  });

  describe('IncomeSource — modifier', () => {
    it('modifie label/montant/fréquence/compte', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP revenu', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'Salaire', usualAmount: 10000, defaultAccountId: account.body.id, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-01-29' })
        .expect(201);

      const updated = await http
        .patch(`/income-sources/${source.body.id}`)
        .set(...auth())
        .send({ label: 'Salaire net', usualAmount: 11000 })
        .expect(200);

      expect(updated.body.label).toBe('Salaire net');
      expect(Number(updated.body.usualAmount)).toBe(11000);
    });
  });

  describe('IncomeSource — désactiver arrête la génération future', () => {
    it('status=inactif : aucune nouvelle occurrence générée', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP revenu désactivation', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'Freelance', usualAmount: 3000, defaultAccountId: account.body.id, isRecurring: true, recurrenceRule: 'mensuel', recurrenceAnchorDate: '2026-01-05' })
        .expect(201);

      await http.patch(`/income-sources/${source.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);
      await http.get('/dashboard/summary').set(...auth()).expect(200);

      const occurrences = await http.get(`/income-sources/${source.body.id}/occurrences`).set(...auth()).expect(200);
      expect(occurrences.body).toHaveLength(0);
    });
  });

  describe('IncomeSource — supprimer', () => {
    it('sans occurrence reçue : suppression autorisée', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP source suppr OK', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'À supprimer', usualAmount: 500, defaultAccountId: account.body.id, isRecurring: false })
        .expect(201);

      await http.delete(`/income-sources/${source.body.id}`).set(...auth()).expect(200);
      await http.get(`/income-sources/${source.body.id}`).set(...auth()).expect(404);
    });

    it('avec une occurrence reçue : suppression refusée (409), désactivation reste possible', async () => {
      const { auth } = await newHousehold();
      const account = await http.post('/accounts').set(...auth()).send({ name: 'BP source suppr refusée', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...auth())
        .send({ label: 'Avec historique', usualAmount: 2000, defaultAccountId: account.body.id, isRecurring: false })
        .expect(201);
      const occurrence = await http.post(`/income-sources/${source.body.id}/occurrences`).set(...auth()).send({ usualDate: '2026-01-15' }).expect(201);
      await http.post(`/income-occurrences/${occurrence.body.id}/confirm`).set(...auth()).send({ actualAmount: 2000, accountId: account.body.id }).expect(201);

      const res = await http.delete(`/income-sources/${source.body.id}`).set(...auth()).expect(409);
      expect(res.body.message).toContain('Désactivez');

      await http.patch(`/income-sources/${source.body.id}`).set(...auth()).send({ status: 'inactif' }).expect(200);
    });
  });

  describe('RLS — un autre foyer ne peut ni modifier ni supprimer', () => {
    it('ChargePlan : 404 depuis un foyer étranger', async () => {
      const { auth: authA } = await newHousehold();
      const { auth: authB } = await newHousehold();
      const category = await http.post('/categories').set(...authA()).send({ name: 'Cat RLS', kind: 'expense' }).expect(201);
      const cp = await http
        .post('/charge-plans')
        .set(...authA())
        .send({ label: 'Foyer A', categoryId: category.body.id, generationMode: 'calendrier_manuel', startDate: '2026-01-01' })
        .expect(201);

      await http.patch(`/charge-plans/${cp.body.id}`).set(...authB()).send({ label: 'Piraté' }).expect(404);
      await http.delete(`/charge-plans/${cp.body.id}`).set(...authB()).expect(404);
    });

    it('IncomeSource : 404 depuis un foyer étranger', async () => {
      const { auth: authA } = await newHousehold();
      const { auth: authB } = await newHousehold();
      const account = await http.post('/accounts').set(...authA()).send({ name: 'BP RLS', type: 'courant', initialBalance: 0 }).expect(201);
      const source = await http
        .post('/income-sources')
        .set(...authA())
        .send({ label: 'Foyer A revenu', usualAmount: 100, defaultAccountId: account.body.id, isRecurring: false })
        .expect(201);

      await http.patch(`/income-sources/${source.body.id}`).set(...authB()).send({ label: 'Piraté' }).expect(404);
      await http.delete(`/income-sources/${source.body.id}`).set(...authB()).expect(404);
    });
  });
});
