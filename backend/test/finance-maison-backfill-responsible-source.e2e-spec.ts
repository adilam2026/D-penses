import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "refonte Planning/À faire" — correction du backfill (retour recette) :
 * rejoue EXACTEMENT les requêtes de la migration
 * 20261025010000_backfill_responsible_source_from_owner contre des
 * échéances "legacy" (créées directement via Prisma, comme avant ce lot,
 * donc responsible_source=MANUAL par défaut) pour couvrir le cas réel
 * rapporté : une échéance EXPENSE existante dont le responsable est encore
 * vide, dont le compte source devient INDIVIDUAL APRÈS coup.
 */
describe('Finance Maison — backfill responsible_source depuis le propriétaire du compte (données existantes)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let prisma: PrismaService;
  let counter = 0;

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function freshHousehold(): Promise<{ token: string; householdId: string; adilId: string }> {
    counter += 1;
    const email = `bfrs-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    const householdToken = res.body.accessToken as string;
    const me = await http.get('/households/me').set('Authorization', `Bearer ${householdToken}`).expect(200);
    return { token: householdToken, householdId: res.body.household.id as string, adilId: me.body.memberships[0].id as string };
  }

  async function addSecondMember(adminToken: string): Promise<{ lamiaaId: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `bfrs-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    const me = await http.get('/households/me').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    const membership = me.body.memberships.find((m: any) => m.user.email === email);
    return { lamiaaId: membership.id as string };
  }

  async function createAccount(token: string, name: string, ownerType: 'INDIVIDUAL' | 'SHARED' | 'UNDEFINED' = 'UNDEFINED', ownerMemberId: string | null = null, openingBalance?: string) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, ownerType, ownerMemberId: ownerMemberId ?? undefined, openingBalance }).expect(201);
    return res.body;
  }

  function todayIso(): Date {
    return new Date();
  }

  /** Rejoue EXACTEMENT les requêtes de la migration 20261025010000. */
  async function runBackfillMigration() {
    await prisma.$executeRaw`UPDATE "planned_operation" SET "responsible_source" = 'MANUAL' WHERE "responsible_member_id" IS NOT NULL`;
    await prisma.$executeRaw`UPDATE "recurrence_rule" SET "responsible_source" = 'MANUAL' WHERE "responsible_member_id" IS NOT NULL`;
    await prisma.$executeRaw`
      UPDATE "planned_operation" po
      SET "responsible_source" = 'AUTO', "responsible_member_id" = acc."owner_member_id"
      FROM "account" acc
      WHERE po."source_account_id" = acc."id"
        AND po."status" = 'PENDING'
        AND po."responsible_member_id" IS NULL
        AND acc."owner_type" = 'INDIVIDUAL'`;
    await prisma.$executeRaw`
      UPDATE "recurrence_rule" rr
      SET "responsible_source" = 'AUTO', "responsible_member_id" = acc."owner_member_id"
      FROM "account" acc
      WHERE rr."source_account_id" = acc."id"
        AND rr."responsible_member_id" IS NULL
        AND acc."owner_type" = 'INDIVIDUAL'`;
    await prisma.$executeRaw`UPDATE "planned_operation" SET "responsible_source" = 'AUTO' WHERE "status" = 'PENDING' AND "responsible_member_id" IS NULL AND "responsible_source" <> 'AUTO'`;
    await prisma.$executeRaw`UPDATE "recurrence_rule" SET "responsible_source" = 'AUTO' WHERE "responsible_member_id" IS NULL AND "responsible_source" <> 'AUTO'`;
  }

  it('scénario réel rapporté : EXPENSE "Courses" sur "Adil Compte Principal", responsable vide -> propriétaire défini APRÈS coup (Adil) -> backfill hérite automatiquement Adil (AUTO)', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    // Le compte existe d'abord SANS propriétaire (comme dans le cas réel).
    const account = await createAccount(token, 'Adil Compte Principal');
    const courses = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '500', expectedDate: todayIso(), label: 'Courses', sourceAccountId: account.id, responsibleMemberId: null },
    });
    expect((await prisma.plannedOperation.findUniqueOrThrow({ where: { id: courses.id } })).responsibleSource).toBe('MANUAL'); // défaut avant backfill

    // Le propriétaire est défini APRÈS coup (comme dans le cas réel) — avant que le backfill ne tourne.
    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(200);

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: courses.id } });
    expect(refreshed.responsibleMemberId).toBe(adilId);
    expect(refreshed.responsibleSource).toBe('AUTO');
  });

  it('EXPENSE existante, responsable vide, compte DÉJÀ INDIVIDUAL au moment du backfill -> hérite directement', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const account = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);
    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '300', expectedDate: todayIso(), label: 'Internet', sourceAccountId: account.id, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(adilId);
    expect(refreshed.responsibleSource).toBe('AUTO');
  });

  it('responsable déjà explicitement renseigné -> MANUAL, jamais réécrit par le backfill (même si le propriétaire du compte diffère)', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);
    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '500', expectedDate: todayIso(), label: 'Courses', sourceAccountId: account.id, responsibleMemberId: lamiaaId },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(lamiaaId); // jamais remplacé par Adil
    expect(refreshed.responsibleSource).toBe('MANUAL');
  });

  it('compte SHARED/UNDEFINED -> responsable reste NULL mais devient AUTO (éligible à une cascade future)', async () => {
    const { token, householdId } = await freshHousehold();
    const compteCommun = await createAccount(token, 'Compte commun', 'SHARED', null);
    const compteUndef = await createAccount(token, 'Compte X');
    const legacyCommun = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '200', expectedDate: todayIso(), label: 'Dépense commune', sourceAccountId: compteCommun.id, responsibleMemberId: null },
    });
    const legacyUndef = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '150', expectedDate: todayIso(), label: 'Dépense X', sourceAccountId: compteUndef.id, responsibleMemberId: null },
    });

    await runBackfillMigration();

    for (const id of [legacyCommun.id, legacyUndef.id]) {
      const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id } });
      expect(refreshed.responsibleMemberId).toBeNull();
      expect(refreshed.responsibleSource).toBe('AUTO');
    }
  });

  it('source = enveloppe/sous-compte -> résout le COMPTE RÉEL parent (jamais un propriétaire propre à l\'enveloppe)', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const account = await createAccount(token, 'BP', 'INDIVIDUAL', adilId);
    const enveloppe = await http.post('/accounts/subaccounts').set('Authorization', `Bearer ${token}`).send({ accountId: account.id, name: 'Courses' }).expect(201);
    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '400', expectedDate: todayIso(), label: 'Courses enveloppe', sourceAccountId: account.id, sourceSubaccountId: enveloppe.body.id, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(adilId);
    expect(refreshed.responsibleSource).toBe('AUTO');
  });

  it('opération déjà RÉALISÉE ou ANNULÉE : jamais touchée par le backfill, aucune modification de l\'historique financier', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const account = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId, '5000');
    const realized = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '300', expectedDate: todayIso(), label: 'Déjà payé', sourceAccountId: account.id, responsibleMemberId: null, status: 'REALIZED' },
    });
    const cancelled = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '100', expectedDate: todayIso(), label: 'Déjà annulé', sourceAccountId: account.id, responsibleMemberId: null, status: 'CANCELLED' },
    });

    await runBackfillMigration();

    const refreshedRealized = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: realized.id } });
    const refreshedCancelled = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: cancelled.id } });
    expect(refreshedRealized.responsibleMemberId).toBeNull();
    expect(refreshedRealized.responsibleSource).toBe('MANUAL'); // jamais passé à AUTO : pas une échéance PENDING
    expect(refreshedCancelled.responsibleMemberId).toBeNull();
    expect(refreshedCancelled.responsibleSource).toBe('MANUAL');
  });

  it('RecurrenceRule legacy : même règle, gabarit corrigé -> les occurrences générées ENSUITE héritent déjà du bon responsable', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const account = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);
    const rule = await prisma.recurrenceRule.create({
      data: { householdId, frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'EXPENSE', expectedAmount: '300', label: 'Internet', sourceAccountId: account.id, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshedRule = await prisma.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(refreshedRule.responsibleMemberId).toBe(adilId);
    expect(refreshedRule.responsibleSource).toBe('AUTO');

    await http.get('/todo').set('Authorization', `Bearer ${token}`).expect(200);
    const generated = await prisma.plannedOperation.findMany({ where: { recurrenceRuleId: rule.id } });
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((o) => o.responsibleMemberId === adilId && o.responsibleSource === 'AUTO')).toBe(true);
  });

  it('bout en bout : après backfill, un NOUVEAU changement de propriétaire continue de cascader uniquement les échéances AUTO (réutilise AccountsService#update déjà testé)', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const account = await createAccount(token, 'Adil Compte Principal');
    const courses = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '500', expectedDate: todayIso(), label: 'Courses', sourceAccountId: account.id, responsibleMemberId: null },
    });

    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: adilId }).expect(200);
    await runBackfillMigration();
    expect((await prisma.plannedOperation.findUniqueOrThrow({ where: { id: courses.id } })).responsibleMemberId).toBe(adilId);

    // Nouveau changement de propriétaire après le backfill -> cascade toujours correcte.
    await http.patch(`/accounts/${account.id}`).set('Authorization', `Bearer ${token}`).send({ ownerType: 'INDIVIDUAL', ownerMemberId: lamiaaId }).expect(200);
    expect((await prisma.plannedOperation.findUniqueOrThrow({ where: { id: courses.id } })).responsibleMemberId).toBe(lamiaaId);
  });
});
