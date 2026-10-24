import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Lot "responsable automatique" — backfill du responsable des anciennes
 * SAVINGS_CONTRIBUTION (déjà includeInTodo=true) depuis le propriétaire
 * STRUCTURÉ (ownerType=INDIVIDUAL + ownerMemberId) de leur compte source.
 * Rejoue EXACTEMENT les deux UPDATE de la migration
 * 20261024224500_backfill_responsible_member_from_account_owner. Jamais
 * déduit du nom du compte, de la banque, d'ownerLabel ou du libellé de
 * l'échéance — uniquement account.owner_type/owner_member_id.
 */
describe('Finance Maison — backfill du responsable depuis le propriétaire structuré du compte', () => {
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
    const email = `rfo-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    const householdToken = res.body.accessToken as string;
    const me = await http.get('/households/me').set('Authorization', `Bearer ${householdToken}`).expect(200);
    return { token: householdToken, householdId: res.body.household.id as string, adilId: me.body.memberships[0].id as string };
  }

  async function addSecondMember(adminToken: string): Promise<{ lamiaaId: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `rfo-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    const me = await http.get('/households/me').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    const membership = me.body.memberships.find((m: any) => m.user.email === email);
    return { lamiaaId: membership.id as string };
  }

  async function createAccount(token: string, name: string, ownerType: 'INDIVIDUAL' | 'SHARED' | 'UNDEFINED', ownerMemberId: string | null) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, ownerType, ownerMemberId: ownerMemberId ?? undefined }).expect(201);
    return res.body;
  }

  function todayIso(): Date {
    return new Date();
  }

  /** Rejoue EXACTEMENT les deux UPDATE de la migration de backfill (jamais le nom du compte, jamais ownerLabel). */
  async function runBackfillMigration() {
    await prisma.$executeRaw`
      UPDATE "planned_operation" po
      SET "responsible_member_id" = acc."owner_member_id"
      FROM "account" acc
      WHERE po."source_account_id" = acc."id"
        AND po."kind" = 'SAVINGS_CONTRIBUTION'
        AND po."responsible_member_id" IS NULL
        AND acc."owner_type" = 'INDIVIDUAL'
        AND acc."owner_member_id" IS NOT NULL`;
    await prisma.$executeRaw`
      UPDATE "recurrence_rule" rr
      SET "responsible_member_id" = acc."owner_member_id"
      FROM "account" acc
      WHERE rr."source_account_id" = acc."id"
        AND rr."kind" = 'SAVINGS_CONTRIBUTION'
        AND rr."responsible_member_id" IS NULL
        AND acc."owner_type" = 'INDIVIDUAL'
        AND acc."owner_member_id" IS NOT NULL`;
  }

  it('source compte propriétaire INDIVIDUAL (Adil) -> responsable backfillé = Adil', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const sgAdil = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);

    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '500', expectedDate: todayIso(), label: 'Épargne', sourceAccountId: sgAdil.id, destinationAccountId: sgAdil.id, includeInTodo: true, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(adilId);
  });

  it('source compte propriétaire INDIVIDUAL (Lamiaa) -> responsable backfillé = Lamiaa', async () => {
    const { token, householdId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const bpLamiaa = await createAccount(token, 'BP Lamiaa', 'INDIVIDUAL', lamiaaId);

    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '300', expectedDate: todayIso(), label: 'Épargne', sourceAccountId: bpLamiaa.id, destinationAccountId: bpLamiaa.id, includeInTodo: true, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(lamiaaId);
  });

  it('source compte SHARED (Commun) -> responsable reste null après backfill', async () => {
    const { token, householdId } = await freshHousehold();
    const compteCommun = await createAccount(token, 'Compte commun', 'SHARED', null);

    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '200', expectedDate: todayIso(), label: 'Épargne', sourceAccountId: compteCommun.id, destinationAccountId: compteCommun.id, includeInTodo: true, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBeNull();
  });

  it('source compte UNDEFINED (propriétaire non défini) -> responsable reste null après backfill', async () => {
    const { token, householdId } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 'UNDEFINED', null);

    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '150', expectedDate: todayIso(), label: 'Épargne', sourceAccountId: compte.id, destinationAccountId: compte.id, includeInTodo: true, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBeNull();
  });

  it('source = enveloppe d\'un compte INDIVIDUAL -> le responsable est résolu via le COMPTE RÉEL (jamais un propriétaire propre à l\'enveloppe)', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const bpLamiaaReal = await createAccount(token, 'BP Lamiaa', 'INDIVIDUAL', adilId); // propriétaire structuré du compte réel
    const enveloppe = await http.post('/accounts/subaccounts').set('Authorization', `Bearer ${token}`).send({ accountId: bpLamiaaReal.id, name: 'Courses' }).expect(201);

    const legacy = await prisma.plannedOperation.create({
      data: {
        householdId,
        kind: 'SAVINGS_CONTRIBUTION',
        expectedAmount: '400',
        expectedDate: todayIso(),
        label: 'Versement Courses',
        sourceAccountId: bpLamiaaReal.id,
        sourceSubaccountId: enveloppe.body.id,
        destinationAccountId: bpLamiaaReal.id,
        includeInTodo: true,
        responsibleMemberId: null,
      },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(adilId);
  });

  it('RecurrenceRule : même règle, pour que les occurrences FUTURES héritent correctement du responsable', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const sgAdil = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);

    const rule = await prisma.recurrenceRule.create({
      data: { householdId, frequency: 'MONTHLY', anchorDate: todayIso(), kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '100', label: 'Virement', sourceAccountId: sgAdil.id, destinationAccountId: sgAdil.id, includeInTodo: true, responsibleMemberId: null },
    });

    await runBackfillMigration();

    const refreshedRule = await prisma.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(refreshedRule.responsibleMemberId).toBe(adilId);

    // Une occurrence générée APRÈS le backfill hérite bien du gabarit corrigé.
    await http.get('/todo').set('Authorization', `Bearer ${token}`).expect(200);
    const generated = await prisma.plannedOperation.findMany({ where: { recurrenceRuleId: rule.id } });
    expect(generated.length).toBeGreaterThan(0);
    expect(generated.every((o) => o.responsibleMemberId === adilId)).toBe(true);
  });

  it('une échéance qui a déjà un responsable explicite n\'est jamais réécrite par le backfill', async () => {
    const { token, householdId, adilId } = await freshHousehold();
    const { lamiaaId } = await addSecondMember(token);
    const sgAdil = await createAccount(token, 'SG Adil', 'INDIVIDUAL', adilId);

    const legacy = await prisma.plannedOperation.create({
      data: { householdId, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '500', expectedDate: todayIso(), label: 'Épargne', sourceAccountId: sgAdil.id, destinationAccountId: sgAdil.id, includeInTodo: true, responsibleMemberId: lamiaaId },
    });

    await runBackfillMigration();

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(refreshed.responsibleMemberId).toBe(lamiaaId); // jamais remplacé par le propriétaire du compte (Adil)
  });
});
