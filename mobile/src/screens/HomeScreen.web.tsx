import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { accountCardPalette } from '../ui/theme';
import { Donut } from '../ui/Donut';
import { CardGrid } from '../web/ui/CardGrid.web';
import { KpiTile } from '../web/ui/KpiTile.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../web/webTheme';
// Portail Web v4 §11/§12 — mêmes types + fonctions pures que HomeScreen.tsx
// (homeLogic.ts, source unique) : cette variante Web ne recalcule RIEN, elle
// réagence seulement l'affichage des mêmes données pour un usage desktop.
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

const ACCOUNT_CARD_WIDTH = 220;
const BUDGET_CARD_WIDTH = 260;
const PLAN_CARD_WIDTH = 240;

/**
 * Portail Web v4 §2 — Home desktop repensée à zéro (aucune référence à la
 * Maquette 3 mobile) : bande héro compacte (montant + KPI), puis Comptes /
 * Budgets / Plans en grilles à largeur de carte FIXE (CardGrid, max 5/ligne,
 * jamais une carte étirée), puis Échéances + Projection. Mêmes deux appels
 * réseau que mobile (GET /dashboard/summary + GET /accounts) — même donnée,
 * jamais un second calcul.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeSourcesCount, setIncomeSourcesCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dismissChoiceOpen, setDismissChoiceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
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
    setBannerDismissed(true);
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
  const showConfigBanner = partiallyConfigured && !essentialPrerequisitesMet(accounts, incomeSourcesCount) && !bannerDismissed;
  const upcomingDeadlines = summary.topDeadlines;
  const topPlans = prioritizePlans(summary.financialPlansResume).slice(0, 10);
  const topBudgets = prioritizeBudgets(summary.budgetsResume).slice(0, 10);
  const topAccounts = accounts.slice(0, 10);

  if (fullyEmpty) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollEmpty}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>Bienvenue dans D-Penses+</Text>
          <Text style={styles.welcomeText}>Commençons par configurer vos finances.</Text>
          <TouchableOpacity style={styles.welcomeButton} onPress={() => navigation.getParent()?.navigate('Onboarding')}>
            <Text style={styles.welcomeButtonText}>Commencer</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      {showConfigBanner && (
        <View style={styles.configBanner}>
          <TouchableOpacity style={{ flex: 1 }} onPress={() => navigation.getParent()?.navigate('Onboarding')} testID="config-banner">
            <Text style={styles.configBannerText}>Terminer ma configuration →</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="config-banner-close" style={styles.configBannerClose} onPress={() => setDismissChoiceOpen(true)}>
            <Ionicons name="close" size={16} color={webColors.textSecondary} />
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

      {/* LIGNE 1 — bande héro compacte : montant à gauche, KPI à droite. */}
      <View style={styles.hero}>
        <View style={styles.heroLeft}>
          <Text style={styles.heroLabel}>SITUATION PILOTÉE AUJOURD'HUI</Text>
          <Text style={styles.heroAmount}>{summary.operational_treasury.toLocaleString('fr-FR')} DH</Text>
          <Text style={styles.heroSubtitle}>Comptes inclus dans votre pilotage financier</Text>
          {!summary.is_complete && (
            <Text style={styles.heroWarning}>⚠ Calcul incomplet — {summary.unknown_commitments_count} montant(s) encore inconnu(s).</Text>
          )}
        </View>
        <View style={styles.heroKpis}>
          <KpiTile label="Fin de période" value={`${summary.next_30_days.closing_physical_treasury.toLocaleString('fr-FR')} DH`} />
          <KpiTile
            testID="home-engaged-row"
            label="Disponible après engagements"
            value={`${summary.free_available.toLocaleString('fr-FR')} DH`}
            onPress={() =>
              navigation.getParent()?.navigate('EngagedDetail', {
                committedAmount: summary.committed_amount,
                deadlineItems: summary.deadlineItems,
                variableBudgetItems: summary.variableBudgetItems,
                horizonDate: summary.horizon_date,
                horizonIsFallback: summary.horizon_is_fallback,
              })
            }
          />
          <KpiTile label="Patrimoine total" value={`${summary.patrimoine_liquide_total.toLocaleString('fr-FR')} DH`} testID="home-global-total" />
          <KpiTile
            label="Point bas prévu (30j)"
            value={`${summary.next_30_days.physical_low_point.toLocaleString('fr-FR')} DH`}
            sub={`le ${formatLongDate(summary.next_30_days.physical_low_point_date)}`}
          />
        </View>
      </View>

      {/* LIGNE 2 — Comptes, grille à largeur fixe, max 5/ligne (validé §2). */}
      {topAccounts.length > 0 && (
        <View style={styles.sec}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Mes comptes</Text>
            <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Accounts')}>
              <Text style={styles.sectionLink}>Gérer</Text>
            </TouchableOpacity>
          </View>
          <CardGrid cardWidth={ACCOUNT_CARD_WIDTH} maxColumns={5}>
            {topAccounts.map((a, i) => {
              const masked = !a.includeInOperationalTreasury && !revealedAccountIds[a.id];
              return (
                <TouchableOpacity
                  key={a.id}
                  style={[styles.accountCard, { width: ACCOUNT_CARD_WIDTH, backgroundColor: accountCardPalette[i % accountCardPalette.length] }]}
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
                        <Ionicons name={masked ? 'eye-outline' : 'eye-off-outline'} size={15} color="#fff" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <Text style={styles.accountCardAmount}>{masked ? '•••••• DH' : `${a.soldeCourant.toLocaleString('fr-FR')} DH`}</Text>
                  <Text style={styles.accountCardStatus}>{a.includeInOperationalTreasury ? 'Piloté' : 'Hors pilotage'}</Text>
                </TouchableOpacity>
              );
            })}
          </CardGrid>
        </View>
      )}

      {/* LIGNE 3 — Budgets, grille à largeur fixe, max 5/ligne. */}
      {topBudgets.length > 0 && (
        <View style={styles.sec}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Mes budgets</Text>
            <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Budgets')}>
              <Text style={styles.sectionLink}>Voir tous</Text>
            </TouchableOpacity>
          </View>
          <CardGrid cardWidth={BUDGET_CARD_WIDTH} maxColumns={5}>
            {topBudgets.map((b) => {
              const pct = b.status.budgetPeriode > 0 ? (b.status.consommeADate / b.status.budgetPeriode) * 100 : 0;
              const warn = b.status.healthStatus === 'depasse' || b.status.healthStatus === 'proche_limite';
              return (
                <TouchableOpacity
                  key={b.id}
                  testID={`home-budget-${b.id}`}
                  style={[styles.budgetCard, { width: BUDGET_CARD_WIDTH }]}
                  onPress={() => navigation.getParent()?.navigate('BudgetDetail', { id: b.id })}
                >
                  <View style={styles.budgetCardTop}>
                    <Donut size={44} pct={pct} warn={warn} />
                    <View style={{ flex: 1, marginLeft: webSpacing.sm }}>
                      <Text style={styles.budgetLabel} numberOfLines={1}>
                        {b.categoryName}
                      </Text>
                      <Text style={styles.budgetAmounts}>
                        {b.status.consommeADate.toLocaleString('fr-FR')} / {b.status.budgetPeriode.toLocaleString('fr-FR')} DH
                      </Text>
                    </View>
                  </View>
                  {b.status.rythmeAlerte ? (
                    <Text style={styles.rythmeAlertBadge} testID={`home-budget-rythme-alerte-${b.id}`}>
                      ⚠ Rythme élevé
                    </Text>
                  ) : (
                    <Text style={styles.budgetRemaining}>{b.status.budgetContractuelRestant.toLocaleString('fr-FR')} DH restants</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </CardGrid>
        </View>
      )}

      {/* LIGNE 4 — Plans financiers, même logique. */}
      {topPlans.length > 0 && (
        <View style={styles.sec}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Mes plans financiers</Text>
            <TouchableOpacity onPress={() => navigation.getParent()?.navigate('FinancialPlans')}>
              <Text style={styles.sectionLink}>Voir tous</Text>
            </TouchableOpacity>
          </View>
          <CardGrid cardWidth={PLAN_CARD_WIDTH} maxColumns={5}>
            {topPlans.map((p) => {
              const cost = p.knownPlanCost;
              const paidPct = cost > 0 ? Math.max(0, Math.min(100, (p.paidAmount / cost) * 100)) : 0;
              const provPct = cost > 0 ? Math.max(0, Math.min(100 - paidPct, (p.provisionCoverage / cost) * 100)) : 0;
              return (
                <TouchableOpacity
                  key={p.id}
                  testID={`home-plan-${p.id}`}
                  style={[styles.planCard, { width: PLAN_CARD_WIDTH }]}
                  onPress={() => navigation.getParent()?.navigate('FinancialPlanDetail', { id: p.id })}
                >
                  <Text style={styles.planIcon}>{PLAN_TYPE_ICON[p.planType] ?? PLAN_TYPE_ICON.other}</Text>
                  <Text style={styles.planLabel} numberOfLines={1}>
                    {p.label}
                  </Text>
                  <Text style={styles.planAmount}>{cost.toLocaleString('fr-FR')} DH</Text>
                  <Text style={styles.planSub}>Payé {p.paidAmount.toLocaleString('fr-FR')} DH · Provisionné {p.provisionCoverage.toLocaleString('fr-FR')} DH</Text>
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
          </CardGrid>
        </View>
      )}

      {/* LIGNE 5 — Échéances importantes + Projection côte à côte. */}
      <View style={styles.dashRow}>
        {upcomingDeadlines.length > 0 && (
          <View style={[styles.dashColWide, styles.sec]}>
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

        <View style={[styles.dashColThird, styles.sec]}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>Projection</Text>
          </View>
          <TouchableOpacity testID="home-projection-card" style={styles.projectionCard} onPress={() => navigation.getParent()?.navigate('Projection')}>
            <View style={styles.projKpiGrid}>
              <KpiTile
                variant="light"
                width={150}
                label="Trésorerie prévue"
                value={`${summary.next_30_days.closing_physical_treasury.toLocaleString('fr-FR')} DH`}
              />
              <KpiTile
                variant="light"
                width={150}
                label="Disponible libre"
                value={`${summary.next_30_days.closing_free_capacity.toLocaleString('fr-FR')} DH`}
              />
              <KpiTile
                variant="light"
                width={150}
                label="Point bas"
                value={`${summary.next_30_days.physical_low_point.toLocaleString('fr-FR')} DH`}
                sub={`le ${formatLongDate(summary.next_30_days.physical_low_point_date)}`}
              />
              <KpiTile
                variant="light"
                width={150}
                label="Statut"
                value={PROJECTION_STATUS_LABEL[summary.next_30_days.status]}
              />
            </View>
            {summary.next_30_days.status === 'DEFICIT_PHYSIQUE' && summary.next_30_days.first_negative_date && (
              <Text style={styles.heroWarningInline}>
                Risque de déficit le {formatLongDate(summary.next_30_days.first_negative_date)}
                {summary.next_30_days.deficit_at_first_negative !== null
                  ? ` (${summary.next_30_days.deficit_at_first_negative.toLocaleString('fr-FR')} DH)`
                  : ''}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  scrollEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: webSpacing.xxl },

  welcomeCard: { backgroundColor: webColors.primary, borderRadius: webRadius.xl, padding: webSpacing.xxl, alignItems: 'center', maxWidth: 480, width: '100%' },
  welcomeTitle: { color: webColors.textOnPrimary, fontSize: 20, fontWeight: '700' },
  welcomeText: { color: '#C9D2E0', fontSize: 14, marginTop: 6, textAlign: 'center' },
  welcomeButton: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.xxl, paddingVertical: webSpacing.md, marginTop: webSpacing.lg },
  welcomeButtonText: { color: webColors.textPrimary, fontWeight: '700', fontSize: 14 },

  configBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: webColors.surfaceActive, borderRadius: webRadius.lg, padding: 12, marginBottom: webSpacing.md },
  configBannerText: { color: webColors.textPrimary, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  configBannerClose: { paddingLeft: webSpacing.md, paddingVertical: webSpacing.xs },

  hero: {
    backgroundColor: webColors.sidebarBg,
    borderRadius: webRadius.xl,
    padding: webSpacing.lg,
    marginBottom: webSpacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroLeft: { flexShrink: 0, maxWidth: 300, marginRight: webSpacing.xl },
  heroLabel: { fontSize: 11, fontWeight: '700', color: webColors.sidebarTextMuted, letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontWeight: '900', color: webColors.textOnPrimary, marginTop: 2 },
  heroSubtitle: { fontSize: 12, color: webColors.sidebarTextMuted, marginTop: 4 },
  heroWarning: { fontSize: 11, color: '#FFD79A', marginTop: webSpacing.sm, fontWeight: '600' },
  heroWarningInline: { fontSize: 11, color: webColors.danger, marginTop: webSpacing.sm, fontWeight: '600' },
  heroKpis: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm, justifyContent: 'flex-end' },

  sec: { marginBottom: webSpacing.lg },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  sectionLink: { fontSize: 12, fontWeight: '600', color: webColors.success },

  accountCard: { borderRadius: webRadius.lg, padding: webSpacing.md },
  accountCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountCardName: { fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600', flexShrink: 1, marginRight: webSpacing.xs },
  accountCardAmount: { fontSize: 18, fontWeight: '900', color: '#fff', marginTop: webSpacing.sm },
  accountCardStatus: { fontSize: 10, color: 'rgba(255,255,255,0.85)', marginTop: 2 },

  budgetCard: {
    backgroundColor: webColors.surface,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
  },
  budgetCardTop: { flexDirection: 'row', alignItems: 'center' },
  budgetLabel: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  budgetAmounts: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary, marginTop: 2 },
  budgetRemaining: { fontSize: 11, color: webColors.textSecondary, marginTop: webSpacing.xs },
  rythmeAlertBadge: { fontSize: 11, fontWeight: '700', color: webColors.warning, marginTop: webSpacing.xs },

  planCard: {
    backgroundColor: webColors.surface,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
  },
  planIcon: { fontSize: 18, marginBottom: 4 },
  planLabel: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  planAmount: { fontSize: 15, fontWeight: '800', color: webColors.textPrimary, marginTop: 2 },
  planSub: { fontSize: 10, color: webColors.textSecondary, marginTop: 2 },
  planTrack: { height: 6, borderRadius: 3, backgroundColor: webColors.surfaceMuted, overflow: 'hidden', flexDirection: 'row', marginTop: webSpacing.sm },
  planTrackPaid: { height: '100%', backgroundColor: webColors.success },
  planTrackProv: { height: '100%', backgroundColor: '#7089DF' },
  planRemaining: { fontSize: 10, color: webColors.textSecondary, marginTop: webSpacing.xs },

  dashRow: { flexDirection: 'row', gap: webSpacing.lg },
  dashColWide: { flexGrow: 0, flexBasis: '62%', maxWidth: 900, minWidth: 0 },
  dashColThird: { flexGrow: 0, flexBasis: '34%', maxWidth: 480, minWidth: 0 },

  datePill: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: webSpacing.sm },
  datePillDay: { fontSize: 13, fontWeight: '900', color: '#fff', lineHeight: 15 },
  datePillMonth: { fontSize: 8, fontWeight: '800', color: '#fff', lineHeight: 10 },

  timelineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: webColors.surface,
    borderRadius: webRadius.lg,
    padding: webSpacing.sm,
    marginBottom: webSpacing.xs,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
  },
  timelineLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  timelineLabel: { fontSize: 13, fontWeight: '600', color: webColors.textPrimary },
  coveredBadge: { fontSize: 10, color: webColors.success, fontWeight: '700', marginTop: 2 },
  timelineAmount: { fontSize: 14, fontWeight: '800', color: webColors.textPrimary },

  projectionCard: {
    backgroundColor: webColors.surface,
    borderRadius: webRadius.lg,
    padding: webSpacing.sm,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
  },
  projKpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm },
});
