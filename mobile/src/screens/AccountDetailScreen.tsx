import React, { useCallback, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { OPERATION_KIND_LABELS, localAmount } from '../ui/operationKindLabel';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { RenameModal } from '../ui/RenameModal';
import { HelpButton } from '../ui/HelpButton';
import { testIdSlug } from '../ui/testIdSlug';

/**
 * Détail compte — écran TRÈS SIMPLE (validation Checkpoint 2 §8) : nom, solde,
 * historique des transactions, rien d'autre. Menu ⋯ : Modifier / Ajouter une
 * transaction / Désactiver (non disponible — pas de champ "actif" côté schéma).
 */
export function AccountDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ AccountDetail: { id: string } }, 'AccountDetail'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [account, setAccount] = useState<api.AccountApi | null>(null);
  const [operations, setOperations] = useState<api.FinancialOperationApi[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const load = useCallback(async () => {
    const [acc, ops] = await Promise.all([api.getAccount(id), api.listFinancialOperations({ accountId: id })]);
    setAccount(acc);
    setOperations(ops);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!account) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>Accueil</Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <HelpButton
              title={account.name}
              text="Le solde correspond au montant réellement présent sur ce compte. L'historique liste toutes les opérations qui l'ont affecté, y compris celles financées depuis un sous-compte."
            />
            <TouchableOpacity testID="account-detail-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.title}>{account.name}</Text>
        <Text style={styles.subtitle}>Compte bancaire{account.active ? '' : ' · Désactivé'}</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Solde</Text>
          <Text style={styles.balanceAmount}>{formatDh(account.balance)}</Text>
        </View>

        <Text style={styles.sectionLabel}>HISTORIQUE DES TRANSACTIONS</Text>
        {(operations ?? []).length === 0 ? (
          <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
        ) : (
          (operations ?? []).map((op) => {
            const amount = localAmount(op.ledgerEntries, { accountId: id });
            return (
              <View key={op.id} style={styles.opRow} testID={`transaction-row-${testIdSlug(op.label)}`}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.opLabel}>{op.label}</Text>
                  <Text style={styles.opMeta}>
                    {formatShortDate(op.date)} · {OPERATION_KIND_LABELS[op.kind]}
                  </Text>
                </View>
                <Text style={[styles.opAmount, amount > 0 ? styles.opAmountPlus : amount < 0 ? styles.opAmountMinus : null]}>
                  {amount > 0 ? '+' : ''}
                  {formatDh(amount)}
                </Text>
              </View>
            );
          })
        )}
      </ScrollView>

      <ChoiceSheet
        visible={menuOpen}
        title={account.name}
        onClose={() => setMenuOpen(false)}
        testID="account-detail-choice-sheet"
        options={[
          { key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setRenameOpen(true) },
          {
            key: 'add-transaction',
            label: 'Ajouter une transaction',
            icon: 'add-circle-outline',
            disabled: !account.active,
            onPress: () => navigation.navigate('Tabs', { screen: 'Ajouter', params: { prefill: { sourceAccountId: account.id } } }),
          },
          account.active
            ? {
                key: 'deactivate',
                label: 'Désactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateAccount(account.id, { active: false });
                  await load();
                },
              }
            : {
                key: 'reactivate',
                label: 'Réactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateAccount(account.id, { active: true });
                  await load();
                },
              },
        ]}
      />

      <RenameModal
        visible={renameOpen}
        title="Modifier le nom du compte"
        initialValue={account.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={async (name) => {
          await api.renameAccount(account.id, name);
          await load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg },
  subtitle: { ...typography.bodySecondary, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
  },
  balanceLabel: { ...typography.bodySecondary, marginBottom: spacing.xs },
  balanceAmount: { ...typography.amountPrimary },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, paddingHorizontal: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.5 },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg },
  opRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  opLabel: { ...typography.body, fontWeight: '600' },
  opMeta: { ...typography.caption, marginTop: 2 },
  opAmount: { ...typography.body, fontWeight: '700' },
  opAmountPlus: { color: colors.success },
  opAmountMinus: { color: colors.danger },
});
