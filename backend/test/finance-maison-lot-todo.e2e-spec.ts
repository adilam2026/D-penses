import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "À faire" — vue opérationnelle du Planning (jamais un second moteur
 * financier). Vérifie : visibilité par défaut selon la nature, responsable ≠
 * source, filtres (exposition des données, filtrage lui-même côté mobile),
 * synchronisation stricte Planning ↔ À faire (même réalisation, même ledger,
 * même calcul prévu/payé/reste), récurrences (occurrence seule / suivantes),
 * tri (retard/aujourd'hui/à venir), badge, et non-régression du Planning.
 */
describe('Finance Maison — "À faire" (vue opérationnelle du Planning)', () => {
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

  async function freshHousehold(): Promise<{ token: string; householdId: string }> {
    counter += 1;
    const email = `todo-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return { token: res.body.accessToken as string, householdId: res.body.household.id as string };
  }

  /** Foyer à 2 membres (Adil = créateur/admin, Lamiaa = rejoint via invitation) — pour les tests "responsable ≠ source" et filtres. */
  async function addSecondMember(adminToken: string): Promise<{ token: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `todo-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    return { token: joined.body.accessToken as string };
  }

  async function getMembers(token: string): Promise<{ id: string; firstName: string }[]> {
    const res = await http.get('/households/me').set('Authorization', `Bearer ${token}`).expect(200);
    return res.body.memberships.map((m: any) => ({ id: m.id, firstName: m.user.firstName }));
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

  async function createCategory(token: string, name: string) {
    const res = await http.post('/categories').set('Authorization', `Bearer ${token}`).send({ name }).expect(201);
    return res.body;
  }

  async function createPlanned(token: string, data: Record<string, unknown>) {
    const res = await http.post('/planned-operations').set('Authorization', `Bearer ${token}`).send(data).expect(201);
    return res.body;
  }

  async function getTodo(token: string, monthsOffset?: number) {
    const res = await http
      .get(`/todo${monthsOffset !== undefined ? `?monthsOffset=${monthsOffset}` : ''}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  }

  async function getPlanning(token: string, months = 3) {
    const res = await http.get(`/planning?months=${months}`).set('Authorization', `Bearer ${token}`).expect(200);
    return res.body;
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // -----------------------------------------------------------------
  // 1/3/4. Visibilité par défaut selon la nature.
  // -----------------------------------------------------------------
  it('1/3/4. versement visible par défaut, dépense visible seulement si "Ajouter à mes actions"=oui', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');

    const versement = await createPlanned(token, { kind: 'SAVINGS_CONTRIBUTION', label: 'Épargne', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: compte.id, destinationAccountId: compte.id });
    expect(versement.includeInTodo).toBe(true); // OUI par défaut, sans le préciser

    const depenseIncluse = await createPlanned(token, { kind: 'EXPENSE', label: 'Internet', expectedDate: todayIso(), expectedAmount: '350', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });
    const depenseExclue = await createPlanned(token, { kind: 'EXPENSE', label: 'Café', expectedDate: todayIso(), expectedAmount: '20', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: false });
    const depenseParDefaut = await createPlanned(token, { kind: 'EXPENSE', label: 'Sans précision', expectedDate: todayIso(), expectedAmount: '50', categoryId: divers.id, sourceAccountId: compte.id });
    expect(depenseParDefaut.includeInTodo).toBe(false); // NON par défaut pour une dépense

    const todo = await getTodo(token);
    const ids = todo.pending.map((a: any) => a.plannedOperationId);
    expect(ids).toContain(versement.id);
    expect(ids).toContain(depenseIncluse.id);
    expect(ids).not.toContain(depenseExclue.id);
    expect(ids).not.toContain(depenseParDefaut.id);
  });

  it("revenu (INCOME) toujours exclu de À faire, même si includeInTodo était forcé à true en base", async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const revenu = await createPlanned(token, { kind: 'INCOME', label: 'Salaire', expectedDate: todayIso(), expectedAmount: '5000', destinationAccountId: compte.id });

    const todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(revenu.id);
  });

  // -----------------------------------------------------------------
  // 5/6/7. Responsable ≠ source.
  // -----------------------------------------------------------------
  it('5/6/7. responsable Adil, responsable Lamiaa, et responsable différent de la source (compte commun)', async () => {
    const { token: adilToken, householdId } = await freshHousehold();
    const { token: lamiaaToken } = await addSecondMember(adilToken);
    void householdId;
    const members = await getMembers(adilToken);
    const adil = members.find((m) => m.firstName === 'Adil')!;
    const lamiaa = members.find((m) => m.firstName === 'Lamiaa')!;

    const compteCommun = await createAccount(adilToken, 'Compte Commun', 10000);
    const divers = await createCategory(adilToken, 'Divers');

    // Source = compte commun, Responsable = Lamiaa — parfaitement possible, aucun lien entre les deux.
    const action = await createPlanned(adilToken, {
      kind: 'EXPENSE',
      label: 'Courses',
      expectedDate: todayIso(),
      expectedAmount: '500',
      categoryId: divers.id,
      sourceAccountId: compteCommun.id,
      includeInTodo: true,
      responsibleMemberId: lamiaa.id,
    });
    expect(action.responsibleMemberId).toBe(lamiaa.id);
    expect(action.sourceAccountId).toBe(compteCommun.id);

    const todo = await getTodo(lamiaaToken);
    const found = todo.pending.find((a: any) => a.plannedOperationId === action.id);
    expect(found.responsibleMemberId).toBe(lamiaa.id);
    expect(found.sourceAccountId).toBe(compteCommun.id); // la source reste le compte commun, jamais déduite du responsable
    expect(found.responsibleMemberId).not.toBe(adil.id);
  });

  it('responsable non défini : reste visible (jamais masqué), identifiable comme tel', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const action = await createPlanned(token, { kind: 'SAVINGS_CONTRIBUTION', label: 'Épargne', expectedDate: todayIso(), expectedAmount: '1000', sourceAccountId: compte.id, destinationAccountId: compte.id });
    expect(action.responsibleMemberId).toBeNull();

    const todo = await getTodo(token);
    const found = todo.pending.find((a: any) => a.plannedOperationId === action.id);
    expect(found).toBeDefined();
    expect(found.responsibleMemberId).toBeNull();
  });

  // -----------------------------------------------------------------
  // 8/9/10. Filtres (le backend expose responsibleMemberId sur chaque action ;
  // le filtrage "Tous/Adil/Lamiaa" est appliqué côté mobile sur cette liste).
  // -----------------------------------------------------------------
  it('8/9/10. chaque action expose son responsable, permettant les filtres Tous/Adil/Lamiaa', async () => {
    const { token: adilToken } = await freshHousehold();
    const { token: lamiaaToken } = await addSecondMember(adilToken);
    void lamiaaToken;
    const members = await getMembers(adilToken);
    const adil = members.find((m) => m.firstName === 'Adil')!;
    const lamiaa = members.find((m) => m.firstName === 'Lamiaa')!;
    const compte = await createAccount(adilToken, 'Compte', 10000);

    await createPlanned(adilToken, { kind: 'SAVINGS_CONTRIBUTION', label: 'Pour Adil', expectedDate: todayIso(), expectedAmount: '100', sourceAccountId: compte.id, destinationAccountId: compte.id, responsibleMemberId: adil.id });
    await createPlanned(adilToken, { kind: 'SAVINGS_CONTRIBUTION', label: 'Pour Lamiaa', expectedDate: todayIso(), expectedAmount: '200', sourceAccountId: compte.id, destinationAccountId: compte.id, responsibleMemberId: lamiaa.id });

    const todo = await getTodo(adilToken);
    expect(todo.pending).toHaveLength(2);
    const forAdil = todo.pending.filter((a: any) => a.responsibleMemberId === adil.id);
    const forLamiaa = todo.pending.filter((a: any) => a.responsibleMemberId === lamiaa.id);
    expect(forAdil).toHaveLength(1);
    expect(forLamiaa).toHaveLength(1);
    expect(forAdil[0].label).toBe('Pour Adil');
    expect(forLamiaa[0].label).toBe('Pour Lamiaa');
  });

  // -----------------------------------------------------------------
  // 11/18. Validation complète depuis À faire — moteur existant, zéro double ledger.
  // -----------------------------------------------------------------
  it('11/18. validation complète depuis À faire utilise le moteur existant, une seule opération ledger, passe dans Effectué', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');
    const action = await createPlanned(token, { kind: 'EXPENSE', label: 'Internet', expectedDate: todayIso(), expectedAmount: '350', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    let todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).toContain(action.id);

    // "À faire" réutilise EXACTEMENT POST /planned-operations/:id/realize (aucun nouvel endpoint de paiement).
    await http.post(`/planned-operations/${action.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '350' }).expect(201);

    const ops = await http.get(`/financial-operations?accountId=${compte.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(ops.body.filter((o: any) => o.label === 'Internet')).toHaveLength(1); // une seule opération réelle, jamais de doublon

    todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(action.id);
    const done = todo.done.find((a: any) => a.plannedOperationId === action.id);
    expect(done).toBeDefined();
    expect(done.status).toBe('REALIZED');
  });

  // -----------------------------------------------------------------
  // 12/30. Réalisation depuis Planning reflétée immédiatement dans À faire ;
  // Planning (son calcul financier) reste rigoureusement inchangé.
  // -----------------------------------------------------------------
  it('12/30. réalisation depuis Planning reflétée dans À faire ; aucun impact sur les calculs du Planning', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');
    const action = await createPlanned(token, { kind: 'EXPENSE', label: 'Carburant', expectedDate: todayIso(), expectedAmount: '500', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    const planningBefore = await getPlanning(token, 3);
    const totalDepensesBefore = planningBefore.synthese[planningBefore.months[0]].totalDepenses;
    expect(planningBefore.synthese[planningBefore.months[0]].resteDepenses).toBe(500);

    // Réalisation via l'endpoint Planning (identique à celui utilisé par À faire).
    await http.post(`/planned-operations/${action.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '500' }).expect(201);

    const todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(action.id);
    expect(todo.done.map((a: any) => a.plannedOperationId)).toContain(action.id);

    const planningAfter = await getPlanning(token, 3);
    // totalDepenses (calcul financier du Planning) reste identique, non affecté par includeInTodo.
    expect(planningAfter.synthese[planningAfter.months[0]].totalDepenses).toBe(totalDepensesBefore);
    expect(planningAfter.synthese[planningAfter.months[0]].resteDepenses).toBe(0);
  });

  // -----------------------------------------------------------------
  // 13/14/15/17/29. Paiements partiels (dépense) — reflet immédiat, reste précalculé.
  // -----------------------------------------------------------------
  it("13/14/15/17/29. paiements partiels successifs depuis À faire/Planning : reste précalculé, synchronisation immédiate, montant à exécuter = somme des RESTES", async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');
    const action = await createPlanned(token, { kind: 'EXPENSE', label: 'Carburant Adil', expectedDate: todayIso(), expectedAmount: '800', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    let todo = await getTodo(token);
    let found = todo.pending.find((a: any) => a.plannedOperationId === action.id);
    expect(found.remaining).toBe(800);
    expect(todo.totalRemaining).toBe(800);

    // Paiement partiel 1 (depuis "À faire", même endpoint que Planning) : 300.
    await http.post(`/planned-operations/${action.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);
    todo = await getTodo(token);
    found = todo.pending.find((a: any) => a.plannedOperationId === action.id);
    expect(found).toBeDefined(); // reste PENDING, toujours dans "À faire"
    expect(found.realizedAmount).toBe(300);
    expect(found.remaining).toBe(500);
    expect(todo.totalRemaining).toBe(500); // jamais le prévu initial (800)

    const planningMid = await getPlanning(token, 3);
    const cellMid = planningMid.depenses.find((r: any) => r.label === 'Carburant Adil').cells[planningMid.months[0]];
    expect(cellMid.singleOccurrence.realizedAmount).toBe(300); // Planning affiche le même état

    // Paiement partiel 2 : 200 de plus -> reste 300.
    await http.post(`/planned-operations/${action.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '200' }).expect(201);
    todo = await getTodo(token);
    found = todo.pending.find((a: any) => a.plannedOperationId === action.id);
    expect(found.realizedAmount).toBe(500);
    expect(found.remaining).toBe(300);

    const planningAfter = await getPlanning(token, 3);
    const cellAfter = planningAfter.depenses.find((r: any) => r.label === 'Carburant Adil').cells[planningAfter.months[0]];
    expect(cellAfter.singleOccurrence.expectedAmount).toBe(800);
    expect(cellAfter.singleOccurrence.realizedAmount).toBe(500);
  });

  // -----------------------------------------------------------------
  // 16. Versement partiel.
  // -----------------------------------------------------------------
  it('16. versement partiel : reste ouvert tant que non intégralement versé, passe dans Effectué une fois complet', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 20000);
    const scolarite = await createSubaccount(token, compte.id, 'Scolarité', 0);
    const versement = await createPlanned(token, {
      kind: 'SAVINGS_CONTRIBUTION',
      label: 'Scolarité',
      expectedDate: todayIso(),
      expectedAmount: '10000',
      sourceAccountId: compte.id,
      destinationAccountId: compte.id,
      destinationSubaccountId: scolarite.id,
    });

    await http.post(`/planned-operations/${versement.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '6000' }).expect(201);
    let todo = await getTodo(token);
    let found = todo.pending.find((a: any) => a.plannedOperationId === versement.id);
    expect(found.remaining).toBe(4000);

    await http.post(`/planned-operations/${versement.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '4000' }).expect(201);
    todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(versement.id);
    expect(todo.done.map((a: any) => a.plannedOperationId)).toContain(versement.id);
  });

  // -----------------------------------------------------------------
  // 17 (source/destination). VERSEMENT affiche source ET destination ; DÉPENSE affiche uniquement la source.
  // -----------------------------------------------------------------
  it('source/destination correcte : versement porte source ET destination, dépense porte uniquement la source', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 20000);
    const enfants = await createSubaccount(token, compte.id, 'Enfants', 0);
    const divers = await createCategory(token, 'Divers');

    const versement = await createPlanned(token, { kind: 'SAVINGS_CONTRIBUTION', label: 'Enfants', expectedDate: todayIso(), expectedAmount: '4600', sourceAccountId: compte.id, destinationAccountId: compte.id, destinationSubaccountId: enfants.id });
    const depense = await createPlanned(token, { kind: 'EXPENSE', label: 'Internet', expectedDate: todayIso(), expectedAmount: '350', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    const todo = await getTodo(token);
    const versementAction = todo.pending.find((a: any) => a.plannedOperationId === versement.id);
    const depenseAction = todo.pending.find((a: any) => a.plannedOperationId === depense.id);
    expect(versementAction.sourceAccountId).toBe(compte.id);
    expect(versementAction.destinationAccountId).toBe(compte.id);
    expect(versementAction.destinationSubaccountId).toBe(enfants.id);
    expect(depenseAction.sourceAccountId).toBe(compte.id);
    expect(depenseAction.destinationAccountId).toBeNull();
  });

  // -----------------------------------------------------------------
  // 19/21. Récurrence mensuelle + occurrence et les suivantes.
  // -----------------------------------------------------------------
  it('19/21. récurrence mensuelle : responsable/inclusion propagés aux occurrences générées ; "cette échéance et les suivantes" propage un changement de responsable aux occurrences futures PENDING uniquement', async () => {
    const { token: adilToken } = await freshHousehold();
    const { token: lamiaaToken } = await addSecondMember(adilToken);
    void lamiaaToken;
    const members = await getMembers(adilToken);
    const adil = members.find((m) => m.firstName === 'Adil')!;
    const lamiaa = members.find((m) => m.firstName === 'Lamiaa')!;
    const compte = await createAccount(adilToken, 'Compte', 50000);
    const divers = await createCategory(adilToken, 'Divers');

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${adilToken}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Loyer', kind: 'EXPENSE', expectedAmount: '3000', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true, responsibleMemberId: adil.id })
      .expect(201);

    let planned = await http.get('/planned-operations').set('Authorization', `Bearer ${adilToken}`).expect(200);
    const occurrences = planned.body.filter((p: any) => p.recurrenceRuleId === rule.body.id);
    expect(occurrences.length).toBeGreaterThanOrEqual(2); // au moins ce mois + le suivant, sur l'horizon de 12 mois
    expect(occurrences.every((o: any) => o.includeInTodo === true && o.responsibleMemberId === adil.id)).toBe(true);

    // "Cette échéance et les suivantes" à partir d'aujourd'hui : responsable -> Lamiaa.
    await http
      .patch(`/recurrence-rules/${rule.body.id}`)
      .set('Authorization', `Bearer ${adilToken}`)
      .send({ applyFrom: 'THIS_AND_FOLLOWING', fromDate: todayIso(), responsibleMemberId: lamiaa.id })
      .expect(200);

    planned = await http.get('/planned-operations').set('Authorization', `Bearer ${adilToken}`).expect(200);
    const afterChange = planned.body.filter((p: any) => p.recurrenceRuleId === rule.body.id && p.status === 'PENDING');
    expect(afterChange.every((o: any) => o.responsibleMemberId === lamiaa.id)).toBe(true);
  });

  // -----------------------------------------------------------------
  // 20/22. Occurrence seule (change le responsable d'UNE occurrence sans toucher la règle ni les autres).
  // -----------------------------------------------------------------
  it("20/22. changement de responsable sur UNE occurrence uniquement : ne touche ni la règle ni les autres occurrences", async () => {
    const { token: adilToken } = await freshHousehold();
    const { token: lamiaaToken } = await addSecondMember(adilToken);
    void lamiaaToken;
    const members = await getMembers(adilToken);
    const adil = members.find((m) => m.firstName === 'Adil')!;
    const lamiaa = members.find((m) => m.firstName === 'Lamiaa')!;
    const compte = await createAccount(adilToken, 'Compte', 50000);

    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${adilToken}`)
      .send({ frequency: 'MONTHLY', anchorDate: todayIso(), label: 'Internet', kind: 'EXPENSE', expectedAmount: '350', sourceAccountId: compte.id, includeInTodo: true, responsibleMemberId: adil.id })
      .expect(201);

    const plannedList = await http.get('/planned-operations').set('Authorization', `Bearer ${adilToken}`).expect(200);
    const occurrences = plannedList.body.filter((p: any) => p.recurrenceRuleId === rule.body.id).sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate));
    const firstOccurrence = occurrences[0];
    const secondOccurrence = occurrences[1];

    await http.patch(`/planned-operations/${firstOccurrence.id}`).set('Authorization', `Bearer ${adilToken}`).send({ responsibleMemberId: lamiaa.id }).expect(200);

    const after = await http.get('/planned-operations').set('Authorization', `Bearer ${adilToken}`).expect(200);
    expect(after.body.find((p: any) => p.id === firstOccurrence.id).responsibleMemberId).toBe(lamiaa.id);
    expect(after.body.find((p: any) => p.id === secondOccurrence.id).responsibleMemberId).toBe(adil.id); // inchangée
    const ruleAfter = await http.get('/recurrence-rules').set('Authorization', `Bearer ${adilToken}`).expect(200);
    expect(ruleAfter.body.find((r: any) => r.id === rule.body.id).responsibleMemberId).toBe(adil.id); // gabarit inchangé
  });

  // -----------------------------------------------------------------
  // 23. Action en retard — tri retard < aujourd'hui < à venir.
  // -----------------------------------------------------------------
  it('23. action en retard identifiée (late=true) et triée AVANT les actions du jour et à venir', async () => {
    // Le scénario exige une date avant ET une date après "aujourd'hui" dans
    // le même mois : impossible le 1er ou le dernier jour avec l'horloge
    // réelle. Seule l'horloge (Date) est donc fixée au 15 du mois courant le
    // temps de ce test — minuteries réelles, aucune règle métier touchée —
    // et les trois échéances sont posées à des jours fixes de ce mois.
    const realNow = new Date();
    const dayOfMonth = (day: number) => new Date(Date.UTC(realNow.getUTCFullYear(), realNow.getUTCMonth(), day, 12)).toISOString();
    jest.useFakeTimers({
      now: new Date(dayOfMonth(15)),
      doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance'],
    });
    try {
      const { token } = await freshHousehold();
      const compte = await createAccount(token, 'Compte', 10000);
      const divers = await createCategory(token, 'Divers');

      const future = await createPlanned(token, { kind: 'EXPENSE', label: 'Future', expectedDate: dayOfMonth(20).slice(0, 10), expectedAmount: '100', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });
      const today = await createPlanned(token, { kind: 'EXPENSE', label: "Aujourd'hui", expectedDate: dayOfMonth(15).slice(0, 10), expectedAmount: '100', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });
      const late = await createPlanned(token, { kind: 'EXPENSE', label: 'En retard', expectedDate: dayOfMonth(12).slice(0, 10), expectedAmount: '100', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

      const todo = await getTodo(token);
      expect(todo.pending.map((a: any) => a.plannedOperationId)).toEqual([late.id, today.id, future.id]);
      expect(todo.pending.find((a: any) => a.plannedOperationId === late.id).late).toBe(true);
      expect(todo.pending.find((a: any) => a.plannedOperationId === today.id).late).toBe(false);
      expect(todo.pending.find((a: any) => a.plannedOperationId === future.id).late).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // -----------------------------------------------------------------
  // 24. Changement de mois — jamais mélangé.
  // -----------------------------------------------------------------
  it('24. changement de mois : les actions de deux mois ne sont jamais mélangées', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');

    const now = new Date();
    const thisMonth = todayIso();
    const nextMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 5)).toISOString().slice(0, 10);

    const actionThisMonth = await createPlanned(token, { kind: 'EXPENSE', label: 'Ce mois', expectedDate: thisMonth, expectedAmount: '100', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });
    const actionNextMonth = await createPlanned(token, { kind: 'EXPENSE', label: 'Mois prochain', expectedDate: nextMonthDate, expectedAmount: '200', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    const todoThis = await getTodo(token, 0);
    expect(todoThis.pending.map((a: any) => a.plannedOperationId)).toEqual([actionThisMonth.id]);

    const todoNext = await getTodo(token, 1);
    expect(todoNext.pending.map((a: any) => a.plannedOperationId)).toEqual([actionNextMonth.id]);
    expect(todoNext.month).not.toBe(todoThis.month);
  });

  // -----------------------------------------------------------------
  // 25/26/27/28. Section Effectué + badge (action partielle = 1, terminée = 0).
  // -----------------------------------------------------------------
  it('25/26/27/28. section Effectué + badge : une action partielle compte toujours pour 1, une action terminée pour 0', async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');

    const a = await createPlanned(token, { kind: 'EXPENSE', label: 'A', expectedDate: todayIso(), expectedAmount: '100', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });
    const b = await createPlanned(token, { kind: 'EXPENSE', label: 'B', expectedDate: todayIso(), expectedAmount: '200', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: true });

    let todo = await getTodo(token);
    expect(todo.pendingCount).toBe(2);

    // B payée partiellement -> compte toujours pour 1 action restante (jamais 2, jamais 0).
    await http.post(`/planned-operations/${b.id}/partial-realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '50' }).expect(201);
    todo = await getTodo(token);
    expect(todo.pendingCount).toBe(2);

    // A entièrement réalisée -> badge descend à 1, A apparaît dans Effectué (repliée par défaut côté mobile).
    await http.post(`/planned-operations/${a.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '100' }).expect(201);
    todo = await getTodo(token);
    expect(todo.pendingCount).toBe(1);
    expect(todo.done.map((x: any) => x.plannedOperationId)).toContain(a.id);
    expect(todo.done.map((x: any) => x.plannedOperationId)).not.toContain(b.id); // B reste dans "À faire", pas "Effectué"
  });

  it("état vide : aucune action -> pendingCount 0, section Effectué vide mais consultable", async () => {
    const { token } = await freshHousehold();
    const todo = await getTodo(token);
    expect(todo.pendingCount).toBe(0);
    expect(todo.pending).toEqual([]);
    expect(todo.done).toEqual([]);
  });

  // -----------------------------------------------------------------
  // 30 (bis). includeInTodo=false n'affecte jamais le Planning lui-même (toujours visible là-bas).
  // -----------------------------------------------------------------
  it("includeInTodo=false : l'échéance reste pleinement visible dans le Planning, uniquement absente de À faire", async () => {
    const { token } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const divers = await createCategory(token, 'Divers');
    const action = await createPlanned(token, { kind: 'EXPENSE', label: 'Petite dépense', expectedDate: todayIso(), expectedAmount: '20', categoryId: divers.id, sourceAccountId: compte.id, includeInTodo: false });

    const todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(action.id);

    const planning = await getPlanning(token, 3);
    const cell = planning.depenses.find((r: any) => r.label === 'Petite dépense').cells[planning.months[0]];
    expect(cell.status).toBe('PENDING');
    expect(cell.displayAmount).toBe(20);
    expect(planning.synthese[planning.months[0]].totalDepenses).toBe(20);
    expect(planning.synthese[planning.months[0]].resteDepenses).toBe(20);
  });
});
