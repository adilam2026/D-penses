import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';

/**
 * Organisation → Épargne & sous-comptes (§9) — écran de gestion DISTINCT de
 * l'onglet Épargne : sous-comptes organisés PAR compte bancaire support (avec
 * une ligne "Non affecté" par compte), actifs et désactivés confondus.
 */
export function SavingsSubaccountsScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setAccounts(await api.listAccounts(true));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topInset }]}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Épargne & sous-comptes</Text>
        <HelpButton
          title="Épargne & sous-comptes"
          text="Un sous-compte réserve une partie de l'argent d'un compte bancaire (voiture, voyage, santé…), sans jamais le déplacer physiquement. « Non affecté » est la part restante, libre de toute réservation, pour chaque compte."
        />
      </View>

      {accounts === null ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : accounts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun compte pour l'instant — créez d'abord un compte bancaire.</Text>
        </View>
      ) : (
        accounts.map((account) => (
          <View key={account.id} style={styles.group}>
            <Text style={styles.groupTitle}>{account.name}</Text>
            {account.subaccounts.length === 0 ? (
              <Text style={styles.groupEmpty}>Aucun sous-compte.</Text>
            ) : (
              account.subaccounts.map((sub) => (
                <TouchableOpacity
                  key={sub.id}
                  style={[styles.row, !sub.active && styles.rowInactive]}
                  onPress={() => navigation.navigate('SubaccountDetail', { id: sub.id })}
                  testID={`savings-subaccounts-${sub.id}`}
                >
                  <Text style={styles.rowLabel}>
                    {sub.name}
                    {!sub.active ? ' · Désactivé' : ''}
                  </Text>
                  <Text style={styles.rowAmount}>{formatDh(sub.balance)}</Text>
                </TouchableOpacity>
              ))
            )}
            <View style={styles.row}>
              <Text style={styles.nonAffecteLabel}>Non affecté</Text>
              <Text style={styles.nonAffecteAmount}>{formatDh(account.nonAffecte)}</Text>
            </View>
            <TouchableOpacity
              style={styles.addLink}
              onPress={() => navigation.navigate('CreateSubaccount', { accountId: account.id })}
              testID={`savings-subaccounts-add-${account.id}`}
            >
              <Text style={styles.addLinkText}>+ Nouveau sous-compte</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('CreateSubaccount', {})} testID="savings-subaccounts-add-global">
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addButtonText}>Nouveau sous-compte</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  title: { ...typography.screenTitle, flex: 1 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  emptyText: { ...typography.bodySecondary, textAlign: 'center' },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  groupTitle: { ...typography.sectionTitle, marginBottom: spacing.sm },
  groupEmpty: { ...typography.caption, marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowInactive: { opacity: 0.6 },
  rowLabel: { ...typography.body },
  rowAmount: { ...typography.body, fontWeight: '600' },
  nonAffecteLabel: { ...typography.bodySecondary },
  nonAffecteAmount: { ...typography.bodySecondary, fontWeight: '600' },
  addLink: { marginTop: spacing.sm },
  addLinkText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  addButtonText: { ...typography.body, fontWeight: '700', color: colors.primary },
});
