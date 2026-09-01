import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface BudgetStatus {
  budgetPeriode: number;
  consommeADate: number;
  budgetContractuelRestant: number;
  rythmeProjete: number;
  healthStatus: 'sous_budget' | 'proche_limite' | 'depasse';
}

interface Budget {
  id: string;
  referenceAmount: number;
  referencePeriod: 'semaine' | 'mois';
  category: { name: string };
  status: BudgetStatus;
}

const HEALTH_LABEL: Record<BudgetStatus['healthStatus'], string> = {
  sous_budget: 'Sous budget',
  proche_limite: 'Proche limite',
  depasse: 'Dépassé',
};

const HEALTH_COLOR: Record<BudgetStatus['healthStatus'], string> = {
  sous_budget: '#2E7D5B',
  proche_limite: '#B8860B',
  depasse: '#B3261E',
};

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
      <View style={styles.header}>
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.getParent()?.navigate('CreateBudget')}>
          <Text style={styles.addButtonText}>+ Nouveau budget</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={budgets}
        keyExtractor={(b) => b.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun budget pour l'instant.</Text> : null}
        renderItem={({ item }) => {
          const ratio = item.status.budgetPeriode > 0 ? Math.min(item.status.consommeADate / item.status.budgetPeriode, 1) : 0;
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.getParent()?.navigate('BudgetDetail', { id: item.id })}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.category.name}</Text>
                <Text style={[styles.statusBadge, { color: HEALTH_COLOR[item.status.healthStatus] }]}>
                  {HEALTH_LABEL[item.status.healthStatus]}
                </Text>
              </View>
              <Text style={styles.cardSubtitle}>
                {item.referenceAmount.toLocaleString('fr-FR')} DH / {item.referencePeriod}
              </Text>

              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${ratio * 100}%`, backgroundColor: HEALTH_COLOR[item.status.healthStatus] }]} />
              </View>

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
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 },
  addButton: { backgroundColor: '#172436', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#172436' },
  statusBadge: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  cardSubtitle: { fontSize: 12, color: '#6B747C', marginTop: 2, marginBottom: 10 },
  progressTrack: { height: 6, backgroundColor: '#EDEBE6', borderRadius: 3, overflow: 'hidden', marginBottom: 12 },
  progressFill: { height: '100%' },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between' },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 2 },
});
