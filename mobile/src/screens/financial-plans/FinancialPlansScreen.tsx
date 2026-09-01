import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface FinancialPlan {
  id: string;
  label: string;
  knownPlanCost: number;
  remainingDue: number;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
}

const COMPLETUDE_LABEL: Record<FinancialPlan['completude'], string> = {
  complet: 'Complet',
  contient_estimations: 'Contient des estimations',
  contient_inconnues: 'Incomplet — montants inconnus',
};

/** Liste des FinancialPlan (§7/§15) — École 2026/2027, Vacances, Travaux maison... */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<FinancialPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await api.listFinancialPlans());
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
        <TouchableOpacity style={styles.addButtonOutline} onPress={() => navigation.getParent()?.navigate('SchoolWizard')}>
          <Text style={styles.addButtonOutlineText}>🎓 Frais scolaires</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun plan financier pour l'instant.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.getParent()?.navigate('FinancialPlanDetail', { id: item.id })}>
            <Text style={styles.cardTitle}>{item.label}</Text>
            <Text style={styles.cardMeta}>{COMPLETUDE_LABEL[item.completude]}</Text>
            <View style={styles.figuresRow}>
              <View>
                <Text style={styles.figureLabel}>Budget connu</Text>
                <Text style={styles.figureValue}>{item.knownPlanCost.toLocaleString('fr-FR')} DH</Text>
              </View>
              <View>
                <Text style={styles.figureLabel}>Reste à payer</Text>
                <Text style={styles.figureValue}>{item.remainingDue.toLocaleString('fr-FR')} DH</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 16, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 16 },
  addButtonOutline: { backgroundColor: '#172436', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  addButtonOutlineText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#B8860B', marginTop: 2, marginBottom: 10 },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between' },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 2 },
});
