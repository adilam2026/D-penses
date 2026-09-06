import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface ChildCosts {
  child: { firstName: string; lastName: string };
  coutConnu: number;
  paye: number;
  resteAPayer: number;
  resteAFinancer: number;
  byCategory: Record<string, number>;
  chargesCommunesNonVentilees: Array<{ chargePlanId: string; deadlineId: string; label: string; amount: number }>;
  prochaineEcheance: { deadlineId: string; chargePlanId: string; label: string; dueDate: string; resteAPayer: number } | null;
  plansAssocies: Array<{ id: string; label: string }>;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Fiche enfant → Coûts (§16, enrichie Vague 2 §7) — jamais le montant complet d'une charge commune non ventilée. */
export function ChildCostsScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
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

      {costs.prochaineEcheance && (
        <TouchableOpacity
          style={styles.nextCard}
          onPress={() => navigation.navigate('DeadlineDetail', { id: costs.prochaineEcheance!.deadlineId })}
        >
          <Text style={styles.nextLabel}>Prochaine échéance</Text>
          <Text style={styles.nextTitle}>{costs.prochaineEcheance.label}</Text>
          <Text style={styles.nextMeta}>
            {formatDate(costs.prochaineEcheance.dueDate)} · {costs.prochaineEcheance.resteAPayer.toLocaleString('fr-FR')} DH restants
          </Text>
        </TouchableOpacity>
      )}

      {costs.plansAssocies.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Plans financiers associés</Text>
          {costs.plansAssocies.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={styles.rowSimple}
              onPress={() => navigation.navigate('FinancialPlanDetail', { id: p.id })}
            >
              <Text style={styles.rowLabel}>{p.label}</Text>
              <Text style={styles.rowLink}>Voir →</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

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
          {costs.chargesCommunesNonVentilees.map((c) => (
            <TouchableOpacity
              key={c.deadlineId}
              style={styles.rowSimple}
              onPress={() => navigation.navigate('DeadlineDetail', { id: c.deadlineId })}
            >
              <Text style={styles.rowLabel}>{c.label}</Text>
              <Text style={styles.rowAmount}>Charge commune : {c.amount.toLocaleString('fr-FR')} DH</Text>
            </TouchableOpacity>
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
  nextCard: { backgroundColor: '#172436', borderRadius: 12, padding: 14, marginBottom: 12 },
  nextLabel: { fontSize: 11, color: '#AEB8C4', fontWeight: '600', textTransform: 'uppercase' },
  nextTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginTop: 4 },
  nextMeta: { fontSize: 12, color: '#D7DCE2', marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  note: { fontSize: 11, color: '#6B747C', marginBottom: 8, fontStyle: 'italic' },
  rowSimple: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
  rowLink: { fontSize: 12, color: '#2E7D5B', fontWeight: '700' },
});
