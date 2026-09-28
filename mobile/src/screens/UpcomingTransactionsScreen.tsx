import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatShortDate } from '../ui/formatMoney';
import { PlannedOperationActionsModal } from '../ui/PlannedOperationActionsModal';
import { PLANNED_OPERATION_KIND_VISUALS } from '../ui/plannedOperationVisuals';
import { accountLabelFor } from '../ui/accountLabel';

function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * "Afficher tout" (Accueil § Prochaines transactions) — liste chronologique
 * complète des transactions à venir, groupée mois par mois : l'équivalent en
 * liste de ce que Planning montre en grille. Chaque ligne ouvre les 3 actions
 * explicites (Modifier/Annuler/Fermer) via le même composant que l'Accueil.
 */
export function UpcomingTransactionsScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [ops, setOps] = useState<api.PlannedOperationApi[] | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [target, setTarget] = useState<api.PlannedOperationApi | null>(null);

  const load = useCallback(async () => {
    const [planned, accs] = await Promise.all([api.listPlannedOperations(), api.listAccounts()]);
    setOps(planned.filter((op) => op.status === 'PENDING').sort((a, b) => a.expectedDate.localeCompare(b.expectedDate)));
    setAccounts(accs);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const groups = useMemo(() => {
    if (!ops) return [];
    const byMonth = new Map<string, api.PlannedOperationApi[]>();
    for (const op of ops) {
      const key = monthKeyOf(op.expectedDate);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(op);
    }
    return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [ops]);

  if (!ops) {
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
          <TouchableOpacity
            style={styles.backRow}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            testID="upcoming-transactions-back"
          >
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>Retour</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.title}>Prochaines transactions</Text>

        {groups.length === 0 ? (
          <Text style={styles.emptyText}>Aucune transaction à venir.</Text>
        ) : (
          groups.map(([month, items]) => (
            <View key={month} style={styles.monthBlock}>
              <Text style={styles.monthLabel}>{formatMonthLabel(month)}</Text>
              {items.map((op) => {
                const kind = PLANNED_OPERATION_KIND_VISUALS[op.kind];
                const account = accountLabelFor(accounts, op.sourceAccountId ?? op.destinationAccountId, op.sourceSubaccountId ?? op.destinationSubaccountId);
                return (
                  <TouchableOpacity key={op.id} style={styles.row} onPress={() => setTarget(op)} testID={`upcoming-transaction-${op.id}`}>
                    <View style={[styles.kindBadge, { backgroundColor: kind.background }]}>
                      <Ionicons name={kind.icon} size={18} color={kind.color} />
                    </View>
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={styles.rowLabel} numberOfLines={1}>{op.label}</Text>
                      <Text style={styles.rowMeta} numberOfLines={1}>
                        {formatShortDate(op.expectedDate)}
                        {account ? ` · ${account}` : ''}
                      </Text>
                    </View>
                    <Text style={[styles.rowAmount, { color: kind.color }]}>{formatDh(op.expectedAmount)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <PlannedOperationActionsModal target={target} accounts={accounts} onClose={() => setTarget(null)} onChanged={load} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  title: { ...typography.screenTitle, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  emptyText: { ...typography.bodySecondary, paddingHorizontal: spacing.lg },
  monthBlock: { marginBottom: spacing.lg },
  monthLabel: { ...typography.sectionLabel, color: colors.textSecondary, letterSpacing: 0.5, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  kindBadge: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...typography.body, fontWeight: '700' },
  rowMeta: { ...typography.caption, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '800', marginLeft: spacing.sm },
});
