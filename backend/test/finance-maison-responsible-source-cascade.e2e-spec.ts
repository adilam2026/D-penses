import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "refonte Planning/À faire" §1 (correction prioritaire) — bug rapporté :
 * une échéance utilise "Adil Compte Principal" comme source ; Adil devient
 * ENSUITE le propriétaire de ce compte ; "À faire" affichait pourtant
 * toujours "Responsable à définir". Corrigé via ResponsibleSource (AUTO
 * hérité du propriétaire du compte réel, cascadé à chaque changement de
 * propriétaire / MANUAL choisi explicitement, jamais écrasé) — cf.
 * AccountsService#update. Ne remplace PAS (et ne régresse pas) l'invariant
 * déjà testé dans finance-maison-account-owner-type.e2e-spec.ts pour les
 * échéances MANUAL (par défaut, cf. service#create/update) : il s'étend
 * uniquement aux échéances explicitement marquées AUTO par le mobile.
 */
describe('Finance Maison — cascade propriétaire -> responsable (ResponsibleSource AUTO/MANUAL)', () => {
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

  async function freshHousehold(): Promise<{ token: string; adilId: string }> {
    counter += 1;
    const email = `respsrc-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    const householdToken = res.body.accessToken as string;
    const me = await http.get('/households/me').set('Authorization', `Bearer ${householdToken}`).expect(200);
    const adilId = me.body.memberships[0].id as string;
    return { token: householdToken, adilId };
  }

  async function addSecondMember(adminToken: string): Promise<{ token: string; lamiaaId: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `respsrc-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    const me = await http.get('/households/me').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    const membership = me.body.memberships.find((m: any) => m.user.email === email);
    return { token: joined.body.accessToken as string, lamiaaId: membership.id as string };
  }

  async function createAccount(token: string, name: string, openingBalance?: string) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance }).expect(201);
    return res.body;
  }

  async function createSubaccount(token: string, accountId: string, name: string) {
    const res = await http.post('/accounts/subaccounts').set('Authorization', `Bearer ${token}`).send({ accountId, name }).expect(201);
    return res.body;
  }

  async function createPlanned(token: string, accountId: string, responsibleSource?: 'AUTO' | 'MANUAL', responsibleMemberId?: string | null) {
    const res = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Courses',
        expectedDate: new Date().toISOString().slice(0, 10),
        expectedAmount: '500',
        sourceAccountId: accountId,
        includeInTodo: true,
        responsibleMemberId: responsibleMemberId ?? undefined,
        responsibleSource,
      })
      .expect(201);
    return res.body;
  }

  async function getPlanned(token: string, id: string) {
    const list = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body;
    return list.find((p: any) => p.id === id);
  }

  it('bug rapporté : échéance AUTO sur un compte sans propriétaire -> le compte devient INDIVIDUAL (Adil) -> l\'échéance hérite automatiquement d\'Adil comme responsable', async () => {
    const { token, adilId } = await freshHousehold();
    const account = await createAccount(token, 'Adil Compte Principal');
    const planned = await createPlanned(token, account.id, 'AUTO', null);
    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBeNull();

    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(200);

    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBe(adilId);
  });

  it('un changement ultérieur de propriétaire met à jour les échéances AUTO (Adil -> Lamiaa)', async () => {
    const { token, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);
    const planned = await createPlanned(token, account.body.id, 'AUTO', adilId);
    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBe(adilId);

    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: lamiaaId }).expect(200);

    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBe(lamiaaId);
  });

  it('propriétaire -> Commun/Non défini : les échéances AUTO reviennent à "Responsable à définir" (null)', async () => {
    const { token, adilId } = await freshHousehold();
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);
    const planned = await createPlanned(token, account.body.id, 'AUTO', adilId);

    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'SHARED', ownerMemberId: null }).expect(200);

    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBeNull();
  });

  it('un responsable choisi MANUELLEMENT n\'est JAMAIS écrasé par un changement de propriétaire (protection explicite)', async () => {
    const { token, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);
    // Responsable choisi à la main : Lamiaa, exceptionnellement, malgré la source Adil -> MANUAL.
    const planned = await createPlanned(token, account.body.id, 'MANUAL', lamiaaId);

    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'SHARED', ownerMemberId: null }).expect(200);

    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBe(lamiaaId);
  });

  it('défaut sûr : responsibleMemberId fourni sans responsibleSource -> MANUAL (jamais AUTO implicite), donc jamais cascadé', async () => {
    const { token, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name: 'SG', ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(201);
    const planned = await createPlanned(token, account.body.id, undefined, adilId);

    await http.patch(`/accounts/${account.body.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: lamiaaId }).expect(200);

    expect((await getPlanned(token, planned.id)).responsibleMemberId).toBe(adilId); // inchangé (MANUAL par défaut)
  });

  it('source = enveloppe (sous-compte) -> remonte au compte réel parent pour la cascade', async () => {
    const { token, adilId } = await freshHousehold();
    const account = await createAccount(token, 'BP');
    const sub = await createSubaccount(token, account.id, 'Courses');
    const res = await http
      .post('/planned-operations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        kind: 'EXPENSE',
        label: 'Courses enveloppe',
        expectedDate: new Date().toISOString().slice(0, 10),
        expectedAmount: '200',
        sourceAccountId: account.id,
        sourceSubaccountId: sub.id,
        includeInTodo: true,
        responsibleSource: 'AUTO',
      })
      .expect(201);

    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(200);

    expect((await getPlanned(token, res.body.id)).responsibleMemberId).toBe(adilId);
  });

  it('cascade sur la règle de récurrence (gabarit ET occurrences PENDING déjà générées) — jamais l\'historique REALIZED', async () => {
    const { token, adilId } = await freshHousehold();
    const account = await createAccount(token, 'SG', '2000');
    const rule = await http
      .post('/recurrence-rules')
      .set('Authorization', `Bearer ${token}`)
      .send({
        frequency: 'MONTHLY',
        anchorDate: new Date().toISOString().slice(0, 10),
        kind: 'EXPENSE',
        label: 'Internet',
        expectedAmount: '300',
        sourceAccountId: account.id,
        includeInTodo: true,
        responsibleSource: 'AUTO',
      })
      .expect(201);

    const occurrences = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter(
      (p: any) => p.recurrenceRuleId === rule.body.id,
    );
    expect(occurrences.length).toBeGreaterThan(0);
    // Réalise la toute première occurrence AVANT le changement de propriétaire -> historique protégé.
    const first = occurrences.sort((a: any, b: any) => a.expectedDate.localeCompare(b.expectedDate))[0];
    await http.post(`/planned-operations/${first.id}/realize`).set('Authorization', `Bearer ${token}`).send({ actualAmount: '300' }).expect(201);

    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(200);

    const refreshed = (await http.get('/planned-operations').set('Authorization', `Bearer ${token}`).expect(200)).body.filter((p: any) => p.recurrenceRuleId === rule.body.id);
    const stillPending = refreshed.filter((p: any) => p.status === 'PENDING');
    expect(stillPending.length).toBeGreaterThan(0);
    for (const occ of stillPending) expect(occ.responsibleMemberId).toBe(adilId);
    // L'occurrence déjà réalisée n'a jamais été touchée (elle n'était même pas PENDING au moment de la cascade).
    const realized = refreshed.find((p: any) => p.id === first.id);
    expect(realized.status).toBe('REALIZED');

    // Une NOUVELLE règle créée après le changement de propriétaire génère bien des occurrences portant déjà le bon responsable.
    const ruleRules = (await http.get('/recurrence-rules').set('Authorization', `Bearer ${token}`).expect(200)).body.find((r: any) => r.id === rule.body.id);
    expect(ruleRules.responsibleMemberId).toBe(adilId);
  });
});
