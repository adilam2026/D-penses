import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';

interface Goal {
  id: string;
  label: string;
  targetAmount: number;
  savedAmount: number;
  remainingToConstitute: number;
  progressPercent: number;
  status: 'en_cours' | 'en_pause' | 'atteint' | 'abandonne';
}

/** Objectifs (§23/25) — progression purement descriptive, aucune recommandation de rythme (Lot 8). */
export function GoalsScreen() {
  const navigation = useNavigation<any>();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGoals(await api.listGoals());
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
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.navigate('CreateGoal')}>
          <Text style={styles.addButtonText}>+ Nouvel objectif</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={goals}
        keyExtractor={(g) => g.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun objectif pour l'instant.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('GoalDetail', { id: item.id })}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${item.progressPercent}%` }]} />
            </View>
            <View style={styles.figuresRow}>
              <Text style={styles.figure}>Constitué : {item.savedAmount.toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.figure}>Reste : {item.remainingToConstitute.toLocaleString('fr-FR')} DH</Text>
            </View>
            <Text style={styles.target}>Cible : {item.targetAmount.toLocaleString('fr-FR')} DH</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.lg },
  addButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: spacing.sm },
  addButtonText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '600' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginBottom: 10 },
  progressTrack: { height: 6, backgroundColor: colors.surfaceSecondary, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', backgroundColor: colors.success },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between' },
  figure: { fontSize: 12, color: colors.textSecondary },
  target: { fontSize: 11, color: colors.textSecondary, marginTop: 6 },
});
