import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { SegmentBar, segmentColor } from '../ui/SegmentBar';
import { isSanteSubaccount } from '../ui/santeDetection';
import { PlannedOperationActionsModal } from '../ui/PlannedOperationActionsModal';

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
 * Accueil Finance Maison — conforme à la maquette validée (audit Checkpoint 2) :
 * pas de métrique globale inventée, comptes avec barre de répartition,
 * sous-comptes imbriqués (le sous-compte Santé ouvre directement Health), puis
 * "Prochaines transactions" (les planned_operations PENDING, mêmes données que
 * Planning) et enfin "Autres actions" (remboursements mutuelle + échéances de
 * plan financier) — jamais de logique parallèle à celle de Planning.
 */
export function AccueilScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [plannedOps, setPlannedOps] = useState<api.PlannedOperationApi[]>([]);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [plans, setPlans] = useState<api.FinancialPlanApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [transactionTarget, setTransactionTarget] = useState<api.PlannedOperationApi | null>(null);

  const load = useCallback(async (force = false) => {
    const [accountsData, planned, claimsData, plansData] = await Promise.all([
      cached('accounts', () => api.listAccounts(), 60_000, force),
      cached('planned-operations', () => api.listPlannedOperations(), 60_000, force),
      cached('medical-claims:all', () => api.listMedicalClaims(), 60_000, force),
      cached('financial-plans', () => api.listFinancialPlans(), 60_000, force),
    ]);
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
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Accueil</Text>
          <Text style={styles.subtitle}>Vos comptes et ce qui demande votre attention.</Text>
        </View>
        <HelpButton
          title="Accueil"
          text="Retrouvez vos comptes, leurs sous-comptes (enveloppes réservées) et vos prochaines transactions. Touchez une transaction à venir pour la modifier, l'annuler ou simplement la consulter."
        />
      </View>

      <Text style={styles.sectionLabel}>MES COMPTES</Text>

      {(accounts ?? []).map((account, accountIdx) => {
        const hasSubaccounts = account.subaccounts.length > 0;
        const accentColor = segmentColor(accountIdx);
        const segments = hasSubaccounts
          ? [
              ...account.subaccounts.map((s, idx) => ({ key: s.id, value: s.balance, color: segmentColor(idx) })),
              { key: 'non-affecte', value: account.nonAffecte, color: colors.borderStrong },
            ]
          : [];

        return (
          <View key={account.id} style={[styles.accountCard, { borderLeftColor: accentColor }]}>
            <TouchableOpacity onPress={() => navigation.navigate('AccountDetail', { id: account.id })} testID={`accueil-account-${account.id}`}>
              <View style={styles.accountHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.accountName}>{account.name}</Text>
                  {account.bank ? <Text style={styles.accountBank}>{account.bank}</Text> : null}
                </View>
                <Text style={styles.accountBalance}>{formatDh(account.balance)}</Text>
              </View>
              {hasSubaccounts && (
                <View style={{ marginTop: spacing.sm }}>
                  <SegmentBar items={segments} total={account.balance} />
                </View>
              )}
            </TouchableOpacity>

            {hasSubaccounts && (
              <View style={styles.subaccountsList}>
                {account.subaccounts.map((sub, idx) => {
                  const sante = isSanteSubaccount(sub.name);
                  return (
                    <TouchableOpacity
                      key={sub.id}
                      style={styles.subaccountRow}
                      onPress={() => navigation.navigate(sante ? 'Health' : 'SubaccountDetail', { id: sub.id })}
                      testID={`accueil-subaccount-${sub.id}`}
                    >
                      <View style={styles.subaccountNameRow}>
                        <View style={[styles.colorDot, { backgroundColor: segmentColor(idx) }]} testID={`accueil-subaccount-dot-${sub.id}`} />
                        <Text style={styles.subaccountName}>{sub.name}</Text>
                      </View>
                      <Text style={styles.subaccountBalance}>{formatDh(sub.balance)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={styles.subaccountRow}>
                  <View style={styles.subaccountNameRow}>
                    <View style={[styles.colorDot, { backgroundColor: colors.borderStrong }]} />
                    <Text style={styles.nonAffecteLabel}>Non affecté</Text>
                  </View>
                  <Text style={styles.nonAffecteValue}>{formatDh(account.nonAffecte)}</Text>
                </View>
              </View>
            )}
          </View>
        );
      })}

      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>PROCHAINES TRANSACTIONS</Text>
      {upcomingTransactions.length === 0 ? (
        <Text style={styles.emptyText}>Aucune transaction à venir.</Text>
      ) : (
        <>
          {upcomingTransactions.slice(0, UPCOMING_PREVIEW_COUNT).map((op) => {
            const today = new Date().toISOString().slice(0, 10);
            const overdue = op.expectedDate < today;
            return (
              <TouchableOpacity
                key={op.id}
                style={[styles.actionCard, { borderLeftColor: overdue ? colors.danger : colors.warning }]}
                onPress={() => setTransactionTarget(op)}
                testID={`accueil-upcoming-${op.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionLabel}>{op.label}</Text>
                  <Text style={styles.actionMeta}>Prévu le {formatShortDate(op.expectedDate)} · {formatDh(op.expectedAmount)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textPlaceholder} />
              </TouchableOpacity>
            );
          })}
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
        </>
      )}

      {otherActionItems.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>AUTRES ACTIONS</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 260 },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  emptyText: { ...typography.bodySecondary },
  welcomeContainer: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  welcomeTitle: { ...typography.screenTitle, textAlign: 'center', marginBottom: spacing.sm },
  welcomeSubtitle: { ...typography.bodySecondary, textAlign: 'center', marginBottom: spacing.xl, maxWidth: 280 },
  welcomePrimaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', width: '100%' },
  welcomePrimaryButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  welcomeSecondaryButton: { paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  welcomeSecondaryButtonText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  // Identité visuelle par compte (§2) : liseré coloré (palette rotative
  // segmentColor, la même que la barre de répartition) — jamais deux cartes
  // consécutives identiques, sans nuire à la lisibilité du solde.
  accountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderLeftWidth: 4 },
  accountHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  accountName: { ...typography.sectionTitle },
  accountBank: { ...typography.caption, marginTop: 2 },
  accountBalance: { ...typography.amountSecondary, fontSize: 20 },
  subaccountsList: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  subaccountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.xs },
  subaccountNameRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  // Légende couleurs (§8) : même taille/forme que les segments de la barre,
  // liseré blanc pour rester net sur n'importe quelle teinte de segment.
  colorDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm, borderWidth: 1, borderColor: colors.surface },
  subaccountName: { ...typography.body },
  subaccountBalance: { ...typography.body, fontWeight: '600' },
  nonAffecteLabel: { ...typography.bodySecondary },
  nonAffecteValue: { ...typography.bodySecondary, fontWeight: '600' },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  actionLabel: { ...typography.body, fontWeight: '700' },
  actionMeta: { ...typography.caption, marginTop: 2 },
  actionButton: { borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginLeft: spacing.sm },
  actionButtonText: { fontSize: 13, fontWeight: '700' },
  showAllButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  showAllButtonText: { ...typography.body, fontWeight: '700', color: colors.primary, marginRight: 4 },
});
