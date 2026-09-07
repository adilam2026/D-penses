import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';

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
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingTop: spacing.md },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  figure: { width: '50%', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  figureLabel: { fontSize: 11, color: colors.textSecondary },
  figureValue: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: colors.danger },
  nextCard: { backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md },
  nextLabel: { fontSize: 11, color: colors.textOnPrimary, opacity: 0.7, fontWeight: '600', textTransform: 'uppercase' },
  nextTitle: { fontSize: 15, fontWeight: '700', color: colors.textOnPrimary, marginTop: 4 },
  nextMeta: { fontSize: 12, color: colors.textOnPrimary, opacity: 0.85, marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  note: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  rowSimple: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  rowAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  rowLink: { fontSize: 12, color: colors.success, fontWeight: '700' },
});
