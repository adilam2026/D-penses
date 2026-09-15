import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { Select } from '../../ui/Select';
import { colors, radius, spacing } from '../../ui/theme';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';

interface ChargePlanRef {
  id: string;
  label: string;
}

interface SchoolProjectionRow {
  id: string;
  label: string;
  schoolYear: string;
  computedAmount: number | string;
  targetDate: string;
  status: 'projete' | 'remplacee';
  child?: { firstName: string } | null;
}

const INCREASE_OPTIONS = [
  { value: 'aucune', label: 'Aucune hausse' },
  { value: 'fixe', label: 'Hausse fixe (DH/an)' },
  { value: 'pourcentage', label: 'Hausse en %/an' },
];

const HORIZON_OPTIONS = [
  { value: '1', label: '1 an' },
  { value: '3', label: '3 ans' },
  { value: '5', label: '5 ans' },
  { value: 'custom', label: 'Personnalisé (année cible)' },
];

/**
 * M9B §2 — "Projeter les années suivantes" depuis un plan École réel : horizon
 * (1/3/5/personnalisé), règle d'évolution par poste ou globale ("Appliquer la
 * même règle à tous"), puis liste des prévisions existantes (Projeté/Remplacée).
 * Jamais une vraie Deadline créée ici (SchoolProjection reste une hypothèse
 * future, cf. rapport M9) — la transformation prévision→réel se fait depuis
 * l'assistant "Frais scolaires" (détection automatique des prévisions).
 */
