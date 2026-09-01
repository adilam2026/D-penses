import React, { useCallback, useState } from 'react';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as api from '../../api/client';

interface ChildCosts {
  child: { firstName: string; lastName: string };
  coutConnu: number;
  paye: number;
  resteAPayer: number;
  resteAFinancer: number;
  byCategory: Record<string, number>;
  chargesCommunesNonVentilees: Array<{ label: string; amount: number }>;
}

/** Fiche enfant → Coûts (§16) — jamais le montant complet d'une charge commune non ventilée. */
export function ChildCostsScreen() {
  const route = useRoute<any>();
  const childId = route.params?.id as string;
  const [costs, setCosts] = useState<ChildCosts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCosts(await api.getChildCosts(childId));
    } finally {
      setLoading(false);
    }
  }, [childId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !costs) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>
        {costs.child.firstName} {costs.child.lastName}
      </Text>

      <View style={styles.figuresGrid}>
        <Figure label="Coût connu" value={costs.coutConnu} />
        <Figure label="Payé" value={costs.paye} />
        <Figure label="Reste à payer" value={costs.resteAPayer} />
        <Figure label="Reste à financer" value={costs.resteAFinancer} highlight />
      </View>

      <Text style={styles.sectionTitle}>Répartition par catégorie</Text>
      {Object.entries(costs.byCategory).length === 0 ? (
        <Text style={styles.empty}>Aucune charge attribuée pour l'instant.</Text>
      ) : (
        Object.entries(costs.byCategory).map(([name, amount]) => (
          <View key={name} style={styles.rowSimple}>
            <Text style={styles.rowLabel}>{name}</Text>
            <Text style={styles.rowAmount}>{amount.toLocaleString('fr-FR')} DH</Text>
          </View>
        ))
      )}

      {costs.chargesCommunesNonVentilees.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Charges communes non ventilées</Text>
          <Text style={styles.note}>Montant partagé avec un autre enfant, non réparti — jamais compté en totalité ci-dessus.</Text>
          {costs.chargesCommunesNonVentilees.map((c, i) => (
            <View key={i} style={styles.rowSimple}>
              <Text style={styles.rowLabel}>{c.label}</Text>
              <Text style={styles.rowAmount}>Charge commune : {c.amount.toLocaleString('fr-FR')} DH</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
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
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436', marginBottom: 16 },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  figure: { width: '50%', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 16, fontWeight: '700', color: '#172436', marginTop: 4 },
  figureValueHighlight: { color: '#B3261E' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  note: { fontSize: 11, color: '#6B747C', marginBottom: 8, fontStyle: 'italic' },
  rowSimple: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
});
