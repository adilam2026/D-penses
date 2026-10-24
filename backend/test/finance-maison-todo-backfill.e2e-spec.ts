import request from 'supertest';
import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';

/**
 * Backfill contrôlé "À faire" (correction recette, §15-§19) — cause exacte
 * de l'écran vide constatée : la migration initiale a volontairement laissé
 * includeInTodo=false sur TOUTES les échéances/règles déjà en base (jamais
 * de rétroactivité implicite). Ce fichier rejoue, sur des lignes insérées
 * directement (simulant des données ANTÉRIEURES au lot "À faire"), l'EXACTE
 * même instruction SQL que la migration
 * 20261024000000_backfill_savings_contribution_include_in_todo : seules les
 * VERSEMENTS (SAVINGS_CONTRIBUTION) rejoignent "À faire", jamais les
 * dépenses/revenus existants, jamais de responsable inventé.
 */
describe('Finance Maison — backfill "À faire" des échéances/règles de versement déjà existantes', () => {
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

  async function freshHousehold(): Promise<{ token: string; householdId: string }> {
    counter += 1;
    const email = `backfill-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Adil', `User${counter}`);
    const res = await http.post('/households').set('Authorization', `Bearer ${token}`).send({ name: `Foyer ${counter}` }).expect(201);
    return { token: res.body.accessToken as string, householdId: res.body.household.id as string };
  }

  async function addSecondMember(adminToken: string): Promise<{ token: string; memberId: string }> {
    const invite = await http.post('/households/invites').set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    counter += 1;
    const email = `backfill-lamiaa-${counter}-${Date.now()}@test.local`;
    const token = await signupVerified(http, mailer, email, 'Password123!', 'Lamiaa', `User${counter}`);
    const joined = await http.post('/households/join').set('Authorization', `Bearer ${token}`).send({ code: invite.body.code }).expect(201);
    const me = await http.get('/households/me').set('Authorization', `Bearer ${joined.body.accessToken}`).expect(200);
    const membership = me.body.memberships.find((m: any) => m.user.email === email);
    return { token: joined.body.accessToken as string, memberId: membership.id as string };
  }

  async function createAccount(token: string, name: string, openingBalance?: number) {
    const res = await http.post('/accounts').set('Authorization', `Bearer ${token}`).send({ name, openingBalance: openingBalance?.toString() }).expect(201);
    return res.body;
  }

  async function getTodo(token: string, monthsOffset?: number) {
    const res = await http
      .get(`/todo${monthsOffset !== undefined ? `?monthsOffset=${monthsOffset}` : ''}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body;
  }

  function todayIso(): Date {
    return new Date();
  }

  /** Rejoue EXACTEMENT les deux UPDATE de la migration de backfill, scopés au foyer testé (la vraie migration n'a pas cette restriction — elle doit couvrir TOUS les foyers — mais le résultat est identique pour celui-ci, et le scope évite toute interférence avec les autres foyers créés par la suite de tests). */
  async function runBackfillMigration(householdId: string) {
    await prisma.$executeRaw`UPDATE "planned_operation" SET "include_in_todo" = true WHERE "household_id" = ${householdId} AND "kind" = 'SAVINGS_CONTRIBUTION' AND "include_in_todo" = false`;
    await prisma.$executeRaw`UPDATE "recurrence_rule" SET "include_in_todo" = true WHERE "household_id" = ${householdId} AND "kind" = 'SAVINGS_CONTRIBUTION' AND "include_in_todo" = false`;
  }

  it('ancien SAVINGS_CONTRIBUTION (includeInTodo=false, données "antérieures au lot") -> includeInTodo=true après backfill, visible dans "Tous" avec "Responsable à définir", compté dans le badge et le montant à exécuter', async () => {
    const { token, householdId } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const epargne = await createAccount(token, 'Épargne', 500);

    // Simule une échéance de versement créée AVANT le lot "À faire" : includeInTodo=false, aucun responsable.
    const legacy = await prisma.plannedOperation.create({
      data: {
        householdId,
        kind: 'SAVINGS_CONTRIBUTION',
        expectedAmount: '1000',
        expectedDate: todayIso(),
        label: 'Épargne mensuelle',
        sourceAccountId: compte.id,
        destinationAccountId: epargne.id,
        includeInTodo: false,
        responsibleMemberId: null,
      },
    });

    // Avant backfill : exactement la panne constatée en recette.
    let todo = await getTodo(token);
    expect(todo.pendingCount).toBe(0);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(legacy.id);

    await runBackfillMigration(householdId);

    todo = await getTodo(token);
    const action = todo.pending.find((a: any) => a.plannedOperationId === legacy.id);
    expect(action).toBeDefined();
    expect(action.responsibleMemberId).toBeNull(); // jamais inventé par le backfill
    expect(todo.pendingCount).toBe(1); // compte bien dans le badge/N actions restantes, responsable ou non
    expect(todo.totalRemaining).toBe(1000);
  });

  it('ancienne RecurrenceRule SAVINGS_CONTRIBUTION -> includeInTodo=true après backfill ; les occurrences déjà générées ET les futures héritent toutes de la règle corrigée', async () => {
    const { token, householdId } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);
    const epargne = await createAccount(token, 'Épargne', 500);

    // Règle "antérieure au lot" : includeInTodo=false sur le gabarit.
    const rule = await prisma.recurrenceRule.create({
      data: {
        householdId,
        frequency: 'MONTHLY',
        anchorDate: todayIso(),
        kind: 'SAVINGS_CONTRIBUTION',
        expectedAmount: '200',
        label: 'Virement épargne récurrent',
        sourceAccountId: compte.id,
        destinationAccountId: epargne.id,
        includeInTodo: false,
        responsibleMemberId: null,
      },
    });

    // Génère les occurrences (plusieurs mois) SOUS l'ancien includeInTodo=false — simule
    // des planned_operation déjà matérialisées avant le lot "À faire".
    await getTodo(token); // déclenche ensurePlannedOccurrences côté serveur
    const generatedBefore = await prisma.plannedOperation.findMany({ where: { recurrenceRuleId: rule.id } });
    expect(generatedBefore.length).toBeGreaterThan(0);
    expect(generatedBefore.every((o) => o.includeInTodo === false)).toBe(true);

    let todo = await getTodo(token);
    expect(todo.pendingCount).toBe(0); // rien ce mois, la panne constatée

    await runBackfillMigration(householdId);

    // §19 : les occurrences DÉJÀ générées sont corrigées (jamais seulement la règle).
    const generatedAfter = await prisma.plannedOperation.findMany({ where: { recurrenceRuleId: rule.id } });
    expect(generatedAfter.every((o) => o.includeInTodo === true)).toBe(true);

    todo = await getTodo(token);
    expect(todo.pendingCount).toBe(1);

    // Mois suivant : "À faire" doit aussi la montrer (jamais seulement le mois courant).
    const todoNextMonth = await getTodo(token, 1);
    expect(todoNextMonth.pendingCount).toBe(1);

    // Une occurrence FUTURE, au-delà de l'horizon déjà généré, hérite bien du
    // gabarit CORRIGÉ (includeInTodo=true) — jamais seulement les lignes déjà
    // matérialisées avant le backfill (§19 : "sinon le problème reviendra au mois suivant").
    const rule2 = await prisma.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(rule2.includeInTodo).toBe(true);
  });

  it('ancienne EXPENSE (includeInTodo=false) : le backfill ne l\'active JAMAIS automatiquement', async () => {
    const { token, householdId } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);

    const legacyExpense = await prisma.plannedOperation.create({
      data: { householdId, kind: 'EXPENSE', expectedAmount: '50', expectedDate: todayIso(), label: 'Internet', sourceAccountId: compte.id, includeInTodo: false, responsibleMemberId: null },
    });

    await runBackfillMigration(householdId);

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacyExpense.id } });
    expect(refreshed.includeInTodo).toBe(false);

    const todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(legacyExpense.id);
  });

  it('ancien INCOME (includeInTodo=false) : reste false après backfill, jamais visible dans À faire', async () => {
    const { token, householdId } = await freshHousehold();
    const compte = await createAccount(token, 'Compte', 10000);

    const legacyIncome = await prisma.plannedOperation.create({
      data: { householdId, kind: 'INCOME', expectedAmount: '15000', expectedDate: todayIso(), label: 'Salaire', destinationAccountId: compte.id, includeInTodo: false, responsibleMemberId: null },
    });

    await runBackfillMigration(householdId);

    const refreshed = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacyIncome.id } });
    expect(refreshed.includeInTodo).toBe(false);

    const todo = await getTodo(token);
    expect(todo.pending.map((a: any) => a.plannedOperationId)).not.toContain(legacyIncome.id);
    expect(todo.done.map((a: any) => a.plannedOperationId)).not.toContain(legacyIncome.id);
  });

  it('action backfillée sans responsable : affectation ultérieure fonctionne, jamais déduite automatiquement du compte source', async () => {
    const { token, householdId } = await freshHousehold();
    const { memberId: lamiaaId } = await addSecondMember(token);
    const compte = await createAccount(token, 'Compte Adil', 10000); // propriétaire implicite Adil, jamais utilisé comme responsable
    const epargne = await createAccount(token, 'Épargne', 500);

    const legacy = await prisma.plannedOperation.create({
      data: {
        householdId,
        kind: 'SAVINGS_CONTRIBUTION',
        expectedAmount: '600',
        expectedDate: todayIso(),
        label: 'Épargne commune',
        sourceAccountId: compte.id,
        destinationAccountId: epargne.id,
        includeInTodo: false,
        responsibleMemberId: null,
      },
    });
    await runBackfillMigration(householdId);

    let todo = await getTodo(token);
    let action = todo.pending.find((a: any) => a.plannedOperationId === legacy.id);
    expect(action.responsibleMemberId).toBeNull(); // jamais déduit du compte source (Adil)

    // Affectation ultérieure explicite à Lamiaa — RESPONSABLE ≠ SOURCE reste possible.
    await http.patch(`/planned-operations/${legacy.id}`).set('Authorization', `Bearer ${token}`).send({ responsibleMemberId: lamiaaId }).expect(200);

    todo = await getTodo(token);
    action = todo.pending.find((a: any) => a.plannedOperationId === legacy.id);
    expect(action.responsibleMemberId).toBe(lamiaaId);
  });

  it('plusieurs foyers : le backfill scopé à un foyer n\'affecte jamais les échéances d\'un autre foyer', async () => {
    const { token: tokenA, householdId: householdA } = await freshHousehold();
    const { token: tokenB, householdId: householdB } = await freshHousehold();
    const compteA = await createAccount(tokenA, 'Compte A', 5000);
    const compteB = await createAccount(tokenB, 'Compte B', 5000);

    const legacyA = await prisma.plannedOperation.create({
      data: { householdId: householdA, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '100', expectedDate: todayIso(), label: 'Versement A', sourceAccountId: compteA.id, destinationAccountId: compteA.id, includeInTodo: false, responsibleMemberId: null },
    });
    const legacyB = await prisma.plannedOperation.create({
      data: { householdId: householdB, kind: 'SAVINGS_CONTRIBUTION', expectedAmount: '200', expectedDate: todayIso(), label: 'Versement B', sourceAccountId: compteB.id, destinationAccountId: compteB.id, includeInTodo: false, responsibleMemberId: null },
    });

    await runBackfillMigration(householdA); // uniquement le foyer A

    const refreshedA = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacyA.id } });
    const refreshedB = await prisma.plannedOperation.findUniqueOrThrow({ where: { id: legacyB.id } });
    expect(refreshedA.includeInTodo).toBe(true);
    expect(refreshedB.includeInTodo).toBe(false); // jamais touché par le backfill d'un autre foyer
  });
});