export function SchoolProjectionScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const financialPlanId = route.params?.financialPlanId as string;

  const [loading, setLoading] = useState(true);
  const [planLabel, setPlanLabel] = useState('');
  const [schoolYear, setSchoolYear] = useState<string | null>(null);
  const [chargePlans, setChargePlans] = useState<ChargePlanRef[]>([]);
  const [rows, setRows] = useState<SchoolProjectionRow[]>([]);

  const [horizon, setHorizon] = useState('1');
  const [customYear, setCustomYear] = useState('');
  const [applyToAllType, setApplyToAllType] = useState<'aucune' | 'fixe' | 'pourcentage'>('aucune');
  const [applyToAllValue, setApplyToAllValue] = useState('');
  const [perPoste, setPerPoste] = useState(false);
  const [rules, setRules] = useState<Record<string, { type: 'aucune' | 'fixe' | 'pourcentage'; value: string }>>({});

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const load = useCallback(async () => {
    if (!financialPlanId) return;
    setLoading(true);
    try {
      const [plan, projections] = await Promise.all([api.getFinancialPlan(financialPlanId), api.listSchoolProjections(financialPlanId)]);
      setPlanLabel((plan as any).label);
      setSchoolYear((plan as any).schoolYear ?? null);
      setChargePlans(((plan as any).chargePlans ?? []) as ChargePlanRef[]);
      setRows(projections as SchoolProjectionRow[]);
    } finally {
      setLoading(false);
    }
  }, [financialPlanId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function ruleFor(chargePlanId: string) {
    return rules[chargePlanId] ?? { type: applyToAllType, value: applyToAllValue };
  }

  function setRuleType(chargePlanId: string, type: 'aucune' | 'fixe' | 'pourcentage') {
    setRules((r) => ({ ...r, [chargePlanId]: { type, value: ruleFor(chargePlanId).value } }));
  }

  function setRuleValue(chargePlanId: string, value: string) {
    setRules((r) => ({ ...r, [chargePlanId]: { type: ruleFor(chargePlanId).type, value } }));
  }

  async function onGenerate() {
    setError(null);
    if (horizon === 'custom' && !/^\d{4}\/\d{4}$/.test(customYear)) {
      setError('Année cible invalide (format AAAA/AAAA)');
      return;
    }
    setGenerating(true);
    try {
      await api.generateSchoolProjections(financialPlanId, {
        years: horizon === 'custom' ? undefined : (Number(horizon) as 1 | 3 | 5),
        targetSchoolYear: horizon === 'custom' ? customYear : undefined,
        applyToAllIncreaseType: applyToAllType,
        applyToAllIncreaseValue: applyToAllType === 'aucune' ? undefined : Number(applyToAllValue.replace(',', '.')) || 0,
        rules: perPoste
          ? chargePlans.map((cp) => {
              const r = ruleFor(cp.id);
              return { chargePlanId: cp.id, increaseType: r.type, increaseValue: r.type === 'aucune' ? undefined : Number(r.value.replace(',', '.')) || 0 };
            })
          : undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Génération impossible');
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!schoolYear) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Ce plan n'a pas d'année scolaire structurée — impossible de le projeter.</Text>
        <TouchableOpacity style={styles.button} onPress={() => navigation.goBack()}>
          <Text style={styles.buttonText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const byYear = new Map<string, SchoolProjectionRow[]>();
  for (const row of rows) {
    if (!byYear.has(row.schoolYear)) byYear.set(row.schoolYear, []);
    byYear.get(row.schoolYear)!.push(row);
  }
  const years = Array.from(byYear.keys()).sort();

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Projeter les années suivantes</Text>
      <Text style={styles.subtitle}>
        {planLabel} · {schoolYear}
      </Text>

      <Text style={styles.sectionLabel}>Horizon</Text>
      <Select testID="school-projection-horizon" value={horizon} options={HORIZON_OPTIONS} onChange={setHorizon} />
      {horizon === 'custom' && (
        <TextInput
          testID="school-projection-custom-year"
          style={styles.input}
          value={customYear}
          onChangeText={setCustomYear}
          onFocus={handleFocus}
          placeholder="2031/2032"
        />
      )}

      <Text style={styles.sectionLabel}>Règle d'évolution — tous les postes</Text>
      <Select testID="school-projection-apply-all-type" value={applyToAllType} options={INCREASE_OPTIONS} onChange={(v) => setApplyToAllType(v as any)} />
      {applyToAllType !== 'aucune' && (
        <TextInput
          testID="school-projection-apply-all-value"
          style={styles.input}
          keyboardType="decimal-pad"
          value={applyToAllValue}
          onChangeText={setApplyToAllValue}
          onFocus={handleFocus}
          placeholder={applyToAllType === 'fixe' ? 'Montant en DH' : 'Pourcentage'}
        />
      )}

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Personnaliser par poste</Text>
        <Switch testID="school-projection-per-poste-toggle" value={perPoste} onValueChange={setPerPoste} />
      </View>

      {perPoste &&
        chargePlans.map((cp) => {
          const r = ruleFor(cp.id);
          return (
            <View key={cp.id} style={styles.posteRow}>
              <Text style={styles.posteLabel}>{cp.label}</Text>
              <Select testID={`school-projection-rule-type-${cp.id}`} value={r.type} options={INCREASE_OPTIONS} onChange={(v) => setRuleType(cp.id, v as any)} />
              {r.type !== 'aucune' && (
                <TextInput
                  testID={`school-projection-rule-value-${cp.id}`}
                  style={styles.input}
                  keyboardType="decimal-pad"
                  value={r.value}
                  onChangeText={(v) => setRuleValue(cp.id, v)}
                  onFocus={handleFocus}
                  placeholder={r.type === 'fixe' ? 'Montant en DH' : 'Pourcentage'}
                />
              )}
            </View>
          );
        })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <TouchableOpacity testID="school-projection-generate" style={styles.button} onPress={onGenerate} disabled={generating}>
        {generating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Générer la prévision</Text>}
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Années projetées</Text>
      {years.length === 0 ? (
        <Text style={styles.emptyText}>Aucune prévision pour l'instant.</Text>
      ) : (
        years.map((y) => (
          <View key={y} style={styles.yearBlock}>
            <Text style={styles.yearTitle}>{y}</Text>
            {byYear.get(y)!.map((row) => (
              <View key={row.id} style={styles.projectionRow}>
                <Text style={styles.projectionLabel}>
                  {row.label}
                  {row.child?.firstName ? ` · ${row.child.firstName}` : ''}
                </Text>
                <Text style={styles.projectionAmount}>{Number(row.computedAmount).toLocaleString('fr-FR')} DH</Text>
                <Text style={[styles.badge, row.status === 'remplacee' ? styles.badgeReplaced : styles.badgeProjected]}>
                  {row.status === 'remplacee' ? 'Remplacée' : 'Projeté'}
                </Text>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  scroll: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  posteRow: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  posteLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginBottom: spacing.md },
  yearBlock: { marginBottom: spacing.md },
  yearTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  projectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  projectionLabel: { flex: 1, fontSize: 13, color: colors.textPrimary },
  projectionAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginRight: spacing.sm },
  badge: { fontSize: 10, fontWeight: '700', borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 3, overflow: 'hidden' },
  badgeProjected: { backgroundColor: '#DCE8FF', color: '#2255CC' },
  badgeReplaced: { backgroundColor: colors.surfaceSecondary, color: colors.textSecondary },
});
