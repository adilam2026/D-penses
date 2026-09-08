import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useBottomInset } from '../ui/useBottomInset';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { colors, elevation, radius, spacing } from '../ui/theme';

interface Account {
  id: string;
  name: string;
  soldeCourant: number;
  includeInOperationalTreasury: boolean;
}

interface DeadlineItem {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  coverageStatus: 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet';
}

interface FinancialPlanResume {
  id: string;
  label: string;
  knownPlanCost: number;
  remainingDue: number;
  provisionCoverage: number;
  tauxCouverture: number | null;
  nextDeadlineDate: string | null;
  hasOverdue: boolean;
  completude: string;
}

interface ActionItem {
  kind:
    | 'facture_attendue'
    | 'montant_inconnu'
    | 'montant_a_confirmer'
    | 'option_a_decider'
    | 'provision_insuffisante'
    | 'contribution_a_confirmer'
    | 'objectif_en_retard';
  chargePlanId?: string;
  deadlineId?: string;
  provisionId?: string;
  pocketMovementId?: string;
  goalId?: string;
  message: string;
}

interface DashboardSummary {
  seuil_a_payer_days: number;
  operational_treasury: number;
  free_available: number;
  reserved_amount: number;
  committed_amount: number;
  safety_buffer: number;
  patrimoine_liquide_total: number;
  is_complete: boolean;
  contains_estimates: boolean;
  unknown_commitments_count: number;
  deadlineItems: DeadlineItem[];
  optionsEnvisagees: { total: number; hasUnknown: boolean };
  actionsATraiter: ActionItem[];
  budgetsResume: Array<{ id: string; categoryName: string }>;
  financialPlansResume: FinancialPlanResume[];
  provisionsResume: Array<{ id: string; name: string; currentAmount: number; totalResteAPayer: number; totalUncovered: number }>;
  next_30_days: {
    closing_physical_treasury: number;
    closing_free_capacity: number;
    physical_low_point: number;
    physical_low_point_date: string;
    free_capacity_low_point: number;
    free_capacity_low_point_date: string;
    first_negative_date: string | null;
    deficit_at_first_negative: number | null;
    status: 'OK' | 'TENSION' | 'DEFICIT_PHYSIQUE' | 'INCOMPLETE';
    is_complete: boolean;
  };
}

const PROJECTION_STATUS_LABEL: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: 'Situation maîtrisée',
  TENSION: 'Attention : marge faible',
  DEFICIT_PHYSIQUE: 'Risque de déficit',
  INCOMPLETE: 'Projection incomplète',
};

const PROJECTION_STATUS_COLOR: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: colors.success,
  TENSION: colors.warning,
  DEFICIT_PHYSIQUE: colors.danger,
  INCOMPLETE: colors.textSecondary,
};

/**
 * §19 — un foyer tout juste créé (aucun compte ET aucune autre donnée) n'est plus
 * "empty" pour un motif technique (ex. un compte à 0 DH volontairement) : on
 * distingue explicitement l'absence totale de configuration d'une simple valeur nulle.
 */
function isFullyEmpty(summary: DashboardSummary, accounts: Account[]): boolean {
  return (
    accounts.length === 0 &&
    summary.deadlineItems.length === 0 &&
    summary.budgetsResume.length === 0 &&
    summary.financialPlansResume.length === 0 &&
    summary.provisionsResume.length === 0
  );
}

function isPartiallyConfigured(summary: DashboardSummary, accounts: Account[]): boolean {
  return accounts.length > 0 && !isFullyEmpty(summary, accounts);
}

/**
 * Recette téléphone réel §13 — prérequis ESSENTIELS (distincts des étapes
 * facultatives d'onboarding, toujours accessibles depuis Paramètres) : au moins
 * un compte et au moins un revenu planifié. Le foyer ne "déclare" nulle part
 * s'il a des enfants avant d'en créer un — la clause "si le foyer a déclaré des
 * enfants" du cahier des charges est donc un no-op tant qu'aucun tel indicateur
 * n'existe dans le modèle (documenté explicitement, pas une omission silencieuse).
 */
