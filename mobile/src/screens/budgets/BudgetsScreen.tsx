import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { Donut } from '../../ui/Donut';
import { Budget, HEALTH_COLOR, HEALTH_LABEL } from './budgetsLogic';

/** Écran Budgets Variables (Lot 3 §17) — montants toujours affichés, jamais seulement un pourcentage. */
export function BudgetsScreen() {
  const navigation = useNavigation<any>();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBudgets(await api.listVariableBudgets());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View style={styles.container}>
      {/* Passe visuelle V1 (Maquette 3) — en-tête cohérent avec la charte Home :
          titre en casse normale, action alignée à droite. */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Budgets</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('CreateBudget')}>
          <Text style={styles.addButtonText}>+ Nouveau budget</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={budgets}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun budget pour l'instant.</Text> : null}
        renderItem={({ item }) => {
          // Même calcul qu'avant (jamais recalculé) — seul l'encodage visuel du
          // donut (2 couleurs, comme sur Home) diffère du badge de statut à 3
          // couleurs ci-dessous, qui garde sa palette complète (aucune perte d'info).
          const ratio = item.status.budgetPeriode > 0 ? Math.min(item.status.consommeADate / item.status.budgetPeriode, 1) : 0;
          const warn = item.status.healthStatus === 'depasse' || item.status.healthStatus === 'proche_limite';
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('BudgetDetail', { id: item.id })}>
              <View style={styles.cardTop}>
                <Donut size={64} pct={ratio * 100} warn={warn} />
                <View style={styles.cardContent}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle}>{item.category.name}</Text>
                    <Text style={[styles.statusBadge, { color: HEALTH_COLOR[item.status.healthStatus] }]}>
                      {HEALTH_LABEL[item.status.healthStatus]}
                    </Text>
                  </View>
                  <Text style={styles.cardSubtitle}>
                    {item.referenceAmount.toLocaleString('fr-FR')} DH / {item.referencePeriod}
                  </Text>

                  <View style={styles.figuresRow}>
                    <View>
                      <Text style={styles.figureLabel}>Dépensé</Text>
                      <Text style={styles.figureValue}>{item.status.consommeADate.toLocaleString('fr-FR')} DH</Text>
                    </View>
                    <View>
                      <Text style={styles.figureLabel}>Restant</Text>
                      <Text style={styles.figureValue}>{item.status.budgetContractuelRestant.toLocaleString('fr-FR')} DH</Text>
                    </View>
                    <View>
                      <Text style={styles.figureLabel}>Rythme actuel</Text>
                      <Text style={styles.figureValue}>{item.status.rythmeProjete.toLocaleString('fr-FR')} DH</Text>
                    </View>
                  </View>
                </View>
              </View>

              {item.status.rythmeAlerte && (
                <Text style={styles.rythmeAlertBadge} testID={`budget-rythme-alerte-${item.id}`}>
                  ⚠ Rythme élevé — {Math.round(item.status.consumptionRatio * 100)}% consommé / {Math.round(item.status.elapsedRatio * 100)}% de période écoulée
                </Text>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: spacing.sm },
  addButtonText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '600' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardContent: { flex: 1, marginLeft: spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  statusBadge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  cardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2, marginBottom: 10 },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between' },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 2 },
  rythmeAlertBadge: { fontSize: 11, fontWeight: '700', color: colors.warning, marginTop: spacing.sm },
});
