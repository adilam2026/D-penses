import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "Planning — source au paiement + modification des échéances" — tests
 * obligatoires 1-14 (spécification verbatim) :
 *  1-3  échéance ponctuelle : montant / date / source prévue.
 *  4-5  récurrence "cette échéance uniquement" : une seule occurrence change, les suivantes non.
 *  6-7  récurrence "cette échéance et les suivantes" : pivot + futures changent (montant).
 *  8    modification de la fréquence (THIS_AND_FOLLOWING).
 *  9    le passé/déjà réalisé reste intact dans tous les cas ci-dessus.
 *  10   annuler une seule occurrence d'une récurrence.
 *  11   arrêter une série à partir d'une occurrence.
 *  12   payer depuis une source différente de la source prévue.
 *  13   paiement partiel depuis une enveloppe.
 *  14   la source choisie au paiement ne modifie jamais la série/l'échéance prévue.
 */
describe('Finance Maison — Planning : source au paiement + modification des échéances', () => {
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
    const email = `planning-edit-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Test', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return res.body.accessToken as string;
  }

  async function createAccount(token: string, name: string, openingBalance?: number) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance: openingBalance?.toString() }).expect(201);
    return res.body;
  }

  async function createSubaccount(token: string, accountId: string, name: string, initialAllocation?: number) {
    const res = await http
      .post('/accounts/subaccounts')
      .set('Authorization', `Bearer ${token}`)
      .send({ accountId, name, initialAllocation: initialAllocation?.toString() })
      .expect(201);
    return res.body;
  }

  async function getAccount(token: string, id: string) {
    const res = await http.get(`/accounts/${id}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  async function getPlanning(token: string, months = 6) {
    const res = await http.get(`/planning?months=${months}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  async function listPlanned(token: string) {
    const res = await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200);
    return res.body as any[];
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function isoPlusDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // -----------------------------------------------------------------
  // 1-3. Échéance PONCTUELLE : modifier montant / date / source prévue.
  // -----------------------------------------------------------------
  it("1-2. modifier le montant ET la date d'une échéance ponctuelle (exemple Internet 350/15 -> 400/20)", async () => {
    const token = await freshHousehold();
    const lamiaa = await createAccount(token, 'Compte Lamiaa', 20000);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Internet', expectedDate: isoPlusDays(10), expectedAmount: '350', sourceAccountId: lamiaa.id })
      .expect(201);

    const updated = await http
      .patch(`/planned-operations/${planned.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedAmount: '400', expectedDate: isoPlusDays(15) })
      .expect(200);

    expect(updated.body.id).toBe(planned.body.id); // ponctuelle : même ligne, jamais une recréation
    expect(updated.body.label).toBe('Internet');
    expect(updated.body.expectedAmount).toBe(400);
    expect(updated.body.expectedDate.slice(0, 10)).toBe(isoPlusDays(15));
    expect(updated.body.sourceAccountId).toBe(lamiaa.id); // inchangé, non touché par cette modif
  });

  it('3. modifier la source prévue (enveloppe) d\'une échéance ponctuelle', async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Famille', 10000);
    const courses = await createSubaccount(token, compte.id, 'Courses', 2000);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Courses du mois', expectedDate: isoPlusDays(5), expectedAmount: '300', sourceAccountId: compte.id })
      .expect(201);
    expect(planned.body.sourceSubaccountId).toBeNull();

    const updated = await http
      .patch(`/planned-operations/${planned.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceAccountId: compte.id, sourceSubaccountId: courses.id })
      .expect(200);

    expect(updated.body.sourceAccountId).toBe(compte.id);
    expect(updated.body.sourceSubaccountId).toBe(courses.id);

    // Re-choisir le compte principal direct doit bien EFFACER le sous-compte
    // (jamais une fusion champ par champ qui garderait l'ancienne enveloppe).
    const back = await http
      .patch(`/planned-operations/${planned.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceAccountId: compte.id })
      .expect(200);
    expect(back.body.sourceSubaccountId).toBeNull();
  });

  // -----------------------------------------------------------------
  // 4-5. Récurrence — "cette échéance uniquement" : une seule occurrence
  // change, les suivantes (et la règle) restent inchangées.
  // -----------------------------------------------------------------
  it("4-5. \"cette échéance uniquement\" (montant) ne change que l'occurrence visée", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 6);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const [octobre, novembre, decembre] = occurrences;

    await http.patch(`/planned-operations/${novembre.id}`).set('Authorization', `Bearer ${token}`).send({ expectedAmount: '420' }).expect(200);

    const after = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id);
    expect(after.find((o) => o.id === octobre.id).expectedAmount).toBe(350);
    expect(after.find((o) => o.id === novembre.id).expectedAmount).toBe(420);
    expect(after.find((o) => o.id === decembre.id).expectedAmount).toBe(350);

    // La règle elle-même (gabarit) n'est jamais touchée par "cette échéance uniquement".
    const ruleAfter = await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ruleAfter.body.find((r: any) => r.id === rule.body.id).expectedAmount).toBe(350);
  });

  it('"cette échéance uniquement" avec changement de DATE détache l\'occurrence sans créer de fantôme ni perturber la série', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 6);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const novembre = occurrences[1];
    const novembreOldDate = novembre.expectedDate.slice(0, 10);
    const movedDate = isoPlusDays(45);

    const moved = await http.patch(`/planned-operations/${novembre.id}`).set('Authorization', `Bearer ${token}`).send({ expectedDate: movedDate }).expect(200);
    expect(moved.body.id).not.toBe(novembre.id); // détachée : nouvelle ligne autonome
    expect(moved.body.recurrenceRuleId).toBeNull();
    expect(moved.body.expectedDate.slice(0, 10)).toBe(movedDate);
    expect(moved.body.expectedAmount).toBe(350);

    // Régénère/relit la fenêtre : la ligne d'origine à l'ancienne date reste
    // présente mais CANCELLED (c'est elle qui bloque toute régénération
    // fantôme à cette date) — jamais une seconde ligne PENDING à cette même
    // date, et les autres occurrences de la règle restent intactes (350).
    await getPlanning(token, 12);
    const stillThere = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id);
    const atOldDate = stillThere.filter((o) => o.expectedDate.slice(0, 10) === novembreOldDate);
    expect(atOldDate).toHaveLength(1);
    expect(atOldDate[0].status).toBe('CANCELLED');
    expect(stillThere.filter((o) => o.status === 'PENDING').every((o) => o.expectedAmount === 350)).toBe(true);
  });

  // -----------------------------------------------------------------
  // 6-7-9. Récurrence — "cette échéance et les suivantes" : pivot + futures
  // changent, le passé/déjà réalisé reste intact.
  // -----------------------------------------------------------------
  it('6-7-9. "cette échéance et les suivantes" (montant) : pivot + futures changent, passé et réalisé intacts', async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 6);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const [octobre, novembre, decembre] = occurrences;

    // Octobre est déjà payé (réalisé) AVANT la modification — doit rester intact.
    await http.post(`/planned-operations/${octobre.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '350' }).expect(201);

    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: novembre.expectedDate.slice(0, 10), expectedAmount: '400' })
      .expect(200);

    const after = await listPlanned(token);
    const octobreAfter = after.find((o) => o.id === octobre.id);
    const novembreAfter = after.find((o) => o.id === novembre.id);
    const decembreAfter = after.find((o) => o.id === decembre.id);

    expect(octobreAfter.status).toBe('REALIZED');
    expect(octobreAfter.expectedAmount).toBe(350); // déjà réalisé -> jamais recalculé rétroactivement
    expect(novembreAfter.expectedAmount).toBe(400); // pivot
    expect(decembreAfter.expectedAmount).toBe(400); // future

    // Le gabarit de la règle lui-même est mis à jour (les occurrences générées
    // plus tard, au-delà de l'horizon déjà matérialisé, doivent aussi suivre).
    const ruleAfter = await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ruleAfter.body.find((r: any) => r.id === rule.body.id).expectedAmount).toBe(400);
  });

  // -----------------------------------------------------------------
  // 8. Modification de la fréquence (+ jour de référence) — THIS_AND_FOLLOWING.
  // -----------------------------------------------------------------
  it("8. modifier la fréquence (mensuel -> trimestriel) et le jour de référence à partir d'un pivot, en réutilisant le référentiel existant", async () => {
    const token = await freshHousehold();
    const lamiaa = await createAccount(token, 'Compte Lamiaa', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: lamiaa.id })
      .expect(201);
    await getPlanning(token, 12);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const pivot = occurrences[1]; // "décembre" dans l'exemple de la spec
    const newPivotDate = isoPlusDays(50); // nouveau jour de référence (ex. le 20)

    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: pivot.expectedDate.slice(0, 10), expectedAmount: '400', frequency: 'QUARTERLY', anchorDate: newPivotDate })
      .expect(200);

    const ruleAfter = await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200);
    const updatedRule = ruleAfter.body.find((r: any) => r.id === rule.body.id);
    expect(updatedRule.frequency).toBe('QUARTERLY');
    expect(updatedRule.anchorDate.slice(0, 10)).toBe(newPivotDate);
    expect(updatedRule.expectedAmount).toBe(400);

    await getPlanning(token, 12);
    const after = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));

    // Aucune occurrence ne doit plus exister à l'ancienne cadence mensuelle au-delà du pivot.
    expect(after.some((o) => o.id === occurrences[2]?.id)).toBe(false); // ancienne 3e occurrence (mensuelle) disparue
    // La nouvelle occurrence pivot existe bien, à sa nouvelle date, avec le nouveau montant.
    const newPivot = after.find((o) => o.expectedDate.slice(0, 10) === newPivotDate);
    expect(newPivot).toBeDefined();
    expect(newPivot.expectedAmount).toBe(400);
    // Les occurrences avant le pivot (ex. "octobre") restent sous l'ancienne cadence/montant.
    const before = after.find((o) => o.id === occurrences[0].id);
    expect(before.expectedAmount).toBe(350);
  });

  // -----------------------------------------------------------------
  // 10. Annuler UNE SEULE occurrence d'une récurrence.
  // -----------------------------------------------------------------
  it("10. annuler une seule occurrence d'une récurrence laisse les autres intactes et ne recrée jamais de fantôme", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 6);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const novembre = occurrences[1];

    await http.post(`/planned-operations/${novembre.id}/cancel`).set('Authorization', `Bearer ${token}`).expect(201);

    let after = await listPlanned(token);
    expect(after.find((o) => o.id === novembre.id).status).toBe('CANCELLED');
    expect(after.filter((o) => o.recurrenceRuleId === rule.body.id && o.status === 'PENDING')).toHaveLength(occurrences.length - 1);

    // Relire le Planning (régénération) ne doit jamais faire réapparaître novembre.
    await getPlanning(token, 12);
    after = await listPlanned(token);
    const novembreRows = after.filter((o) => o.recurrenceRuleId === rule.body.id && o.expectedDate.slice(0, 10) === novembre.expectedDate.slice(0, 10));
    expect(novembreRows).toHaveLength(1);
    expect(novembreRows[0].status).toBe('CANCELLED');
  });

  // -----------------------------------------------------------------
  // 11. Arrêter une série à partir d'une occurrence.
  // -----------------------------------------------------------------
  it("11. arrêter la série à partir d'une occurrence : pivot + futures annulées, l'avant-pivot reste intact, plus aucune génération au-delà", async () => {
    const token = await freshHousehold();
    const cih = await createAccount(token, 'CIH', 20000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: cih.id })
      .expect(201);
    await getPlanning(token, 12);

    const occurrences = (await listPlanned(token)).filter((p) => p.recurrenceRuleId === rule.body.id).sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
    const [octobre, novembre] = occurrences;

    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: novembre.expectedDate.slice(0, 10), active: false })
      .expect(200);

    const after = await listPlanned(token);
    expect(after.find((o) => o.id === octobre.id).status).toBe('PENDING'); // avant le pivot : intact
    const fromPivot = after.filter((o) => o.recurrenceRuleId === rule.body.id && o.expectedDate >= novembre.expectedDate);
    expect(fromPivot.every((o) => o.status === 'CANCELLED')).toBe(true);

    const ruleAfter = await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200);
    expect(ruleAfter.body.find((r: any) => r.id === rule.body.id).active).toBe(false);

    // Même après relecture du Planning, aucune nouvelle occurrence ne doit être générée.
    await getPlanning(token, 12);
    const final = await listPlanned(token);
    expect(final.filter((o) => o.recurrenceRuleId === rule.body.id && o.status === 'PENDING')).toHaveLength(1); // seulement octobre
  });

  // -----------------------------------------------------------------
  // 12-13-14. Payer depuis une source différente (compte principal vs
  // enveloppe), paiement partiel depuis une enveloppe, et vérification que
  // ce choix ne modifie jamais la définition prévue de l'échéance.
  // -----------------------------------------------------------------
  it('12-13-14. exemple de la spec : Épargne 9600 / Enfants 9600 / non affecté 0 — paiement partiel de 100 depuis "Enfants"', async () => {
    const token = await freshHousehold();
    const epargne = await createAccount(token, 'Compte Épargne', 9600);
    const enfants = await createSubaccount(token, epargne.id, 'Enfants', 9600);
    expect((await getAccount(token, epargne.id)).nonAffecte).toBe(0);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Échéance', expectedDate: todayIso(), expectedAmount: '800', sourceAccountId: epargne.id })
      .expect(201);

    // Un paiement direct (sans override, source prévue = compte principal) de
    // 100 DH serait refusé : non affecté = 0 (règle validée précédemment).
    await http.post(`/planned-operations/${planned.body.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '100' }).expect(400);

    // En choisissant "Enfants" comme source RÉELLE de ce paiement : accepté,
    // bien que le non affecté soit à 0.
    await http
      .post(`/planned-operations/${planned.body.id}/partial-realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '100', sourceAccountId: epargne.id, sourceSubaccountId: enfants.id })
      .expect(201);

    const afterAccount = await getAccount(token, epargne.id);
    expect(afterAccount.balance).toBe(9500); // 9600 - 100
    expect(afterAccount.subaccounts.find((s: any) => s.id === enfants.id).balance).toBe(9500); // Enfants 9600 -> 9500
    expect(afterAccount.nonAffecte).toBe(0); // jamais touché par un paiement financé via une enveloppe

    // 14. La source choisie au paiement ne modifie JAMAIS la définition prévue
    // de l'échéance : le reste à payer (700) reste rattaché au compte Épargne
    // direct, pas à "Enfants".
    const plannedAfter = (await listPlanned(token)).find((p) => p.id === planned.body.id);
    expect(plannedAfter.status).toBe('PENDING');
    expect(plannedAfter.expectedAmount).toBe(700);
    expect(plannedAfter.sourceAccountId).toBe(epargne.id);
    expect(plannedAfter.sourceSubaccountId).toBeNull();

    // Payer le reste (700) intégralement, cette fois depuis le compte
    // principal direct — refusé car non affecté toujours à 0.
    await http.post(`/planned-operations/${planned.body.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '700' }).expect(400);

    // ... mais accepté depuis "Enfants" à nouveau (sources différentes à chaque paiement, §9).
    await http
      .post(`/planned-operations/${planned.body.id}/realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '700', sourceAccountId: epargne.id, sourceSubaccountId: enfants.id })
      .expect(201);

    const finalAccount = await getAccount(token, epargne.id);
    expect(finalAccount.balance).toBe(8800); // 9600 - 100 - 700
    expect(finalAccount.subaccounts.find((s: any) => s.id === enfants.id).balance).toBe(8800);
    expect(finalAccount.nonAffecte).toBe(0);

    const plannedFinal = (await listPlanned(token)).find((p) => p.id === planned.body.id);
    expect(plannedFinal.status).toBe('REALIZED');
  });

  it("12. réaliser une échéance planifiée depuis le compte principal en choisissant une enveloppe différente au moment du paiement (total)", async () => {
    const token = await freshHousehold();
    const compte = await createAccount(token, 'Compte Famille', 5000);
    const courses = await createSubaccount(token, compte.id, 'Courses', 1000);

    const planned = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({ kind: 'EXPENSE', label: 'Dépense', expectedDate: todayIso(), expectedAmount: '200', sourceAccountId: compte.id })
      .expect(201);

    await http
      .post(`/planned-operations/${planned.body.id}/realize`)
      .set('Authorization', `Bearer ${token}`)
      .send({ actualAmount: '200', sourceAccountId: compte.id, sourceSubaccountId: courses.id })
      .expect(201);

    const after = await getAccount(token, compte.id);
    expect(after.balance).toBe(4800);
    expect(after.subaccounts.find((s: any) => s.id === courses.id).balance).toBe(800);
    expect(after.nonAffecte).toBe(4000); // 5000 - 1000, jamais touché par ce paiement
  });
});