function essentialPrerequisitesMet(accounts: Account[], incomeSourcesCount: number): boolean {
  return accounts.length > 0 && incomeSourcesCount > 0;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

// §12 — hiérarchie simple, jamais un tableau multicolore : en retard (rouge),
// très proche (orange, seuil du foyer — seuil_a_payer_days, déjà chargé avec le
// dashboard : jamais un second appel réseau, jamais une valeur dupliquée en dur ici),
// à venir (neutre).
function urgencyColor(dueDate: string, seuilAPayerDays: number): string {
  const days = Math.floor((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (days < 0) return colors.danger;
  if (days <= seuilAPayerDays) return colors.warning;
  return colors.textPrimary;
}

// Correctif post-Vague 3 — règle déterministe et documentée à 5 niveaux, réutilisant
// EXCLUSIVEMENT des champs déjà calculés côté backend (FinancialPlansService.detailOnTx) :
// jamais de logique métier parallèle recalculée ici. Un plan avec une échéance ouverte
// proche (ex. demain) ne doit jamais être masqué par un plan moins urgent uniquement
// parce que son reste à financer est supérieur — d'où la proximité d'échéance en tête,
// avant le montant :
//  1) retard (échéance ouverte dépassée) d'abord ;
//  2) puis échéance ouverte la plus proche (null = aucune échéance ouverte, en dernier) ;
//  3) puis reste à financer décroissant ;
//  4) puis taux de couverture croissant (le moins couvert = le plus urgent) ;
//  5) tie-breaker stable par id (jamais l'ordre de création/réponse API).
function prioritizePlans(plans: FinancialPlanResume[]): FinancialPlanResume[] {
  return [...plans].sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;

    if (a.nextDeadlineDate !== b.nextDeadlineDate) {
      if (a.nextDeadlineDate === null) return 1;
      if (b.nextDeadlineDate === null) return -1;
      const diff = new Date(a.nextDeadlineDate).getTime() - new Date(b.nextDeadlineDate).getTime();
      if (diff !== 0) return diff;
    }

    if (a.remainingDue !== b.remainingDue) return b.remainingDue - a.remainingDue;

    const aCov = a.tauxCouverture ?? 100;
    const bCov = b.tauxCouverture ?? 100;
    if (aCov !== bCov) return aCov - bCov;

    return a.id.localeCompare(b.id);
  });
}

function actionTarget(a: ActionItem): { route: string; params: Record<string, string> } | null {
  switch (a.kind) {
    case 'facture_attendue':
    case 'montant_inconnu':
    case 'montant_a_confirmer':
      return a.deadlineId ? { route: 'ConfirmDeadline', params: { id: a.deadlineId } } : null;
    case 'option_a_decider':
      return { route: 'Charges', params: {} };
    case 'provision_insuffisante':
      return a.provisionId ? { route: 'PocketDetail', params: { kind: 'provision', id: a.provisionId } } : null;
    case 'contribution_a_confirmer':
      return a.provisionId ? { route: 'PocketDetail', params: { kind: 'provision', id: a.provisionId } } : { route: 'Enveloppes', params: {} };
    case 'objectif_en_retard':
      return a.goalId ? { route: 'GoalDetail', params: { id: a.goalId } } : null;
    default:
      return null;
  }
}

/**
 * Accueil = cockpit (Vague 3 §7-17). 2 appels API au chargement : GET
 * /dashboard/summary (tout le financier) + GET /accounts (bloc "Ma situation",
 * absent du résumé dashboard) — jamais de boucle N+1, jamais un recalcul mobile
 * de ce que le backend a déjà calculé.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incomeSourcesCount, setIncomeSourcesCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dismissChoiceOpen, setDismissChoiceOpen] = useState(false);
  const [freeAvailableInfoOpen, setFreeAvailableInfoOpen] = useState(false);
  const [loading, setLoading] = useState(true);

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
  const upcomingDeadlines = [...summary.deadlineItems].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 3);
  const topPlans = prioritizePlans(summary.financialPlansResume).slice(0, 3);

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

          {/* Bloc 1 — Ma situation */}
          {accounts.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>MA SITUATION</Text>
              {accounts.slice(0, 4).map((a) => (
                <TouchableOpacity key={a.id} style={styles.accountRow} onPress={() => navigation.getParent()?.navigate('AccountDetail', { id: a.id })}>
                  <View style={{ flexShrink: 1 }}>
                    <Text style={styles.accountName}>{a.name}</Text>
                    {/* R6.1 §10 — badge discret : compte visible, seulement exclu des calculs. */}
                    {!a.includeInOperationalTreasury && <Text style={styles.offPilotBadge}>Hors pilotage</Text>}
                  </View>
                  <Text style={styles.accountAmount}>{a.soldeCourant.toLocaleString('fr-FR')} DH</Text>
                </TouchableOpacity>
              ))}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Patrimoine total</Text>
                <Text style={styles.totalValue}>{summary.patrimoine_liquide_total.toLocaleString('fr-FR')} DH</Text>
              </View>
              <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Accounts')}>
                <Text style={styles.linkText}>Voir mes comptes →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bloc 2 — Mon disponible réel. §14 (recette téléphone réel) : le
              disponible libre est l'élément PRINCIPAL (en tête, gros chiffre) —
              Trésorerie/Réservé/Engagé/Coussin ne sont que des informations
              secondaires compactes en dessous, jamais au même poids visuel. */}
          <View style={styles.block}>
            <View style={styles.freeAvailableHero}>
              <View style={styles.freeAvailableHeroRow}>
                <Text style={styles.freeAvailableLabel}>DISPONIBLE LIBRE</Text>
                <TouchableOpacity testID="free-available-info" onPress={() => setFreeAvailableInfoOpen((v) => !v)}>
                  <Text style={styles.infoIcon}>ⓘ</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.freeAvailableValue, summary.free_available < 0 && styles.negative]}>
                {summary.free_available.toLocaleString('fr-FR')} DH
              </Text>
              {freeAvailableInfoOpen && (
                <Text style={styles.infoText}>
                  Votre disponible libre tient compte de l'argent réservé et de votre coussin de sécurité.
                </Text>
              )}
              {!summary.is_complete && (
                <Text style={styles.warning}>⚠ Calcul incomplet — {summary.unknown_commitments_count} montant(s) encore inconnu(s).</Text>
              )}
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Trésorerie</Text>
              <Text style={styles.breakdownValue}>{summary.operational_treasury.toLocaleString('fr-FR')} DH</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Engagé</Text>
              <Text style={styles.breakdownValue}>{summary.committed_amount.toLocaleString('fr-FR')} DH</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Réservé</Text>
              <Text style={styles.breakdownValue}>{summary.reserved_amount.toLocaleString('fr-FR')} DH</Text>
            </View>
            <View style={styles.breakdownRow}>
              <Text style={styles.breakdownLabel}>Coussin</Text>
              <Text style={styles.breakdownValue}>{summary.safety_buffer.toLocaleString('fr-FR')} DH</Text>
            </View>
          </View>

          {/* Bloc 3 — Prochaines échéances */}
          {upcomingDeadlines.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>PROCHAINEMENT</Text>
              {upcomingDeadlines.map((d) => (
                <TouchableOpacity key={d.id} style={styles.deadlineRow} onPress={() => navigation.getParent()?.navigate('DeadlineDetail', { id: d.id })}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.deadlineDate, { color: urgencyColor(d.dueDate, summary.seuil_a_payer_days) }]}>{formatShortDate(d.dueDate)}</Text>
                    <Text style={styles.deadlineLabel}>{d.chargePlanLabel}</Text>
                    {d.coverageStatus === 'couverte' && <Text style={styles.coveredBadge}>✓ Couvert</Text>}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.deadlineAmount}>
                      {d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH` : 'À confirmer'}
                    </Text>
                    <TouchableOpacity style={styles.payPill} onPress={() => navigation.getParent()?.navigate('DeadlineDetail', { id: d.id })}>
                      <Text style={styles.payPillText}>Payer</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Charges')}>
                <Text style={styles.linkText}>Voir toutes →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bloc 4 — Mes plans */}
          {topPlans.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>MES PLANS</Text>
              {topPlans.map((p) => (
                <TouchableOpacity
                  key={p.id}
                  testID={`home-plan-${p.id}`}
                  style={styles.planCard}
                  onPress={() => navigation.getParent()?.navigate('FinancialPlanDetail', { id: p.id })}
                >
                  <Text style={styles.planLabel}>{p.label}</Text>
                  <Text style={styles.planAmounts}>
                    {p.provisionCoverage.toLocaleString('fr-FR')} / {p.knownPlanCost.toLocaleString('fr-FR')} DH
                  </Text>
                  {p.tauxCouverture !== null && (
                    <>
                      <Text style={styles.planPercent}>{Math.round(p.tauxCouverture)}% couvert</Text>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.min(100, p.tauxCouverture)}%` }]} />
                      </View>
                    </>
                  )}
                  {p.remainingDue > 0 && <Text style={styles.planRemaining}>Reste à financer : {p.remainingDue.toLocaleString('fr-FR')} DH</Text>}
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={() => navigation.getParent()?.navigate('FinancialPlans')}>
                <Text style={styles.linkText}>Voir tous →</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Bloc 5 — Projection */}
          <TouchableOpacity style={styles.block} onPress={() => navigation.getParent()?.navigate('Projection')}>
            <Text style={styles.blockTitle}>DANS 30 JOURS</Text>
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
              <Text style={styles.warning}>
                Risque de déficit le {formatLongDate(summary.next_30_days.first_negative_date)}
                {summary.next_30_days.deficit_at_first_negative !== null
                  ? ` (${summary.next_30_days.deficit_at_first_negative.toLocaleString('fr-FR')} DH)`
                  : ''}
              </Text>
            )}
          </TouchableOpacity>

          {/* Bloc 6 — Actions à traiter (jamais affiché si vide, §16) */}
          {summary.actionsATraiter.length > 0 && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>
                {summary.actionsATraiter.length} action{summary.actionsATraiter.length > 1 ? 's' : ''} à traiter
              </Text>
              {summary.actionsATraiter.slice(0, 5).map((a, i) => {
                const target = actionTarget(a);
                return (
                  <TouchableOpacity
                    key={i}
                    style={styles.actionRow}
                    disabled={!target}
                    onPress={() => target && navigation.getParent()?.navigate(target.route, target.params)}
                  >
                    <Text style={styles.actionText}>• {a.message}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
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

  block: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  blockTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 10 },

  accountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  accountName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  offPilotBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  accountAmount: { fontSize: 13, color: colors.textPrimary, fontWeight: '700' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 },
  totalLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '700' },
  totalValue: { fontSize: 16, color: colors.textPrimary, fontWeight: '800' },
  linkText: { color: colors.success, fontSize: 12, fontWeight: '700', marginTop: 10 },

  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  breakdownLabel: { fontSize: 12, color: colors.textSecondary },
  breakdownValue: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  breakdownDivider: { height: 1, backgroundColor: colors.divider, marginBottom: spacing.sm },
  freeAvailableHero: { marginBottom: spacing.xs },
  freeAvailableHeroRow: { flexDirection: 'row', alignItems: 'center' },
  freeAvailableLabel: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  infoIcon: { fontSize: 13, color: colors.textSecondary, marginLeft: 6 },
  freeAvailableValue: { fontSize: 30, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.xs },
  negative: { color: colors.danger },
  infoText: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.sm, fontStyle: 'italic' },
  warning: { fontSize: 12, color: colors.warning, marginTop: spacing.sm, fontWeight: '600' },

  deadlineRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  deadlineDate: { fontSize: 11, fontWeight: '700' },
  deadlineLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: 2 },
  coveredBadge: { fontSize: 10, color: colors.success, fontWeight: '700', marginTop: 2 },
  deadlineAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  payPill: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: spacing.xs, marginTop: 6 },
  payPillText: { color: colors.textOnPrimary, fontSize: 10, fontWeight: '700' },

  planCard: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  planLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  planAmounts: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  planPercent: { fontSize: 11, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xs },
  progressTrack: { height: 6, backgroundColor: colors.surfaceSecondary, borderRadius: 3, overflow: 'hidden', marginTop: spacing.xs },
  progressFill: { height: '100%', backgroundColor: colors.success },
  planRemaining: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.xs },

  projectionStatus: { fontSize: 12, fontWeight: '800', marginTop: spacing.sm },

  actionRow: { paddingVertical: 6 },
  actionText: { fontSize: 12, color: colors.textPrimary },
});
