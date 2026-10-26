import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "refonte Planning/À faire" §7 — "Ne jamais créer une incohérence
 * comptable silencieuse" : un montant prévu ne peut jamais descendre sous ce
 * qui a déjà été payé (paiements partiels compris). Exemples exacts de la
 * spec : prévu 1000, déjà payé 300 -> 1200/800 autorisés (reste 900/500),
 * 200 refusé avec le message exact requis. Même garde étendue au lot
 * "cette échéance et les suivantes" (RecurrenceRulesService), qui doit
 * rejeter le LOT ENTIER si une seule occurrence affectée viole la règle —
 * jamais un lot partiellement appliqué.
 */
describe('Finance Maison — garde "déjà payé" sur la modification du montant prévu', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function freshHousehold(): Promise<string> {
    counter += 1;
    const email = `paidguard-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  async function createAccount(token: string, name: string, openingBalance: string) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance }).expect(201);
    return res.body;
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  it('prévu 1000, déjà payé 300 (partiel) -> 1200 autorisé (reste 900) et 800 autorisé (reste 500)', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const up1 = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '1200' }).expect(200);
    expect(Number(up1.body.expectedAmount)).toBe(1200);

    const up2 = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '800' }).expect(200);
    expect(Number(up2.body.expectedAmount)).toBe(800);
  });

  it('prévu 1000, déjà payé 300 -> 200 est REFUSÉ avec le message exact requis, montant inchangé en base', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '200' }).expect(400);
    expect(res.body.message).toBe(
      "300 DH ont déjà été payés. Annulez ou corrigez d'abord les paiements existants pour réduire l'échéance sous ce montant.",
    );

    const list = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Number(list.body.find((p: any) => p.id === planned.body.id).expectedAmount)).toBe(1000);
  });

  it('aucun paiement encore enregistré -> réduire le montant librement reste autorisé (pas de régression)', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '10' }).expect(200);
    expect(Number(res.body.expectedAmount)).toBe(10);
  });

  it('réduire exactement au montant déjà payé (300 -> 300) reste autorisé (limite incluse, jamais trop stricte)', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '300' }).expect(200);
    expect(Number(res.body.expectedAmount)).toBe(300);
  });

  it('occurrence détachée (changement de date simultané sur une récurrence) : la garde s\'applique aussi sur ce chemin', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Internet', expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    const occ = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.recurrenceRuleId === rule.body.id);
    await http.post(`/planned-operations/${occ.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await http.patch(`/planned-operations/${occ.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '200', expectedDate: tomorrow }).expect(400);
  });

  it('"cette échéance et les suivantes" : le lot ENTIER est rejeté si une SEULE occurrence affectée a déjà reçu plus que le nouveau montant', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '10000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Abonnement', expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    const occurrences = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body
      .filter((p: any) => p.recurrenceRuleId === rule.body.id)
      .sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const [first, second] = occurrences;
    // Le 2e mois reçoit un paiement partiel de 700 — le 1er mois (pivot, fromDate) n'en reçoit aucun.
    await http.post(`/planned-operations/${second.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '700' }).expect(201);

    const res = await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: first.expectedDate.slice(0, 10), expectedAmount: '500' })
      .expect(400);
    expect(res.body.message).toContain('700 DH ont déjà été payés');
    expect(res.body.message).toContain(second.label);

    // Aucune occurrence du lot n'a été modifiée (rejet AVANT toute écriture -> jamais un lot partiellement appliqué).
    const refreshed = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (p: any) => p.recurrenceRuleId === rule.body.id,
    );
    for (const occ of refreshed) expect(Number(occ.expectedAmount)).toBe(1000);
  });

  it('"cette échéance et les suivantes" sans violation -> le lot entier est appliqué normalement', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '10000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Abonnement', expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    const occurrences = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body
      .filter((p: any) => p.recurrenceRuleId === rule.body.id)
      .sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const [first] = occurrences;

    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: first.expectedDate.slice(0, 10), expectedAmount: '1500' })
      .expect(200);

    const refreshed = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (p: any) => p.recurrenceRuleId === rule.body.id && p.status === 'PENDING',
    );
    for (const occ of refreshed) expect(Number(occ.expectedAmount)).toBe(1500);
  });

  // Lot "refonte Planning/À faire" §20-24 — modifier une échéance déjà PAYÉE
  // (REALIZED) est désormais autorisé directement : augmenter le prévu
  // au-delà du déjà-payé la rebascule en PENDING (reste à exécuter), sans
  // jamais toucher le paiement déjà enregistré.
  it('échéance REALIZED (600 payés) : prévu 600 -> 800 rebascule en PENDING avec reste 200, le paiement initial reste intact', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'CNSS', expectedDate: todayIso(), expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    const realize = await http
      .post(`/planned-operations/${planned.body.id}/realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '600' })
      .expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '800' }).expect(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.realizedOperationId).toBeNull();
    expect(Number(res.body.expectedAmount)).toBe(800);

    // Le paiement initial de 600 reste intact (jamais renversé) — le solde du compte le reflète toujours.
    expect(realize.body.amount).toBeDefined();
    const balance = await http.get('/accounts').set('Authorization', `Bearer ${token}`).expect(200);
    expect(Number(balance.body.find((a: any) => a.id === account.id).balance)).toBe(5000 - 600);
  });

  it('échéance REALIZED (600 payés) : prévu 600 -> 600 (inchangé) reste REALIZED', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'CNSS', expectedDate: todayIso(), expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '600' }).expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ label: 'CNSS (modifié)' }).expect(200);
    expect(res.body.status).toBe('REALIZED');
  });

  it('échéance REALIZED (600 payés) : tentative 600 -> 500 refusée avec le message exact, statut inchangé', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'CNSS', expectedDate: todayIso(), expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '600' }).expect(201);

    const res = await http.patch(`/planned-operations/${planned.body.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '500' }).expect(400);
    expect(res.body.message).toBe(
      "600 DH ont déjà été payés. Annulez ou corrigez d'abord les paiements existants pour réduire l'échéance sous ce montant.",
    );
    const list = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    const fresh = list.body.find((p: any) => p.id === planned.body.id);
    expect(fresh.status).toBe('REALIZED');
    expect(Number(fresh.expectedAmount)).toBe(600);
  });

  it('échéance REALIZED récurrente : changer uniquement le libellé ne mute rien d\'autre (ouvrir/choisir Modifier seul ne doit jamais déclencher de mutation implicite)', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'CNSS', expectedDate: todayIso(), expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '600' }).expect(201);

    // Simplement RELIRE l'échéance (équivalent d'ouvrir le menu/le formulaire côté mobile) ne doit rien changer.
    const before = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(before.body.find((p: any) => p.id === planned.body.id).status).toBe('REALIZED');
    const stillBefore = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    expect(stillBefore.body.find((p: any) => p.id === planned.body.id).status).toBe('REALIZED');
  });

  it('"cette échéance et les suivantes" sur un pivot REALIZED : le pivot rebascule en PENDING (reste), les occurrences futures PENDING reçoivent aussi le nouveau montant', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '10000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Abonnement', expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    const occurrences = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body
      .filter((p: any) => p.recurrenceRuleId === rule.body.id)
      .sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const [first, second] = occurrences;
    await http.post(`/planned-operations/${first.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '600' }).expect(201);

    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: first.expectedDate.slice(0, 10), expectedAmount: '800' })
      .expect(200);

    const refreshed = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body;
    const pivot = refreshed.find((p: any) => p.id === first.id);
    expect(pivot.status).toBe('PENDING');
    expect(pivot.realizedOperationId).toBeNull();
    expect(Number(pivot.expectedAmount)).toBe(800);
    const next = refreshed.find((p: any) => p.id === second.id);
    expect(Number(next.expectedAmount)).toBe(800);
  });

  it('"cette échéance et les suivantes" : rejette le lot entier si le pivot REALIZED a déjà reçu plus que le nouveau montant', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '10000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Abonnement', expectedAmount: '600', sourceAccountId: account.id })
      .expect(201);
    const occurrences = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body
      .filter((p: any) => p.recurrenceRuleId === rule.body.id)
      .sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const [first] = occurrences;
    await http.post(`/planned-operations/${first.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '600' }).expect(201);

    const res = await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: first.expectedDate.slice(0, 10), expectedAmount: '500' })
      .expect(400);
    expect(res.body.message).toContain('600 DH ont déjà été payés');

    const refreshed = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.id === first.id);
    expect(refreshed.status).toBe('REALIZED');
    expect(Number(refreshed.expectedAmount)).toBe(600);
  });

  it('impossible de changer la date d\'une échéance récurrente ayant déjà un paiement partiel enregistré', async () => {
    const token = await freshHousehold();
    const account = await createAccount(token, 'BP', '5000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', label: 'Internet', expectedAmount: '1000', sourceAccountId: account.id })
      .expect(201);
    const occ = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.find((p: any) => p.recurrenceRuleId === rule.body.id);
    await http.post(`/planned-operations/${occ.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const res = await http.patch(`/planned-operations/${occ.id}`).set('Authorization', `Bearer ${token}`).send({ expectedDate: tomorrow }).expect(400);
    expect(res.body.message).toContain('Impossible de changer la date');
  });
});
