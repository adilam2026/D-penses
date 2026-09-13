import { deadlineTemporalStatus } from '../deadlineTemporalStatus';

/**
 * Mini-lot Paiements/Échéances — statut temporel partagé (future/soon/due/
 * overdue), seule règle de seuil de l'app (extraite de HomeScreen.urgencyColor).
 *
 * Comparaison au niveau JOUR CALENDAIRE, jamais un diff de timestamps : une
 * échéance du 13/09 doit rester "due" toute la journée du 13/09 (matin, midi,
 * soir), jamais basculer "overdue" simplement parce que l'heure a avancé —
 * c'était le bug corrigé ici (l'ancienne formule comparait des millisecondes
 * bruts, ce qui faisait perdre "due" dès le milieu d'après-midi).
 *
 * "now" est figé (jest.spyOn(Date, 'now')) pour rendre les horaires testés
 * déterministes, indépendants de l'heure réelle d'exécution des tests.
 */
describe('deadlineTemporalStatus', () => {
  const SEUIL = 7;

  function mockNow(iso: string) {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(iso).getTime());
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('due le matin — échéance du jour, "now" tôt le matin', () => {
    mockNow('2026-09-15T06:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('due en milieu de journée — échéance du jour, "now" à midi', () => {
    mockNow('2026-09-15T13:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('due le soir — échéance du jour, "now" juste avant minuit (jamais overdue malgré l\'heure tardive)', () => {
    mockNow('2026-09-15T23:45:00.000Z');
    expect(deadlineTemporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('veille (échéance datée d\'hier) => overdue', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-14', SEUIL)).toBe('overdue');
  });

  it('lendemain (échéance datée de demain) => soon dans la fenêtre du seuil, future au-delà', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-16', 7)).toBe('soon'); // 1 jour <= seuil 7
    expect(deadlineTemporalStatus('2026-09-16', 0)).toBe('future'); // 1 jour > seuil 0
  });

  it('future — échéance au-delà de la fenêtre "bientôt"', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-23', SEUIL)).toBe('future'); // +8 jours > seuil 7
  });

  it('soon — borne exacte du seuil', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-09-22', SEUIL)).toBe('soon'); // +7 jours = seuil
  });

  it('overdue — date largement dépassée', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-08-01', SEUIL)).toBe('overdue');
  });

  it('soldée/annulée ne sont jamais overdue — aucun statut temporel (null)', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(deadlineTemporalStatus('2026-08-01', SEUIL, 'soldee')).toBeNull();
    expect(deadlineTemporalStatus('2026-08-01', SEUIL, 'annulee')).toBeNull();
    // Une échéance ouverte très en retard, elle, reste overdue (non-régression).
    expect(deadlineTemporalStatus('2026-08-01', SEUIL, 'ouverte')).toBe('overdue');
    expect(deadlineTemporalStatus('2026-08-01', SEUIL, 'partiellement_payee')).toBe('overdue');
  });
});
