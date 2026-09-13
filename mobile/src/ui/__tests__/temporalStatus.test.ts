import { temporalStatus } from '../temporalStatus';

/**
 * Paiements/Échéances + Virements récurrents — statut temporel partagé
 * (future/soon/due/overdue), seule règle de seuil de l'app (extraite de
 * HomeScreen.urgencyColor, généralisée — jamais spécifique à Deadline,
 * réutilisée telle quelle par les occurrences de virement récurrent).
 *
 * Comparaison au niveau JOUR CALENDAIRE, jamais un diff de timestamps : une
 * date du 13/09 doit rester "due" toute la journée du 13/09 (matin, midi,
 * soir), jamais basculer "overdue" simplement parce que l'heure a avancé —
 * c'était le bug corrigé ici (l'ancienne formule comparait des millisecondes
 * bruts, ce qui faisait perdre "due" dès le milieu d'après-midi).
 *
 * "now" est figé (jest.spyOn(Date, 'now')) pour rendre les horaires testés
 * déterministes, indépendants de l'heure réelle d'exécution des tests.
 */
describe('temporalStatus', () => {
  const SEUIL = 7;

  function mockNow(iso: string) {
    jest.spyOn(Date, 'now').mockReturnValue(new Date(iso).getTime());
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('due le matin — date du jour, "now" tôt le matin', () => {
    mockNow('2026-09-15T06:00:00.000Z');
    expect(temporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('due en milieu de journée — date du jour, "now" à midi', () => {
    mockNow('2026-09-15T13:00:00.000Z');
    expect(temporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('due le soir — date du jour, "now" juste avant minuit (jamais overdue malgré l\'heure tardive)', () => {
    mockNow('2026-09-15T23:45:00.000Z');
    expect(temporalStatus('2026-09-15', SEUIL)).toBe('due');
  });

  it('veille (date d\'hier) => overdue', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-09-14', SEUIL)).toBe('overdue');
  });

  it('lendemain (date de demain) => soon dans la fenêtre du seuil, future au-delà', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-09-16', 7)).toBe('soon'); // 1 jour <= seuil 7
    expect(temporalStatus('2026-09-16', 0)).toBe('future'); // 1 jour > seuil 0
  });

  it('future — date au-delà de la fenêtre "bientôt"', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-09-23', SEUIL)).toBe('future'); // +8 jours > seuil 7
  });

  it('soon — borne exacte du seuil', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-09-22', SEUIL)).toBe('soon'); // +7 jours = seuil
  });

  it('overdue — date largement dépassée', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-08-01', SEUIL)).toBe('overdue');
  });

  it('un événement clos (isClosed=true) n\'est jamais overdue — aucun statut temporel (null)', () => {
    mockNow('2026-09-15T12:00:00.000Z');
    expect(temporalStatus('2026-08-01', SEUIL, true)).toBeNull();
    // Un événement ouvert (isClosed=false/undefined) très en retard, lui, reste overdue (non-régression).
    expect(temporalStatus('2026-08-01', SEUIL, false)).toBe('overdue');
    expect(temporalStatus('2026-08-01', SEUIL)).toBe('overdue');
  });
});
