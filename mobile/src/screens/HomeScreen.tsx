import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useBottomInset } from '../ui/useBottomInset';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { accountCardPalette, colors, elevation, radius, spacing } from '../ui/theme';
import { Donut } from '../ui/Donut';
// Architecture Web v3 §11 — types + fonctions pures extraits tels quels vers
// homeLogic.ts (aucun changement de comportement), partagés avec
// HomeScreen.web.tsx : jamais un second calcul métier parallèle (§12).
import {
  Account,
  DashboardSummary,
  PLAN_TYPE_ICON,
  PROJECTION_STATUS_COLOR,
  PROJECTION_STATUS_LABEL,
  essentialPrerequisitesMet,
  formatLongDate,
  isFullyEmpty,
  isPartiallyConfigured,
  prioritizeBudgets,
  prioritizePlans,
  urgencyColor,
} from './homeLogic';

/**
 * Accueil = cockpit (Vague 3 §7-17, passe visuelle Maquette 3). 2 appels API au
 * chargement : GET /dashboard/summary (tout le financier) + GET /accounts (bloc
 * "Mes comptes", absent du résumé dashboard) — jamais de boucle N+1, jamais un
 * recalcul mobile de ce que le backend a déjà calculé.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeSourcesCount, setIncomeSourcesCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dismissChoiceOpen, setDismissChoiceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  // Maquette 3 §2 — masquage local du montant des comptes hors pilotage, état UI
  // pur (jamais persisté, jamais une règle backend) : réinitialisé à chaque
  // chargement d'écran, comme n'importe quel état d'affichage éphémère.
  const [revealedAccountIds, setRevealedAccountIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a, incomeSources, household] = await Promise.all([
        api.getDashboardSummary(),
        api.listAccounts(),
        api.listIncomeSources(),
        api.getMyHousehold(),
      ]);
      setSummary(s);
      setAccounts(a);
      setIncomeSourcesCount(incomeSources.length);
      setBannerDismissed(!!household?.settings?.homeBannerDismissed);
    } finally {
      setLoading(false);
    }
  }, []);

  async function onDismissBanner(permanent: boolean) {
    setDismissChoiceOpen(false);
    if (!permanent) return;
    setBannerDismissed(true); // §13 — jamais réaffiché après ce choix, retour immédiat sans attendre le réseau.
    await api.updateHouseholdSettings({ homeBannerDismissed: true });
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !summary) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!summary) return null;

  const fullyEmpty = isFullyEmpty(summary, accounts);
  const partiallyConfigured = isPartiallyConfigured(summary, accounts);
  // §13 — le bandeau ne s'affiche plus automatiquement dès que les prérequis
  // essentiels sont satisfaits, et jamais après un "Ne plus afficher" explicite.
  const showConfigBanner = partiallyConfigured && !essentialPrerequisitesMet(accounts, incomeSourcesCount) && !bannerDismissed;
  const upcomingDeadlines = summary.topDeadlines;
  const topPlans = prioritizePlans(summary.financialPlansResume).slice(0, 3);
  const topBudgets = prioritizeBudgets(summary.budgetsResume).slice(0, 3);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity testID="hamburger-menu-button" style={styles.menuButton} onPress={() => navigation.getParent()?.navigate('HamburgerMenu')}>
          <Text style={styles.menuButtonText}>☰</Text>
        </TouchableOpacity>
        <Text style={styles.brand}>D-Penses+</Text>
        <View style={styles.menuButton} />
      </View>

      {fullyEmpty ? (
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>Bienvenue dans D-Penses+</Text>
          <Text style={styles.welcomeText}>Commençons par configurer vos finances.</Text>
          <TouchableOpacity style={styles.welcomeButton} onPress={() => navigation.getParent()?.navigate('Onboarding')}>
            <Text style={styles.welcomeButtonText}>Commencer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {showConfigBanner && (
            <View style={styles.configBanner}>
              <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.getParent()?.navigate('Onboarding')} testID="config-banner">
                <Text style={styles.configBannerText}>Terminer ma configuration →</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="config-banner-close" style={styles.configBannerClose} onPress={() => setDismissChoiceOpen(true)}>
                <Ionicons name="close" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
          <ChoiceSheet
            visible={dismissChoiceOpen}
            title="Masquer ce rappel ?"
            testID="dismiss-banner-choice"
            onClose={() => setDismissChoiceOpen(false)}
            options={[
              { key: 'later', label: 'Pas maintenant', onPress: () => onDismissBanner(false) },
              { key: 'forever', label: 'Ne plus afficher', onPress: () => onDismissBanner(true) },
            ]}
          />

          {/* Bloc 1 — Situation pilotée aujourd'hui (Maquette 3 §1) : carte héro
              sombre, montant principal = trésorerie pilotée (comptes inclus dans
              le pilotage), 2 mini-métriques uniquement (Fin de période / Disponible
              après engagements — champs déjà fournis, aucun nouveau calcul).
              Jamais de sparkline fictive : aucune série historique réelle
              n'existe, l'espace est simplement omis. */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>SITUATION PILOTÉE AUJOURD'HUI</Text>
            <Text style={styles.heroAmount}>{summary.operational_treasury.toLocaleString('fr-FR')} DH</Text>
            <Text style={styles.heroSubtitle}>Comptes inclus dans votre pilotage financier</Text>
            {!summary.is_complete && (
              <Text style={styles.heroWarning}>⚠ Calcul incomplet — {summary.unknown_commitments_count} montant(s) encore inconnu(s).</Text>
            )}
            <View style={styles.heroMiniRow}>
              <View style={styles.heroMini}>
                <Text style={styles.heroMiniLabel}>Fin de période</Text>
                <Text style={styles.heroMiniValue}>{summary.next_30_days.closing_physical_treasury.toLocaleString('fr-FR')} DH</Text>
              </View>
              {/* La ligne "Engagé" (EngagedDetail) n'a plus de rangée dédiée dans le
                  héro (2 mini-métriques strictement, Maquette 3) : cette carte reste
                  l'accès à ce détail, cohérent avec ce qu'elle affiche (le disponible
                  net des engagements) — aucune fonctionnalité supprimée. */}
              <TouchableOpacity
                style={styles.heroMini}
                testID="home-engaged-row"
                onPress={() =>
                  navigation.getParent()?.navigate('EngagedDetail', {
                    committedAmount: summary.committed_amount,
                    deadlineItems: summary.deadlineItems,
                    variableBudgetItems: summary.variableBudgetItems,
                    horizonDate: summary.horizon_date,
                    horizonIsFallback: summary.horizon_is_fallback,
                  })
                }
              >
                <Text style={styles.heroMiniLabel}>Disponible après engagements</Text>
                <Text style={styles.heroMiniValue}>{summary.free_available.toLocaleString('fr-FR')} DH</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Bloc 2 — Mes comptes (Maquette 3 §2) : cartes colorées compactes,
              montant masqué par défaut pour un compte hors pilotage (icône œil,
              état purement local). */}
          {accounts.length > 0 && (
            <View style={styles.sec}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Mes comptes</Text>
                <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Accounts')}>
                  <Text style={styles.sectionLink}>Gérer</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.grid2}>
                {accounts.slice(0, 4).map((a, i) => {
                  const masked = !a.includeInOperationalTreasury && !revealedAccountIds[a.id];
                  return (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.accountCard, { backgroundColor: accountCardPalette[i % accountCardPalette.length] }]}
                      onPress={() => navigation.getParent()?.navigate('AccountDetail', { id: a.id })}
                    >
                      <View style={styles.accountCardTopRow}>
                        <Text style={styles.accountCardName} numberOfLines={1}>
                          {a.name}
                        </Text>
                        {!a.includeInOperationalTreasury && (
                          <TouchableOpacity
                            testID={`account-reveal-${a.id}`}
                            onPress={() => setRevealedAccountIds((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                          >
                            <Ionicons name={masked ? 'eye-outline' : 'eye-off-outline'} size={16} color="#fff" />
                          </TouchableOpacity>
                        )}
                      </View>
                      <Text style={styles.accountCardAmount}>{masked ? '•••••• DH' : `${a.soldeCourant.toLocaleString('fr-FR')} DH`}</Text>
                      <Text style={styles.accountCardStatus}>{a.includeInOperationalTreasury ? 'Piloté' : 'Hors pilotage'}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* Dernier cadrage Home — la ligne "Trésorerie pilotée" (doublon du
                  montant déjà affiché en tête du héro) est retirée ici ; le
                  patrimoine global reste affiché en secondaire, jamais recalculé. */}
              <View style={styles.totalRowSecondary}>
                <Text style={styles.totalLabelSecondary}>Patrimoine total (avec hors pilotage)</Text>
                <Text style={styles.totalValueSecondary} testID="home-global-total">{summary.patrimoine_liquide_total.toLocaleString('fr-FR')} DH</Text>
              </View>
            </View>
          )}

          {/* Bloc 3 — Mes budgets (Maquette 3 §3, Lot 3). Donut réel (consommé/
              plafond, déjà calculé), max 3, priorité déjà validée. */}
          {topBudgets.length > 0 && (
            <View style={styles.sec}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Mes budgets</Text>
                <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Budgets')}>
                  <Text style={styles.sectionLink}>Voir tous</Text>
                </TouchableOpacity>
              </View>
              {topBudgets.map((b) => {
                const pct = b.status.budgetPeriode > 0 ? (b.status.consommeADate / b.status.budgetPeriode) * 100 : 0;
                const warn = b.status.healthStatus === 'depasse' || b.status.healthStatus === 'proche_limite';
                return (
                  <TouchableOpacity
                    key={b.id}
                    testID={`home-budget-${b.id}`}
                    style={styles.budgetCard}
                    onPress={() => navigation.getParent()?.navigate('BudgetDetail', { id: b.id })}
                  >
                    <Donut size={64} pct={pct} warn={warn} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={styles.budgetLabel}>{b.categoryName}</Text>
                      <Text style={styles.budgetAmounts}>
                        {b.status.consommeADate.toLocaleString('fr-FR')} / {b.status.budgetPeriode.toLocaleString('fr-FR')} DH
                      </Text>
                      {b.status.rythmeAlerte ? (
                        <Text style={styles.rythmeAlertBadge} testID={`home-budget-rythme-alerte-${b.id}`}>
                          ⚠ Rythme élevé pour la période
                        </Text>
                      ) : (
                        <Text style={styles.budgetRemaining}>{b.status.budgetContractuelRestant.toLocaleString('fr-FR')} DH restent à consommer</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Bloc 4 — Mes plans financiers (Maquette 3 §4) : cartes compactes,
              icône selon planType (mapping strict), payé/provisionné déjà
              exposés par le backend (passthrough), barre segmentée. */}
          {topPlans.length > 0 && (
            <View style={styles.sec}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Mes plans financiers</Text>
                <TouchableOpacity onPress={() => navigation.getParent()?.navigate('FinancialPlans')}>
                  <Text style={styles.sectionLink}>Voir tous</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.grid2}>
                {topPlans.map((p) => {
                  const cost = p.knownPlanCost;
                  const paidPct = cost > 0 ? Math.max(0, Math.min(100, (p.paidAmount / cost) * 100)) : 0;
                  const provPct = cost > 0 ? Math.max(0, Math.min(100 - paidPct, (p.provisionCoverage / cost) * 100)) : 0;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      testID={`home-plan-${p.id}`}
                      style={styles.planCard}
                      onPress={() => navigation.getParent()?.navigate('FinancialPlanDetail', { id: p.id })}
                    >
                      <Text style={styles.planIcon}>{PLAN_TYPE_ICON[p.planType] ?? PLAN_TYPE_ICON.other}</Text>
                      <Text style={styles.planLabel} numberOfLines={1}>
                        {p.label}
                      </Text>
                      <Text style={styles.planAmount}>{cost.toLocaleString('fr-FR')} DH</Text>
                      {/* Dernier cadrage Home — payé/provisionné sur 2 lignes distinctes
                          plutôt qu'une seule ligne "·" (évite un retour à la ligne en
                          plein milieu d'un montant sur les cartes étroites). */}
                      <Text style={styles.planSub}>Payé {p.paidAmount.toLocaleString('fr-FR')} DH</Text>
                      <Text style={styles.planSub}>Provisionné {p.provisionCoverage.toLocaleString('fr-FR')} DH</Text>
                      {cost > 0 && (paidPct > 0 || provPct > 0) && (
                        <View style={styles.planTrack}>
                          <View style={[styles.planTrackPaid, { width: `${paidPct}%` }]} />
                          <View style={[styles.planTrackProv, { width: `${provPct}%` }]} />
                        </View>
                      )}
                      {p.remainingDue > 0 && <Text style={styles.planRemaining}>Reste à financer : {p.remainingDue.toLocaleString('fr-FR')} DH</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Bloc 5 — Échéances importantes (R5 clôture Home §1, Maquette 3 §5) :
              sélection déjà triée par reste à payer décroissant + fenêtre 30 jours
              fixe côté backend (summary.topDeadlines) — jamais retriée ici. Pastille
              date, ligne entière tapable (le bouton Payer direct a été retiré, l'action
              reste disponible dans DeadlineDetailScreen). Pas de contexte secondaire
              inventé : seul chargePlanLabel est réellement exposé aujourd'hui. */}
          {upcomingDeadlines.length > 0 && (
            <View style={styles.sec}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Échéances importantes</Text>
                <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Charges')}>
                  <Text style={styles.sectionLink}>Voir toutes</Text>
                </TouchableOpacity>
              </View>
              {upcomingDeadlines.map((d) => {
                const date = new Date(d.dueDate);
                const color = urgencyColor(d.dueDate, summary.seuil_a_payer_days);
                return (
                  <TouchableOpacity key={d.id} style={styles.timelineItem} onPress={() => navigation.getParent()?.navigate('DeadlineDetail', { id: d.id })}>
                    <View style={styles.timelineLeft}>
                      <View testID={`deadline-date-pill-${d.id}`} style={[styles.datePill, { backgroundColor: color }]}>
                        <Text style={styles.datePillDay}>{date.getDate()}</Text>
                        <Text style={styles.datePillMonth}>{date.toLocaleDateString('fr-FR', { month: 'short' }).toUpperCase()}</Text>
                      </View>
                      <View style={{ flexShrink: 1 }}>
                        <Text style={styles.timelineLabel}>{d.chargePlanLabel}</Text>
                        {d.coverageStatus === 'couverte' && <Text style={styles.coveredBadge}>✓ Couvert</Text>}
                      </View>
                    </View>
                    <Text style={styles.timelineAmount}>{d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH` : 'À confirmer'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Bloc 6 — Projection : contenu/calculs inchangés (next_30_days déjà
              fourni par le Dashboard/moteur Projection), seul le style de titre est
              aligné sur les autres sections. */}
          <View style={styles.sec}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>Projection</Text>
            </View>
            <TouchableOpacity testID="home-projection-card" style={styles.projectionCard} onPress={() => navigation.getParent()?.navigate('Projection')}>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Trésorerie prévue</Text>
                <Text style={styles.breakdownValue}>{summary.next_30_days.closing_physical_treasury.toLocaleString('fr-FR')} DH</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Disponible libre prévu</Text>
                <Text style={styles.breakdownValue}>{summary.next_30_days.closing_free_capacity.toLocaleString('fr-FR')} DH</Text>
              </View>
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Point bas</Text>
                <Text style={styles.breakdownValue}>
                  {summary.next_30_days.physical_low_point.toLocaleString('fr-FR')} DH le {formatLongDate(summary.next_30_days.physical_low_point_date)}
                </Text>
              </View>
              <Text style={[styles.projectionStatus, { color: PROJECTION_STATUS_COLOR[summary.next_30_days.status] }]}>
                {PROJECTION_STATUS_LABEL[summary.next_30_days.status]}
              </Text>
              {summary.next_30_days.status === 'DEFICIT_PHYSIQUE' && summary.next_30_days.first_negative_date && (
                <Text style={styles.heroWarning}>
                  Risque de déficit le {formatLongDate(summary.next_30_days.first_negative_date)}
                  {summary.next_30_days.deficit_at_first_negative !== null
                    ? ` (${summary.next_30_days.deficit_at_first_negative.toLocaleString('fr-FR')} DH)`
                    : ''}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: 56 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  menuButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  menuButtonText: { fontSize: 20, color: colors.textPrimary },
  brand: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },

  welcomeCard: { backgroundColor: colors.primary, borderRadius: 16, padding: spacing.xxl, alignItems: 'center' },
  welcomeTitle: { color: colors.textOnPrimary, fontSize: 18, fontWeight: '700' },
  welcomeText: { color: '#C9D2E0', fontSize: 13, marginTop: 6, textAlign: 'center' },
  welcomeButton: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: spacing.xxl, paddingVertical: spacing.md, marginTop: spacing.lg },
  welcomeButtonText: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },

  configBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceActive, borderRadius: radius.lg, padding: 14, marginBottom: spacing.lg },
  configBannerText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  configBannerClose: { paddingLeft: spacing.md, paddingVertical: spacing.xs },

  // Bloc héro (Maquette 3 §1) — dégradé non disponible (pas de librairie native
  // installable dans cet environnement) : couleur pleine `heroBackground`,
  // approximation la plus proche du dégradé navy→teal de la maquette.
  hero: {
    backgroundColor: colors.heroBackground,
    borderRadius: 24,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...elevation.raised,
  },
  heroLabel: { fontSize: 11, fontWeight: '700', color: colors.heroTextMuted, letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '900', color: colors.textOnPrimary, marginTop: spacing.xs },
  heroSubtitle: { fontSize: 12, color: colors.heroTextMuted, marginTop: 4 },
  heroWarning: { fontSize: 12, color: '#FFD79A', marginTop: spacing.sm, fontWeight: '600' },
  heroMiniRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  heroMini: { flex: 1, backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)' },
  heroMiniLabel: { fontSize: 10, color: colors.heroTextMuted, fontWeight: '700' },
  heroMiniValue: { fontSize: 16, fontWeight: '800', color: colors.textOnPrimary, marginTop: 4 },

  // Structure de section (Maquette 3 §7) — titre en casse normale + lien aligné à
  // droite, HORS carte (contrairement à l'ancien bloc englobant) : chaque élément
  // de la section porte sa propre carte, comme dans la maquette.
  sec: { marginBottom: spacing.xl },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  sectionLink: { fontSize: 12, fontWeight: '600', color: colors.success },

  grid2: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

  accountCard: { width: '48%', borderRadius: radius.xl, padding: spacing.md, marginBottom: spacing.sm, ...elevation.card },
  accountCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountCardName: { fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '600', flexShrink: 1, marginRight: spacing.xs },
  accountCardAmount: { fontSize: 19, fontWeight: '900', color: '#fff', marginTop: spacing.sm },
  accountCardStatus: { fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  totalRowSecondary: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  totalLabelSecondary: { fontSize: 11, color: colors.textSecondary },
  totalValueSecondary: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },

  budgetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  budgetLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  budgetAmounts: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  budgetRemaining: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.xs },
  rythmeAlertBadge: { fontSize: 11, fontWeight: '700', color: colors.warning, marginTop: spacing.xs },

  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  breakdownLabel: { fontSize: 12, color: colors.textSecondary },
  breakdownValue: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },

  datePill: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  datePillDay: { fontSize: 14, fontWeight: '900', color: '#fff', lineHeight: 16 },
  datePillMonth: { fontSize: 9, fontWeight: '800', color: '#fff', lineHeight: 11 },

  timelineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  timelineLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  timelineLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  coveredBadge: { fontSize: 10, color: colors.success, fontWeight: '700', marginTop: 2 },
  timelineAmount: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },

  planCard: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  planIcon: { fontSize: 20, marginBottom: spacing.sm },
  planLabel: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  planAmount: { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },
  planSub: { fontSize: 10, color: colors.textSecondary, marginTop: 2 },
  planTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSecondary, overflow: 'hidden', flexDirection: 'row', marginTop: spacing.sm },
  planTrackPaid: { height: '100%', backgroundColor: colors.success },
  planTrackProv: { height: '100%', backgroundColor: '#7089DF' },
  planRemaining: { fontSize: 10, color: colors.textSecondary, marginTop: spacing.xs },

  projectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  projectionStatus: { fontSize: 12, fontWeight: '800', marginTop: spacing.sm },
});
