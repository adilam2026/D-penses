import React, { useCallback, useEffect, useState } from 'react';
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
import { isSanteSubaccount } from '../ui/santeDetection';

/**
 * Détail sous-compte — même écran très simple que Détail compte (§9), avec
 * "Disponible" au lieu de "Solde" et un item de menu supplémentaire "Ajouter
 * de l'argent". Le sous-compte Santé n'utilise jamais cet écran (redirection
 * vers Health, cf. maquette : la ligne "Santé" ouvre directement l'écran dédié).
 */
export function SubaccountDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ SubaccountDetail: { id: string } }, 'SubaccountDetail'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [account, setAccount] = useState<api.AccountApi | null>(null);
  const [subaccount, setSubaccount] = useState<api.SubaccountApi | null>(null);
  const [operations, setOperations] = useState<api.FinancialOperationApi[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  const load = useCallback(async () => {
    const accounts = await api.listAccounts();
    const parent = accounts.find((a) => a.subaccounts.some((s) => s.id === id));
    const sub = parent?.subaccounts.find((s) => s.id === id) ?? null;
    setAccount(parent ?? null);
    setSubaccount(sub);
    if (sub) setOperations(await api.listFinancialOperations({ subaccountId: id }));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (subaccount && isSanteSubaccount(subaccount.name)) {
      navigation.replace('Health', { id });
    }
  }, [subaccount, id, navigation]);

  if (!account || !subaccount) {
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
              title={subaccount.name}
              text="Le disponible est la part de ce compte déjà réservée pour cette enveloppe. L'historique liste les opérations qui l'ont affectée."
            />
            <TouchableOpacity testID="subaccount-detail-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.title}>{subaccount.name}</Text>
        <Text style={styles.subtitle}>Rattaché à {account.name}</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Disponible</Text>
          <Text style={styles.balanceAmount}>{formatDh(subaccount.balance)}</Text>
        </View>

        <Text style={styles.sectionLabel}>HISTORIQUE DES TRANSACTIONS</Text>
        {(operations ?? []).length === 0 ? (
          <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
        ) : (
          (operations ?? []).map((op) => {
            const amount = localAmount(op.ledgerEntries, { subaccountId: id });
            return (
              <View key={op.id} style={styles.opRow}>
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
        title={subaccount.name}
        onClose={() => setMenuOpen(false)}
        testID="subaccount-detail-choice-sheet"
        options={[
          { key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setRenameOpen(true) },
          {
            key: 'add-transaction',
            label: 'Ajouter une transaction',
            icon: 'add-circle-outline',
            onPress: () =>
              navigation.navigate('Tabs', {
                screen: 'Ajouter',
                params: { prefill: { sourceAccountId: account.id, sourceSubaccountId: subaccount.id } },
              }),
          },
          {
            key: 'add-money',
            label: "Ajouter de l'argent",
            icon: 'wallet-outline',
            onPress: () =>
              navigation.navigate('Tabs', {
                screen: 'Ajouter',
                params: { prefill: { kind: 'SAVINGS_CONTRIBUTION', destinationAccountId: account.id, destinationSubaccountId: subaccount.id } },
              }),
          },
        ]}
      />

      <RenameModal
        visible={renameOpen}
        title="Modifier le nom du sous-compte"
        initialValue={subaccount.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={async (name) => {
          await api.renameSubaccount(subaccount.id, name);
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
