import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { FREQUENCY_LABEL, frequencyOptions } from '../../ui/frequency';
import { TEMPORAL_STATUS_LABEL, temporalStatus, temporalStatusColor } from '../../ui/temporalStatus';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { ChargePlan, STATUS_LABEL, formatShortDate, n } from './chargesLogic';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface FinancialPlanOption {
  id: string;
  label: string;
}

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const AMOUNT_STATUS_LABEL: Record<string, string> = { estime: 'Estimé', confirme: 'Confirmé', inconnu: 'Montant inconnu' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Portail Web v4 §1/§6 (WEB-V4.3) — Charges/Échéances desktop : vraie table
 * (Libellé/Fréquence/Prochaine échéance/Statut/Montant/Action), onglets
 * Actives/Arrêtées, panneau sticky "Ajouter une charge" reprenant exactement
 * les champs/endpoints de CreateChargeScreen (mobile) — aucun champ inventé.
 */
export function ChargesScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<ChargePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [seuilAPayerDays, setSeuilAPayerDays] = useState(7);
  const [tab, setTab] = useState<'actif' | 'inactif'>('actif');

  const [categories, setCategories] = useState<Category[]>([]);
  const [label, setLabel] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [dueDate, setDueDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [amountStatus, setAmountStatus] = useState<'estime' | 'confirme' | 'inconnu'>('estime');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [financialPlans, setFinancialPlans] = useState<FinancialPlanOption[]>([]);
  // Convergence V6 §9 — "Plan financier : Aucun / Scolarité / Vacances / etc."
  const [financialPlanId, setFinancialPlanId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansResult, household] = await Promise.all([api.listChargePlans(), api.getMyHousehold()]);
      setPlans(plansResult);
      setSeuilAPayerDays(household?.settings?.seuilAPayerDays ?? 7);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    api.listCategories().then((list: Category[]) => setCategories(list.filter((c) => c.kind === 'expense' || c.kind === 'both')));
    api.listFinancialPlans().then((list: FinancialPlanOption[]) => setFinancialPlans(list));
  }, []);

  async function onCreate() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (amountStatus !== 'inconnu' && (!amount.trim() || Number(amount.replace(',', '.')) <= 0)) {
      setError('Montant invalide');
      return;
    }
    setCreating(true);
    try {
      const plan = await api.createChargePlan({
        label: label.trim(),
        startDate: dueDate,
        recurrenceRule: recurrence === 'ponctuel' ? undefined : recurrence,
        recurrenceAnchorDate: recurrence === 'ponctuel' ? undefined : dueDate,
        categoryId: categoryId ?? undefined,
        financialPlanId: financialPlanId ?? undefined,
      });
      await api.createDeadline(plan.id, {
        dueDate,
        amountStatus,
        amountCurrent: amountStatus !== 'inconnu' ? Number(amount.replace(',', '.')) : undefined,
      });
      setLabel('');
      setRecurrence('mensuel');
      setDueDate(todayIso());
      setAmount('');
      setAmountStatus('estime');
      setCategoryId(null);
      setFinancialPlanId(null);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  const active = plans.filter((p) => p.status === 'actif');
  const inactive = plans.filter((p) => p.status === 'inactif');
  const rows = tab === 'actif' ? active : inactive;

  const mainContent = (
    <>
      <View style={styles.tabRow}>
        <TouchableOpacity testID="web-charges-tab-actif" style={[styles.tab, tab === 'actif' && styles.tabActive]} onPress={() => setTab('actif')}>
          <Text style={[styles.tabText, tab === 'actif' && styles.tabTextActive]}>Actives ({active.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="web-charges-tab-inactif" style={[styles.tab, tab === 'inactif' && styles.tabActive]} onPress={() => setTab('inactif')}>
          <Text style={[styles.tabText, tab === 'inactif' && styles.tabTextActive]}>Arrêtées ({inactive.length})</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, styles.colLabel]}>Libellé</Text>
          <Text style={[styles.th, styles.colFreq]}>Fréquence</Text>
          <Text style={[styles.th, styles.colDate]}>Prochaine échéance</Text>
          <Text style={[styles.th, styles.colStatus]}>Statut</Text>
          <Text style={[styles.th, styles.colAmount]}>Montant</Text>
          <Text style={[styles.th, styles.colAction]}>Action</Text>
        </View>

        {loading && plans.length === 0 ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : rows.length === 0 ? (
          <Text style={styles.empty}>{tab === 'actif' ? "Aucune charge récurrente pour l'instant." : 'Aucune charge arrêtée.'}</Text>
        ) : (
          rows.map((p) => {
            const next = p.deadlines[0];
            const isClosed = next?.financialStatus === 'soldee' || next?.financialStatus === 'annulee';
            const temporal = next ? temporalStatus(next.dueDate, seuilAPayerDays, isClosed) : null;
            const amountValue = next ? n(next.resteAPayer) : null;
            return (
              <TouchableOpacity
                key={p.id}
                testID={`web-charge-row-${p.id}`}
                style={styles.tableRow}
                onPress={() => navigation.navigate('ChargePlanDetail', { id: p.id })}
              >
                <Text style={[styles.td, styles.colLabel, styles.labelText]} numberOfLines={1}>
                  {p.label}
                </Text>
                <Text style={[styles.td, styles.colFreq]}>{p.recurrenceRule ? FREQUENCY_LABEL[p.recurrenceRule] : 'Ponctuel'}</Text>
                <Text style={[styles.td, styles.colDate]}>
                  {next ? `${formatShortDate(next.dueDate)} · ${STATUS_LABEL[next.amountStatus]}` : 'Aucune échéance ouverte'}
                </Text>
                <View style={styles.colStatus}>
                  {temporal && <Text style={[styles.statusBadge, { color: temporalStatusColor(temporal) }]}>{TEMPORAL_STATUS_LABEL[temporal]}</Text>}
                </View>
                <Text style={[styles.td, styles.colAmount]}>
                  {amountValue !== null ? `${amountValue.toLocaleString('fr-FR')} DH` : next?.amountStatus === 'inconnu' ? 'Montant inconnu' : '—'}
                </Text>
                <Text style={[styles.td, styles.colAction, styles.actionLink]}>Voir →</Text>
              </TouchableOpacity>
            );
          })
        )}
      </View>
    </>
  );

  const panel = (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Ajouter une charge</Text>

      <FormField testID="web-charge-label" label="Libellé" placeholder="Ex. Internet, Loyer, École" value={label} onChangeText={setLabel} />

      <Select testID="web-charge-frequency" label="Fréquence" value={recurrence} options={frequencyOptions(RECURRENCE_VALUES)} onChange={setRecurrence} />

      <DateField label={recurrence === 'ponctuel' ? "Date d'échéance" : 'Prochaine échéance'} value={dueDate} onChange={setDueDate} />

      <Text style={styles.sectionLabel}>Montant</Text>
      <View style={styles.segment}>
        {(['estime', 'confirme', 'inconnu'] as const).map((s) => (
          <TouchableOpacity key={s} testID={`web-charge-amount-status-${s}`} style={[styles.segmentItem, amountStatus === s && styles.segmentActive]} onPress={() => setAmountStatus(s)}>
            <Text style={[styles.segmentText, amountStatus === s && styles.segmentTextActive]}>{AMOUNT_STATUS_LABEL[s]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {amountStatus !== 'inconnu' && (
        <FormField testID="web-charge-amount" placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
      )}

      {categories.length > 0 && (
        <Select
          testID="web-charge-category"
          label="Catégorie (facultatif)"
          placeholder="Sélectionner une catégorie"
          value={categoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          onChange={setCategoryId}
        />
      )}

      {financialPlans.length > 0 && (
        <Select
          testID="web-charge-financial-plan"
          label="Plan financier (facultatif)"
          placeholder="Aucun"
          value={financialPlanId ?? ''}
          onChange={(v) => setFinancialPlanId(v || null)}
          options={[{ value: '', label: 'Aucun' }, ...financialPlans.map((p) => ({ value: p.id, label: p.label }))]}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity testID="web-charge-create-submit" style={styles.submitButton} onPress={onCreate} disabled={creating}>
        {creating ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Ajouter la charge</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Charges / Échéances" />
      <TwoColumnLayout main={mainContent} panel={panel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  tabRow: { flexDirection: 'row', gap: webSpacing.sm, marginBottom: webSpacing.md },
  tab: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.md, paddingVertical: 8, borderWidth: 1, borderColor: webColors.border },
  tabActive: { backgroundColor: webColors.primary, borderColor: webColors.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: webColors.textSecondary },
  tabTextActive: { color: webColors.textOnPrimary },

  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: webColors.tableHeaderBg, paddingHorizontal: webSpacing.md, paddingVertical: 8 },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  th: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  td: { fontSize: 12, color: webColors.textPrimary },
  colLabel: { flex: 2, paddingRight: webSpacing.sm },
  labelText: { fontWeight: '700' },
  colFreq: { flex: 1, paddingRight: webSpacing.sm },
  colDate: { flex: 1.4, paddingRight: webSpacing.sm },
  colStatus: { width: 100 },
  statusBadge: { fontSize: 11, fontWeight: '700' },
  colAmount: { width: 110, textAlign: 'right', fontWeight: '700', paddingRight: webSpacing.sm },
  colAction: { width: 60, textAlign: 'right' },
  actionLink: { color: webColors.primary, fontWeight: '700' },
  empty: { color: webColors.textSecondary, fontSize: 13, lineHeight: 20, padding: webSpacing.lg },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  sectionLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary, marginBottom: 6, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, padding: 3, marginBottom: webSpacing.sm },
  segmentItem: { flex: 1, paddingVertical: 8, borderRadius: webRadius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: webColors.surface },
  segmentText: { fontSize: 11, color: webColors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: webColors.textPrimary },
  submitButton: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center', marginTop: webSpacing.sm },
  submitButtonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
});
