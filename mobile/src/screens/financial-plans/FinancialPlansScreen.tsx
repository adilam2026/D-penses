import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { COMPLETUDE_LABEL, FinancialPlan, PLAN_TYPE_ICON } from './financialPlansLogic';

/** Liste des FinancialPlan (§7/§15) — École 2026/2027, Vacances, Travaux maison... */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<FinancialPlan[]>([]);
  const [loading, setLoading] = useState(true);
  // Corrections UI/UX finales §5/§11 — un seul bouton "+" ouvre le choix du type
  // de plan (École/Voyage/Voiture/Maison/Abonnements), jamais 2 boutons fixes
  // en tête d'écran. Même pattern/options que QuickActionsSheet.onCreerPlan().
  const [planChoiceOpen, setPlanChoiceOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await api.listFinancialPlans();
      // Point 9 — ordre alphabétique croissant, insensible à la casse et aux
      // accents (jamais l'ordre de création/réponse API) ; localeCompare('fr',
      // {sensitivity:'base'}) ignore casse ET accents (é/e, À/a...).
      setPlans([...all].sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })));
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
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Plans financiers</Text>
        <TouchableOpacity testID="financial-plans-add-button" style={styles.addButton} onPress={() => setPlanChoiceOpen(true)}>
          <Ionicons name="add" size={22} color={colors.textOnPrimary} />
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
              {item.planType === 'school' && item.schoolYear && (
                <TouchableOpacity
                  testID={`plan-project-${item.id}`}
                  style={styles.projectButton}
                  onPress={(e) => {
                    e.stopPropagation();
                    navigation.navigate('SchoolProjection', { financialPlanId: item.id });
                  }}
                >
                  <Text style={styles.projectButtonText}>📈 Projeter les années suivantes</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }}
      />

      <ChoiceSheet
        visible={planChoiceOpen}
        title="Nouveau plan"
        testID="plan-type-choice"
        onClose={() => setPlanChoiceOpen(false)}
        options={[
          {
            key: 'scolaire',
            label: 'Frais scolaires',
            description: 'Échéances de scolarité et services associés',
            icon: 'school-outline',
            onPress: () => navigation.navigate('SchoolWizard'),
          },
          {
            key: 'voyage',
            label: 'Voyage',
            description: "Budget et dépenses d'un voyage",
            icon: 'airplane-outline',
            onPress: () => navigation.navigate('TravelWizard'),
          },
          {
            key: 'voiture',
            label: 'Voiture',
            description: 'Charges liées à un véhicule',
            icon: 'car-outline',
            onPress: () => navigation.navigate('VehicleWizard'),
          },
          {
            key: 'maison',
            label: 'Maison',
            description: 'Charges liées à un logement',
            icon: 'home-outline',
            onPress: () => navigation.navigate('HousingWizard'),
          },
          {
            key: 'abonnements',
            label: 'Abonnements',
            description: 'Vue regroupée de vos abonnements',
            icon: 'repeat-outline',
            onPress: () => navigation.navigate('SubscriptionsWizard'),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  pageTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  addButton: { backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
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
  projectButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceActive,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginTop: spacing.sm,
  },
  projectButtonText: { fontSize: 11, fontWeight: '700', color: colors.textPrimary },
});
