import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing } from '../ui/theme';

interface DeadlineItem {
  id: string;
  chargePlanId: string;
  chargePlanLabel: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  coverageStatus: 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet';
  engagementNonCouvert: number | null;
}

interface VariableBudgetItem {
  variableBudgetId: string;
  amount: number;
  categoryName: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * R6.3 (point B) — Détail de "Engagé" (Accueil, bloc Disponible libre). Les composantes
 * viennent EXACTEMENT du même calcul que le montant Home (computeDisponibleLibre,
 * treasury.util.ts) : deadlineItems.engagementNonCouvert + variableBudgetItems.amount,
 * jamais un second calcul côté mobile — Σ composantes = committedAmount par construction.
 * G — tri : futur/à venir = date ASC (échéances triées par dueDate croissante).
 */
export function EngagedDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bottomInset = useBottomInset();
  const {
    committedAmount,
    deadlineItems,
    variableBudgetItems,
    horizonDate,
    horizonIsFallback,
  }: {
    committedAmount: number;
    deadlineItems: DeadlineItem[];
    variableBudgetItems: VariableBudgetItem[];
    horizonDate: string;
    horizonIsFallback: boolean;
  } = route.params;

  const knownDeadlines = [...deadlineItems]
    .filter((d) => d.engagementNonCouvert !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const unknownDeadlines = deadlineItems.filter((d) => d.engagementNonCouvert === null);
  const deadlinesTotal = knownDeadlines.reduce((sum, d) => sum + (d.engagementNonCouvert ?? 0), 0);
  const budgetsTotal = variableBudgetItems.reduce((sum, b) => sum + b.amount, 0);

  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <Text style={styles.total} testID="engaged-detail-total">
        {committedAmount.toLocaleString('fr-FR')} DH engagés
      </Text>
      <Text style={styles.horizon}>
        Calculé jusqu'au {formatDate(horizonDate)}
        {horizonIsFallback ? ' (aucun revenu prévu connu, horizon par défaut)' : ' (prochain revenu prévu)'}.
      </Text>

      {knownDeadlines.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Échéances ({deadlinesTotal.toLocaleString('fr-FR')} DH)</Text>
          {knownDeadlines.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={styles.row}
              testID={`engaged-deadline-${d.id}`}
              onPress={() => navigation.navigate('DeadlineDetail', { deadlineId: d.id })}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{d.chargePlanLabel}</Text>
                <Text style={styles.rowMeta}>{formatDate(d.dueDate)}</Text>
              </View>
              <Text style={styles.rowValue}>{(d.engagementNonCouvert ?? 0).toLocaleString('fr-FR')} DH</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {variableBudgetItems.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Budgets variables ({budgetsTotal.toLocaleString('fr-FR')} DH)</Text>
          {variableBudgetItems.map((b) => (
            <View key={b.variableBudgetId} style={styles.row} testID={`engaged-budget-${b.variableBudgetId}`}>
              <Text style={styles.rowLabel}>{b.categoryName}</Text>
              <Text style={styles.rowValue}>{b.amount.toLocaleString('fr-FR')} DH</Text>
            </View>
          ))}
        </View>
      )}

      {unknownDeadlines.length > 0 && (
        <Text style={styles.warning}>
          ⚠ {unknownDeadlines.length} échéance(s) à montant encore inconnu — jamais comptée(s) 0, ni ici ni dans le total.
        </Text>
      )}

      {knownDeadlines.length === 0 && variableBudgetItems.length === 0 && (
        <Text style={styles.empty}>Rien d'engagé pour l'instant.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.xl, backgroundColor: colors.background, flexGrow: 1 },
  total: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, textAlign: 'center', marginBottom: 4 },
  horizon: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rowValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  warning: { fontSize: 12, color: '#B45309', marginTop: spacing.sm },
  empty: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
});
