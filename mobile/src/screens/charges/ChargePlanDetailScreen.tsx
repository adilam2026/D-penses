import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { Select } from '../../ui/Select';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface ChargePlan {
  id: string;
  label: string;
  categoryId: string | null;
  recurrenceRule: string | null;
  status: 'actif' | 'inactif';
  obligationStatus: string;
}

interface Deadline {
  id: string;
  dueDate: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
}

const STATUS_LABEL: Record<Deadline['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

function n(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Recette post-Vague 3 (§4/§15) — détail d'une charge récurrente : modifier
 * (label/catégorie/fréquence), arrêter la récurrence (status=inactif — jamais
 * la même chose que supprimer) ou supprimer (bloqué avec historique de
 * paiement, RG implicite). Chaque échéance liste séparément, tap → détail
 * (paiement déjà géré par DeadlineDetailScreen, jamais dupliqué ici).
 */
export function ChargePlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const id = route.params?.id as string;

  const [plan, setPlan] = useState<ChargePlan | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [recurrenceRule, setRecurrenceRule] = useState('ponctuel');
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, categoryList] = await Promise.all([api.getChargePlan(id), api.listChargePlanDeadlines(id), api.listCategories()]);
      setPlan(p);
      setDeadlines(d);
      setCategories((categoryList as Category[]).filter((c) => c.kind === 'expense' || c.kind === 'both'));
      setLabel(p.label);
      setCategoryId(p.categoryId);
      setRecurrenceRule(p.recurrenceRule ?? 'ponctuel');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    setSaving(true);
    try {
      await api.updateChargePlan(id, {
        label: label.trim(),
        categoryId: categoryId ?? null,
        recurrenceRule: recurrenceRule === 'ponctuel' ? undefined : recurrenceRule,
      });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!plan) return;
    setError(null);
    setTogglingStatus(true);
    try {
      await api.updateChargePlan(id, { status: plan.status === 'actif' ? 'inactif' : 'actif' });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Opération impossible');
    } finally {
      setTogglingStatus(false);
    }
  }

  function onDelete() {
    Alert.alert('Supprimer cette charge ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          setDeleting(true);
          try {
            await api.deleteChargePlan(id);
            navigation.goBack();
          } catch (err) {
            setError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  if (loading && !plan) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!plan) return null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        {plan.status === 'inactif' && (
          <View style={styles.inactiveBanner}>
            <Text style={styles.inactiveBannerText}>Récurrence arrêtée — aucune nouvelle échéance ne sera générée.</Text>
          </View>
        )}

        <Text style={styles.label}>Libellé</Text>
        <TextInput style={styles.input} value={label} onChangeText={setLabel} onFocus={handleFocus} />

        {categories.length > 0 && (
          <Select
            testID="chargeplan-category-select"
            label="Catégorie"
            placeholder="Sélectionner une catégorie"
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        )}

        <Select
          testID="chargeplan-frequency-select"
          label="Fréquence"
          value={recurrenceRule}
          options={frequencyOptions(RECURRENCE_VALUES)}
          onChange={setRecurrenceRule}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onSave} disabled={saving} testID="chargeplan-save">
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.buttonSecondary} onPress={onToggleStatus} disabled={togglingStatus} testID="chargeplan-toggle-status">
            {togglingStatus ? (
              <ActivityIndicator color="#172436" />
            ) : (
              <Text style={styles.buttonSecondaryText}>{plan.status === 'actif' ? 'Arrêter la récurrence' : 'Réactiver'}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonDanger} onPress={onDelete} disabled={deleting} testID="chargeplan-delete">
            {deleting ? <ActivityIndicator color="#B3261E" /> : <Text style={styles.buttonDangerText}>Supprimer</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Échéances</Text>
        {deadlines.length === 0 ? (
          <Text style={styles.empty}>Aucune échéance pour l'instant.</Text>
        ) : (
          deadlines.map((d) => (
            <TouchableOpacity key={d.id} style={styles.deadlineRow} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deadlineDate}>{formatDate(d.dueDate)}</Text>
                <Text style={styles.deadlineMeta}>
                  {STATUS_LABEL[d.financialStatus]} · {d.amountStatus === 'confirme' ? 'Confirmé' : d.amountStatus === 'estime' ? 'Estimé' : 'Inconnu'}
                </Text>
              </View>
              <Text style={styles.deadlineAmount}>{n(d.resteAPayer) !== null ? `${n(d.resteAPayer)!.toLocaleString('fr-FR')} DH` : '—'}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  inactiveBanner: { backgroundColor: '#FBEAEA', borderRadius: 10, padding: 12, marginBottom: 16 },
  inactiveBannerText: { color: '#B3261E', fontSize: 12, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
  },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  actionsRow: { flexDirection: 'row', marginTop: 12, justifyContent: 'space-between' },
  buttonSecondary: { flex: 1, backgroundColor: '#EEF0F3', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginRight: 8 },
  buttonSecondaryText: { color: '#172436', fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: '#FBEAEA', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: '#B3261E', fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 20, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  deadlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  deadlineDate: { fontSize: 13, fontWeight: '700', color: '#172436' },
  deadlineMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  deadlineAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
});
