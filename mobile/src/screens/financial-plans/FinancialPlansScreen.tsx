import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface FinancialPlan {
  id: string;
  label: string;
  planType: 'school' | 'travel' | 'other';
  destination: string | null;
  knownPlanCost: number;
  // Passe visuelle V2 (Maquette 3) — paidAmount/provisionCoverage : déjà exposés
  // par GET /financial-plans (FinancialPlansService.detailOnTx, RG-110→114),
  // simplement absents de cette interface mobile jusqu'ici. Aucun changement
  // backend, aucun nouveau calcul.
  paidAmount: number;
  provisionCoverage: number;
  remainingDue: number;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
}

const COMPLETUDE_LABEL: Record<FinancialPlan['completude'], string> = {
  complet: 'Complet',
  contient_estimations: 'Contient des estimations',
  contient_inconnues: 'Incomplet — montants inconnus',
};

const PLAN_TYPE_ICON: Record<FinancialPlan['planType'], string> = {
  school: '🎓',
  travel: '✈️',
  other: '📁',
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
      {/* Passe visuelle V2 (Maquette 3) — en-tête cohérent avec la charte Home. */}
      <Text style={styles.pageTitle}>Plans financiers</Text>
      <View style={styles.header}>
        <TouchableOpacity style={styles.addButtonOutline} onPress={() => navigation.navigate('SchoolWizard')}>
          <Text style={styles.addButtonOutlineText}>🎓 Frais scolaires</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.addButtonOutline} onPress={() => navigation.navigate('TravelWizard')}>
          <Text style={styles.addButtonOutlineText}>✈️ Voyage</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={plans}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun plan financier pour l'instant.</Text> : null}
        renderItem={({ item }) => {
          // Même principe que Home (aucun recalcul métier) : la provision est une
          // couverture séparée, jamais nette du reste dû (RG-119/RG-090) — l'écran
          // n'invente rien, il affiche paidAmount/provisionCoverage/remainingDue
          // tels que déjà exposés par l'API.
          const cost = item.knownPlanCost;
          const paidPct = cost > 0 ? Math.max(0, Math.min(100, (item.paidAmount / cost) * 100)) : 0;
          const provPct = cost > 0 ? Math.max(0, Math.min(100 - paidPct, (item.provisionCoverage / cost) * 100)) : 0;
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('FinancialPlanDetail', { id: item.id })}>
              <Text style={styles.cardTitle}>
                {PLAN_TYPE_ICON[item.planType]} {item.label}
                {item.destination ? ` · ${item.destination}` : ''}
              </Text>
              <Text style={styles.cardMeta}>{COMPLETUDE_LABEL[item.completude]}</Text>
              <Text style={styles.cardAmount}>{cost.toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.cardSub}>Payé {item.paidAmount.toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.cardSub}>Provisionné {item.provisionCoverage.toLocaleString('fr-FR')} DH</Text>
              {cost > 0 && (paidPct > 0 || provPct > 0) && (
                <View style={styles.planTrack}>
                  <View style={[styles.planTrackPaid, { width: `${paidPct}%` }]} />
                  <View style={[styles.planTrackProv, { width: `${provPct}%` }]} />
                </View>
              )}
              {item.remainingDue > 0 && <Text style={styles.cardRemaining}>Reste à financer : {item.remainingDue.toLocaleString('fr-FR')} DH</Text>}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.lg, gap: spacing.sm },
  addButtonOutline: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: spacing.sm },
  addButtonOutlineText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '600' },
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
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.warning, marginTop: 2, marginBottom: 10 },
  cardAmount: { fontSize: 18, fontWeight: '800', color: colors.textPrimary },
  cardSub: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  planTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceSecondary, overflow: 'hidden', flexDirection: 'row', marginTop: spacing.sm },
  planTrackPaid: { height: '100%', backgroundColor: colors.success },
  planTrackProv: { height: '100%', backgroundColor: '#7089DF' },
  cardRemaining: { fontSize: 11, color: colors.textSecondary, marginTop: spacing.xs },
});
