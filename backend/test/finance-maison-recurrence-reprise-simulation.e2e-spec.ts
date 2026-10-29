import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { createTestApp } from './setup-app';
import { FakeMailer } from './support/fake-mailer';
import { signupVerified } from './support/signup';
import { MailerService } from '../src/auth/mailer.service';
import { pinClockAt, restoreClock } from './support/clock';
import { simulateRecurrenceReprise } from '../src/common/ledger/recurrence-reprise.util';

/**
 * Outil de reprise — SIMULATION uniquement : classement de chaque ligne
 * existante, action proposée, dates corrigées, aucune écriture.
 * État reproduit : règle mensuelle du 31/08/2026 générée par l'ANCIEN
 * moteur (31/08, 01/10, 01/11, 01/12, 01/01…), lignes sans n°. Horloge au
 * 15/10/2026.
 */
describe('Finance Maison — reprise des récurrences (simulation)', () => {
  let app: INestApplication;
  let http: request.Agent;
  let mailer: FakeMailer;
  let prisma: PrismaService;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    mailer = new FakeMailer();
    app = await createTestApp((builder) => builder.overrideProvider(MailerService).useValue(mailer));
    http = request.agent(app.getHttpServer());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => pinClockAt('2026-10-15T12:00:00Z'));
  afterEach(() => restoreClock());

  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  async function asHousehold<T>(householdId: string, fn: (tx: any) => Promise<T>): Promise<T> {
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_household_id', ${householdId}, true)`;
      return fn(tx);
    });
  }

  async function legacyState() {
    const signup = await signupVerified(http, mailer, `reprise-${Date.now()}@test.local`, '482913', 'Test', 'Reprise');
    const created = (await http.post('/households').set(auth(signup)).send({ name: 'Foyer reprise' }).expect(201)).body;
    const token = created.accessToken as string;
    const householdId = created.household.id as string;
    const compte = (await http.post('/accounts').set(auth(token)).send({ name: 'CIH', openingBalance: '100000' }).expect(201)).body;
    const rule = (
      await http
        .post('/recurrence-rules')
        .set(auth(token))
        .send({ frequency: 'MONTHLY', anchorDate: '2026-08-31', kind: 'EXPENSE', label: 'Loyer', expectedAmount: '1000', sourceAccountId: compte.id })
        .expect(201)
    ).body;
    // Seconde règle, déjà numérotée (créée après le lot) : jamais retouchée.
    const internet = (
      await http
        .post('/recurrence-rules')
        .set(auth(token))
        .send({ frequency: 'MONTHLY', anchorDate: '2026-10-20', kind: 'EXPENSE', label: 'Internet', expectedAmount: '300', sourceAccountId: compte.id })
        .expect(201)
    ).body;

    const ids: Record<string, string> = {};
    const moveInstant = new Date('2026-10-01T10:00:00Z');
    await asHousehold(householdId, async (tx) => {
      await tx.plannedOperation.deleteMany({ where: { recurrenceRuleId: rule.id } });
      const base = { householdId, kind: 'EXPENSE' as const, recurrenceRuleId: rule.id, expectedAmount: 1000, label: 'Loyer', sourceAccountId: compte.id, categoryId: rule.categoryId };
      const make = async (key: string, date: string, extra: Record<string, unknown> = {}) => {
        ids[key] = (await tx.plannedOperation.create({ data: { ...base, expectedDate: day(date), ...extra } })).id;
      };
      await make('aout', '2026-08-31', { status: 'REALIZED' });
      await make('sept', '2026-10-01'); // en retard (passée), intacte
      await make('oct', '2026-11-01'); // future intacte -> recalée au 31/10
      await make('nov', '2026-12-01'); // paiement partiel ajouté plus bas
      await make('dec', '2027-01-01', { expectedAmount: 1200 }); // modifiée (« cette échéance uniquement »)
      await make('jan', '2027-02-01', { status: 'CANCELLED', updatedAt: moveInstant }); // origine d'un ancien déplacement
      await make('fev', '2027-03-01', { status: 'CANCELLED' }); // annulée
      await make('mars', '2027-04-01'); // future intacte -> recalée au 31/03
      await make('horsSerie', '2027-04-15'); // date hors de l'ancienne série
      ids.detache = (
        await tx.plannedOperation.create({
          data: { householdId, kind: 'EXPENSE', recurrenceRuleId: null, expectedAmount: 1000, label: 'Loyer', sourceAccountId: compte.id, expectedDate: day('2027-02-10'), createdAt: moveInstant },
        })
      ).id;
    });
    await http.post(`/planned-operations/${ids.nov}/partial-realize`).set(auth(token)).send({ actualAmount: '400' }).expect(201);
    return { householdId, rule, internet, ids };
  }

  it('classe chaque ligne, propose l’action, calcule la date corrigée — sans rien écrire', async () => {
    const { householdId, rule, internet, ids } = await legacyState();
    const snapshot = async () =>
      asHousehold(householdId, (tx) => tx.plannedOperation.findMany({ where: { householdId }, orderBy: { id: 'asc' } }));
    const before = await snapshot();

    const report = await simulateRecurrenceReprise(prisma, [householdId], new Date('2026-10-15T12:00:00Z'));

    expect(report.mode).toBe('SIMULATION');
    expect(report.totals).toEqual(
      expect.objectContaining({ rules: 2, activeRules: 2, rulesAnchoredOn29To31: 1, conflicts: 0, toRecale: 2 }),
    );
    const loyer = report.rules.find((r) => r.ruleId === rule.id)!;
    expect(loyer).toEqual(expect.objectContaining({ anchorDay: 31, anchorDayFrom29To31: true, seriesVersion: 0 }));
    const row = (key: string) => loyer.rows.find((r) => r.id === ids[key])!;

    expect(row('aout')).toEqual(expect.objectContaining({ category: 'REALISEE', action: 'NUMEROTER', occurrenceIndex: 0, theoreticalDate: '2026-08-31', dateDiffers: false, dateAfter: '2026-08-31' }));
    expect(row('sept')).toEqual(expect.objectContaining({ category: 'INTACTE_PASSEE', action: 'NUMEROTER', occurrenceIndex: 1, theoreticalDate: '2026-09-30', dateDiffers: true, dateAfter: '2026-10-01' }));
    expect(row('oct')).toEqual(expect.objectContaining({ category: 'INTACTE_FUTURE', action: 'NUMEROTER_ET_RECALER', occurrenceIndex: 2, theoreticalDate: '2026-10-31', dateAfter: '2026-10-31' }));
    expect(row('nov')).toEqual(expect.objectContaining({ category: 'PARTIELLEMENT_PAYEE', action: 'NUMEROTER', occurrenceIndex: 3, theoreticalDate: '2026-11-30', dateAfter: '2026-12-01' }));
    expect(row('dec')).toEqual(expect.objectContaining({ category: 'MODIFIEE', action: 'NUMEROTER', occurrenceIndex: 4, theoreticalDate: '2026-12-31', dateAfter: '2027-01-01' }));
    expect(row('jan')).toEqual(expect.objectContaining({ category: 'ORIGINE_DEPLACEMENT', action: 'NUMEROTER', occurrenceIndex: 5, detachedRowId: ids.detache, dateAfter: '2027-02-01' }));
    expect(row('fev')).toEqual(expect.objectContaining({ category: 'ANNULEE', action: 'NUMEROTER', occurrenceIndex: 6, theoreticalDate: '2027-02-28', dateAfter: '2027-03-01' }));
    expect(row('mars')).toEqual(expect.objectContaining({ category: 'INTACTE_FUTURE', action: 'NUMEROTER_ET_RECALER', occurrenceIndex: 7, theoreticalDate: '2027-03-31', dateAfter: '2027-03-31' }));
    expect(row('horsSerie')).toEqual(expect.objectContaining({ category: 'HORS_SERIE', action: 'AUCUNE', occurrenceIndex: null }));

    // Règle déjà numérotée : rien à faire, dates déjà correctes.
    const net = report.rules.find((r) => r.ruleId === internet.id)!;
    expect(net.rows.length).toBeGreaterThan(0);
    expect(net.rows.every((r) => r.category === 'DEJA_NUMEROTEE' && r.action === 'AUCUNE' && !r.dateDiffers)).toBe(true);

    // Aucune écriture.
    expect(await snapshot()).toEqual(before);
  });

  it('la transaction de simulation est en lecture seule : une écriture y échoue', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(`UPDATE "planned_operation" SET "label" = 'x' WHERE false`);
      }),
    ).rejects.toThrow(/read-only/i);
  });
});
