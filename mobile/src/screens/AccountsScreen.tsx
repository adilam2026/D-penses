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

const TYPE_LABELS: Record<string, string> = { COURANT: 'Courant', EPARGNE: 'Épargne', ESPECES: 'Espèces', AUTRE: 'Autre' };

/**
 * Organisation → Comptes (§7) — écran de gestion réel listant TOUS les
 * comptes réels (actifs ET désactivés), jamais un filtrage silencieux.
 */
export function AccountsScreen() {
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
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.title}>Comptes</Text>
          <HelpButton
            title="Comptes"
            text="Retrouvez ici tous vos comptes bancaires, y compris ceux désactivés. Un compte désactivé n'est plus proposé pour de nouvelles opérations, mais son historique reste intact et il peut être réactivé à tout moment."
          />
        </View>
      </View>

      {accounts === null ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : accounts.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun compte pour l'instant.</Text>
        </View>
      ) : (
        accounts.map((account) => (
          <TouchableOpacity
            key={account.id}
            style={[styles.card, !account.active && styles.cardInactive]}
            onPress={() => navigation.navigate('AccountDetail', { id: account.id })}
            testID={`accounts-list-${account.id}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{account.name}</Text>
              <Text style={styles.cardMeta}>
                {[account.bank, TYPE_LABELS[account.type] ?? account.type, account.ownerLabel].filter(Boolean).join(' · ')}
              </Text>
              {!account.active ? <Text style={styles.inactiveBadge}>Désactivé</Text> : null}
            </View>
            <Text style={styles.cardBalance}>{formatDh(account.balance)}</Text>
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('CreateAccount')} testID="accounts-add">
        <Ionicons name="add" size={18} color={colors.primary} />
        <Text style={styles.addButtonText}>Nouveau compte</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.screenTitle, flex: 1 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  emptyText: { ...typography.bodySecondary },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardInactive: { opacity: 0.6 },
  cardName: { ...typography.body, fontWeight: '700' },
  cardMeta: { ...typography.caption, marginTop: 2 },
  inactiveBadge: { ...typography.caption, color: colors.danger, fontWeight: '700', marginTop: spacing.xs },
  cardBalance: { ...typography.amountSecondary },
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
