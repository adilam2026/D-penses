import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';

interface HistoryEntry {
  id: string;
  amount: number;
  spentDate: string;
  notes: string | null;
}

interface BudgetDetail {
  category: { name: string };
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  status: {
    periodStart: string;
    periodEnd: string;
    budgetPeriode: number;
    consommeADate: number;
    budgetContractuelRestant: number;
    rythmeProjete: number;
    previsionRythmeRestant: number;
    projectionPrudenteRestante: number;
  };
  history: HistoryEntry[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' });
}

/** Fiche budget (§18) — dépenses de la période courante, sans graphique. */
export function BudgetDetailScreen() {
  const route = useRoute<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<BudgetDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.getVariableBudget(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const { status } = detail;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{detail.category.name}</Text>
      <Text style={styles.subtitle}>
        {detail.referenceAmount.toLocaleString('fr-FR')} DH / {detail.referencePeriod} · {formatDate(status.periodStart)} — {formatDate(status.periodEnd)}
      </Text>

      <View style={styles.figuresGrid}>
        <Figure label="Budget" value={status.budgetPeriode} />
        <Figure label="Dépensé" value={status.consommeADate} />
        <Figure label="Reste selon budget" value={status.budgetContractuelRestant} />
        <Figure label="Projection au rythme actuel" value={status.rythmeProjete} />
        <Figure label="Prévision prudente restante" value={status.projectionPrudenteRestante} highlight />
      </View>

      <Text style={styles.historyTitle}>Dépenses de la période</Text>
      <FlatList
        data={detail.history}
        keyExtractor={(h) => h.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>Aucune dépense enregistrée dans cette période.</Text>}
        renderItem={({ item }) => (
          <View style={styles.historyRow}>
            <Text style={styles.historyLabel}>{item.notes || formatDate(item.spentDate)}</Text>
            <Text style={styles.historyAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>
          </View>
        )}
      />
    </View>
  );
}

function Figure({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.xl },
  figure: { width: '50%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: colors.success },
  historyTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  historyLabel: { fontSize: 13, color: colors.textPrimary },
  historyAmount: { fontSize: 13, fontWeight: '700', color: colors.danger },
});
