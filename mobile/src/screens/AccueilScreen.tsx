import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { SegmentBar, segmentColor } from '../ui/SegmentBar';
import { isSanteSubaccount } from '../ui/santeDetection';

interface ActionItem {
  key: string;
  label: string;
  meta: string;
  actionLabel: string;
  color: string;
  backgroundColor: string;
  onPress: () => void;
}

/**
 * Accueil Finance Maison — conforme à la maquette validée (audit Checkpoint 2) :
 * pas de métrique globale inventée, comptes avec barre de répartition,
 * sous-comptes imbriqués (le sous-compte Santé ouvre directement Health), puis
 * "À faire" — construit à partir des données réelles déjà exposées
 * (planned_operations en attente + dossiers santé en attente), jamais d'une
 * logique parallèle à jeter au Checkpoint 3 (Planning réutilisera les mêmes
 * planned_operations).
 */
export function AccueilScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [plannedOps, setPlannedOps] = useState<api.PlannedOperationApi[]>([]);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const [accountsData, planned, claimsData] = await Promise.all([
      cached('accounts', () => api.listAccounts(), 60_000, force),
      cached('planned-operations', () => api.listPlannedOperations(), 60_000, force),
      cached('medical-claims:all', () => api.listMedicalClaims(), 60_000, force),
    ]);
    setAccounts(accountsData);
    setPlannedOps(planned);
    setClaims(claimsData);
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

  const realize = useCallback(
    async (op: api.PlannedOperationApi) => {
      await api.realizePlannedOperation(op.id, { actualAmount: String(op.expectedAmount) });
      await load(true);
    },
    [load],
  );

  const actionItems = useMemo<ActionItem[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const pendingOps = plannedOps
      .filter((op) => op.status === 'PENDING')
      .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
      .slice(0, 3)
      .map((op) => {
        const overdue = op.expectedDate < today;
        return {
          key: `planned-${op.id}`,
          label: op.label,
          meta: `Prévu le ${formatShortDate(op.expectedDate)} · ${formatDh(op.expectedAmount)}`,
          actionLabel: op.kind === 'SAVINGS_CONTRIBUTION' ? 'Verser' : 'Payer',
          color: overdue ? colors.danger : colors.warning,
          backgroundColor: overdue ? colors.dangerLight : colors.warningLight,
          onPress: () => realize(op),
        };
      });

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

    return [...pendingOps, ...pendingClaimItems];
  }, [plannedOps, claims, realize, navigation]);

  if (loading && !accounts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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
          text="Retrouvez vos comptes, leurs sous-comptes (enveloppes réservées) et la section « À faire » qui regroupe les échéances prévues et les remboursements en attente."
        />
      </View>

      <Text style={styles.sectionLabel}>MES COMPTES</Text>

      {(accounts ?? []).length === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun compte pour l'instant.</Text>
        </View>
      )}

      {(accounts ?? []).map((account) => {
        const hasSubaccounts = account.subaccounts.length > 0;
        const segments = hasSubaccounts
          ? [
              ...account.subaccounts.map((s, idx) => ({ key: s.id, value: s.balance, color: segmentColor(idx) })),
              { key: 'non-affecte', value: account.nonAffecte, color: colors.borderStrong },
            ]
          : [];

        return (
          <View key={account.id} style={styles.accountCard}>
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
                {account.subaccounts.map((sub) => {
                  const sante = isSanteSubaccount(sub.name);
                  return (
                    <TouchableOpacity
                      key={sub.id}
                      style={styles.subaccountRow}
                      onPress={() => navigation.navigate(sante ? 'Health' : 'SubaccountDetail', { id: sub.id })}
                      testID={`accueil-subaccount-${sub.id}`}
                    >
                      <Text style={styles.subaccountName}>{sub.name}</Text>
                      <Text style={styles.subaccountBalance}>{formatDh(sub.balance)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={styles.subaccountRow}>
                  <Text style={styles.nonAffecteLabel}>Non affecté</Text>
                  <Text style={styles.nonAffecteValue}>{formatDh(account.nonAffecte)}</Text>
                </View>
              </View>
            )}
          </View>
        );
      })}

      <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>À FAIRE</Text>
      {actionItems.length === 0 ? (
        <Text style={styles.emptyText}>Rien à faire pour l'instant.</Text>
      ) : (
        actionItems.map((item) => (
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
        ))
      )}
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
  accountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  accountHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  accountName: { ...typography.sectionTitle },
  accountBank: { ...typography.caption, marginTop: 2 },
  accountBalance: { ...typography.amountSecondary },
  subaccountsList: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  subaccountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
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
});
