import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { isSanteSubaccount } from '../ui/santeDetection';
import { PlannedOperationActionsModal } from '../ui/PlannedOperationActionsModal';
import { AccountCard } from '../ui/AccountCard';
import { accountLabelFor } from '../ui/accountLabel';
import { PLANNED_OPERATION_KIND_VISUALS } from '../ui/plannedOperationVisuals';
import { useTopInset } from '../ui/useTopInset';

interface ActionItem {
  key: string;
  label: string;
  meta: string;
  actionLabel: string;
  color: string;
  backgroundColor: string;
  onPress: () => void;
}

const UPCOMING_PREVIEW_COUNT = 5;

/**
 * Accueil Finance Maison — reconstruit à partir de la maquette validée
 * « Foyer » (01-Accueil) : salutation + carte héro « Patrimoine du foyer »,
 * puis la liste des comptes. Les sous-comptes restent affichés et tactiles
 * directement ici (dont le routage direct du sous-compte Santé vers Health) —
 * comportement fonctionnel validé antérieurement, la maquette ne montre
 * qu'un seul jeu de données d'exemple et ne le contredit pas.
 */
export function AccueilScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const [household, setHousehold] = useState<{ name: string } | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [plannedOps, setPlannedOps] = useState<api.PlannedOperationApi[]>([]);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [plans, setPlans] = useState<api.FinancialPlanApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactionTarget, setTransactionTarget] = useState<api.PlannedOperationApi | null>(null);

  const load = useCallback(async (force = false) => {
    const [householdData, accountsData, planned, claimsData, plansData] = await Promise.all([
      cached('household', () => api.getMyHousehold(), 60_000, force),
      cached('accounts', () => api.listAccounts(), 60_000, force),
      cached('planned-operations', () => api.listPlannedOperations(), 60_000, force),
      cached('medical-claims:all', () => api.listMedicalClaims(), 60_000, force),
      cached('financial-plans', () => api.listFinancialPlans(), 60_000, force),
    ]);
    setHousehold(householdData);
    setAccounts(accountsData);
    setPlannedOps(planned);
    setClaims(claimsData);
    setPlans(plansData);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const upcomingTransactions = useMemo(
    () => plannedOps.filter((op) => op.status === 'PENDING').sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)),
    [plannedOps],
  );

  const otherActionItems = useMemo<ActionItem[]>(() => {
    const pendingClaimItems = claims
      .filter((c) => c.status === 'PENDING' && c.subaccountId)
      .slice(0, 2)
      .map((claim) => ({
        key: `claim-${claim.id}`,
        label: claim.label,
        meta: `Reste ${formatDh(claim.reste)} à recevoir de la mutuelle`,
        actionLabel: 'Voir',
        color: colors.success,
        backgroundColor: colors.successLight,
        onPress: () => navigation.navigate('Health', { id: claim.subaccountId }),
      }));

    const planDeadlineItems = plans
      .filter((p) => p.nextDeadline && p.nextDeadline.reste > 0)
      .slice(0, 2)
      .map((plan) => ({
        key: `plan-${plan.id}`,
        label: `${plan.label} — ${plan.nextDeadline!.label}`,
        meta: `À préparer : ${formatDh(plan.nextDeadline!.reste)} d'ici le ${formatShortDate(plan.nextDeadline!.dueDate)}`,
        actionLabel: 'Voir',
        color: colors.warning,
        backgroundColor: colors.warningLight,
        onPress: () => navigation.navigate('FinancialPlanDetail', { id: plan.id }),
      }));

    return [...pendingClaimItems, ...planDeadlineItems];
  }, [claims, plans, navigation]);

  const patrimoine = useMemo(() => {
    const list = accounts ?? [];
    const total = list.reduce((sum, a) => sum + a.balance, 0);
    const enveloppes = list.reduce((sum, a) => sum + a.subaccounts.length, 0);
    return { total, comptes: list.length, enveloppes };
  }, [accounts]);

  if (loading && !accounts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // §2 (première utilisation) : un foyer sans AUCUN compte ne doit jamais
  // afficher un dashboard vide ni des données inventées — un seul écran de
  // bienvenue avec une action claire, jamais la structure Accueil habituelle.
  if (accounts && accounts.length === 0) {
    return (
      <View style={[styles.container, styles.welcomeContainer]}>
        <Text style={styles.welcomeTitle}>Bienvenue dans Finance Maison</Text>
        <Text style={styles.welcomeSubtitle}>
          Commencez par ajouter les comptes bancaires que vous souhaitez superviser.
        </Text>
        <TouchableOpacity
          style={styles.welcomePrimaryButton}
          onPress={() => navigation.navigate('CreateAccount')}
          testID="accueil-welcome-add-account"
        >
          <Text style={styles.welcomePrimaryButtonText}>+ Ajouter mon premier compte</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.welcomeSecondaryButton}
          onPress={() => navigation.navigate('Guide')}
          testID="accueil-welcome-discover"
        >
          <Text style={styles.welcomeSecondaryButtonText}>Découvrir l'application</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topInset }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Bonjour,</Text>
          <Text style={styles.title}>{household?.name ?? 'Votre foyer'}</Text>
        </View>
        <HelpButton
          title="Accueil"
          text="Retrouvez vos comptes, leurs sous-comptes (enveloppes réservées) et vos prochaines transactions. Touchez une transaction à venir pour la modifier, l'annuler ou simplement la consulter."
        />
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>PATRIMOINE DU FOYER</Text>
        <Text style={styles.heroAmount}>{formatDh(patrimoine.total)}</Text>
        <View style={styles.heroMetaRow}>
          <Text style={styles.heroMetaText}>{patrimoine.comptes} compte{patrimoine.comptes > 1 ? 's' : ''}</Text>
          <Text style={styles.heroMetaText}>·</Text>
          <Text style={styles.heroMetaText}>{patrimoine.enveloppes} enveloppe{patrimoine.enveloppes > 1 ? 's' : ''} d'épargne</Text>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>MES COMPTES</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Accounts')} testID="accueil-accounts-show-all">
          <Text style={styles.sectionLink}>Tout voir</Text>
        </TouchableOpacity>
      </View>

      {(accounts ?? []).map((account, accountIdx) => (
        <AccountCard
          key={account.id}
          account={account}
          accountIdx={accountIdx}
          testIDPrefix="accueil"
          onPressAccount={() => navigation.navigate('AccountDetail', { id: account.id })}
          onPressSubaccount={(sub) => navigation.navigate(isSanteSubaccount(sub.name) ? 'Health' : 'SubaccountDetail', { id: sub.id })}
        />
      ))}

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionLabel}>PROCHAINES TRANSACTIONS</Text>
        {upcomingTransactions.length > 0 && (
          <TouchableOpacity onPress={() => navigation.navigate('UpcomingTransactions')} testID="accueil-upcoming-show-all-link">
            <Text style={styles.sectionLink}>Tout voir</Text>
          </TouchableOpacity>
        )}
      </View>
      {upcomingTransactions.length === 0 ? (
        <Text style={styles.emptyText}>Aucune transaction à venir.</Text>
      ) : (
        <View style={styles.upcomingListCard}>
          {upcomingTransactions.slice(0, UPCOMING_PREVIEW_COUNT).map((op, idx) => {
            const today = new Date().toISOString().slice(0, 10);
            const overdue = op.expectedDate < today;
            const kind = PLANNED_OPERATION_KIND_VISUALS[op.kind];
            const account = accountLabelFor(accounts ?? [], op.sourceAccountId ?? op.destinationAccountId, op.sourceSubaccountId ?? op.destinationSubaccountId);
            const isLast = idx === Math.min(upcomingTransactions.length, UPCOMING_PREVIEW_COUNT) - 1;
            return (
              <TouchableOpacity
                key={op.id}
                style={[styles.upcomingRow, !isLast && styles.upcomingRowBorder]}
                onPress={() => setTransactionTarget(op)}
                testID={`accueil-upcoming-${op.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingLabel} numberOfLines={1}>{op.label}</Text>
                  <Text style={styles.upcomingMeta} numberOfLines={1}>
                    {formatShortDate(op.expectedDate)}
                    {account ? ` · ${account}` : ''}
                    {overdue ? ' · En retard' : ''}
                  </Text>
                </View>
                <Text style={[styles.upcomingAmount, { color: kind.color }]}>{formatDh(op.expectedAmount)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      {upcomingTransactions.length > UPCOMING_PREVIEW_COUNT && (
        <TouchableOpacity
          style={styles.showAllButton}
          onPress={() => navigation.navigate('UpcomingTransactions')}
          testID="accueil-upcoming-show-all"
        >
          <Text style={styles.showAllButtonText}>Afficher tout ({upcomingTransactions.length})</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}

      {otherActionItems.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>AUTRES ACTIONS</Text>
          </View>
          {otherActionItems.map((item) => (
            <View key={item.key} style={[styles.actionCard, { borderLeftColor: item.color }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actionLabel}>{item.label}</Text>
                <Text style={styles.actionMeta}>{item.meta}</Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { backgroundColor: item.backgroundColor }]}
                onPress={item.onPress}
                testID={`accueil-action-${item.key}`}
              >
                <Text style={[styles.actionButtonText, { color: item.color }]}>{item.actionLabel}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </>
      )}

      <PlannedOperationActionsModal
        target={transactionTarget}
        accounts={accounts ?? []}
        onClose={() => setTransactionTarget(null)}
        onChanged={() => load(true)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  greeting: { fontSize: 12, fontFamily: fontFamily.sansSemiBold, color: colors.textSecondary },
  title: { ...typography.screenTitle },
  welcomeContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  welcomeTitle: { ...typography.screenTitle, textAlign: 'center', marginBottom: spacing.sm },
  welcomeSubtitle: { ...typography.bodySecondary, textAlign: 'center', marginBottom: spacing.xl, maxWidth: 280 },
  welcomePrimaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', width: '100%' },
  welcomePrimaryButtonText: { color: colors.textOnPrimary, fontFamily: fontFamily.sansBold, fontSize: 14 },
  welcomeSecondaryButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  welcomeSecondaryButtonText: { ...typography.body, fontFamily: fontFamily.sansBold, color: colors.textSecondary },

  // Carte héro « Patrimoine du foyer » (maquette 01-Accueil) — seule métrique
  // globale affichée, jamais un chiffre inventé : somme réelle des soldes.
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    ...elevation.floating,
  },
  heroLabel: { fontSize: 12, fontFamily: fontFamily.sansBold, color: 'rgba(255,255,255,0.85)', letterSpacing: 0.5 },
  heroAmount: { fontSize: 32, fontFamily: fontFamily.displayBold, color: colors.textOnPrimary, marginTop: 4 },
  heroMetaRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  heroMetaText: { fontSize: 12, fontFamily: fontFamily.sansMedium, color: 'rgba(255,255,255,0.9)' },

  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, letterSpacing: 0.5 },
  sectionLink: { fontSize: 12, fontFamily: fontFamily.sansBold, color: colors.primary },
  emptyText: { ...typography.bodySecondary },

  upcomingListCard: { backgroundColor: colors.surface, borderRadius: radius.lg, paddingHorizontal: spacing.md, ...elevation.card },
  upcomingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md },
  upcomingRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  upcomingLabel: { fontSize: 13, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  upcomingMeta: { ...typography.caption, marginTop: 2 },
  upcomingAmount: { fontSize: 13, fontFamily: fontFamily.sansExtraBold, marginLeft: spacing.sm },

  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  actionLabel: { ...typography.body, fontFamily: fontFamily.sansBold },
  actionMeta: { ...typography.caption, marginTop: 2 },
  actionButton: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.sm },
  actionButtonText: { fontSize: 13, fontFamily: fontFamily.sansBold },
  showAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  showAllButtonText: { ...typography.body, fontFamily: fontFamily.sansBold, color: colors.primary, marginRight: 4 },
});
