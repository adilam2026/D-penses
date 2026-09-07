import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

interface SourceDetail {
  id: string;
  label: string;
  usualAmount: number | string;
  recurrenceRule: string | null;
  status: 'actif' | 'inactif';
}

interface Occurrence {
  id: string;
  usualDate: string;
  plannedAmount: number | string;
  actualAmount: number | string | null;
  actualDate: string | null;
  status: 'prevu' | 'recu';
  accountId: string | null;
}

interface Account {
  id: string;
  name: string;
}

function n(v: number | string | null): number {
  if (v === null) return 0;
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Cycle prévu → reçu d'une source de revenu (Lot 1 — recette), montant réel pouvant différer du prévu (RG-014bis). */
export function IncomeSourceDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const sourceId = route.params?.id as string;
  const routeLabel = route.params?.label as string;

  const [source, setSource] = useState<SourceDetail | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [editLabel, setEditLabel] = useState(routeLabel ?? '');
  const [editAmount, setEditAmount] = useState('');
  const [editRecurrence, setEditRecurrence] = useState('ponctuel');
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [plannedDate, setPlannedDate] = useState(todayIso());
  const [plannedAmount, setPlannedAmount] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [actualAmounts, setActualAmounts] = useState<Record<string, string>>({});
  // §11 — le compte pré-rempli (celui de la source) reste modifiable jusqu'à la confirmation.
  const [confirmAccountIds, setConfirmAccountIds] = useState<Record<string, string>>({});
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, o, accs] = await Promise.all([api.getIncomeSource(sourceId), api.listIncomeOccurrences(sourceId), api.listAccounts()]);
      setSource(s);
      setOccurrences(o);
      setAccounts(accs);
      setEditLabel(s.label);
      setEditAmount(String(n(s.usualAmount)));
      setEditRecurrence(s.recurrenceRule ?? 'ponctuel');
    } finally {
      setLoading(false);
    }
  }, [sourceId]);

  async function onSaveSource() {
    setEditError(null);
    if (!editLabel.trim()) {
      setEditError('Un libellé est requis');
      return;
    }
    const numericAmount = Number(editAmount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setEditError('Montant invalide');
      return;
    }
    setSaving(true);
    try {
      await api.updateIncomeSource(sourceId, {
        label: editLabel.trim(),
        usualAmount: numericAmount,
        recurrenceRule: editRecurrence === 'ponctuel' ? undefined : editRecurrence,
      });
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!source) return;
    setEditError(null);
    setTogglingStatus(true);
    try {
      await api.updateIncomeSource(sourceId, { status: source.status === 'actif' ? 'inactif' : 'actif' });
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Opération impossible');
    } finally {
      setTogglingStatus(false);
    }
  }

  function onDeleteSource() {
    Alert.alert('Supprimer cette source de revenu ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          setEditError(null);
          setDeleting(true);
          try {
            await api.deleteIncomeSource(sourceId);
            navigation.goBack();
          } catch (err) {
            setEditError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreateOccurrence() {
    setCreateError(null);
    setCreating(true);
    try {
      await api.createIncomeOccurrence(sourceId, {
        usualDate: plannedDate,
        plannedAmount: plannedAmount.trim() ? Number(plannedAmount.replace(',', '.')) : undefined,
      });
      setPlannedAmount('');
      await load();
    } catch (err) {
      setCreateError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  async function onConfirm(occurrence: Occurrence) {
    setConfirmError(null);
    const raw = actualAmounts[occurrence.id];
    const value = raw ? Number(raw.replace(',', '.')) : NaN;
    if (!value || value <= 0) {
      setConfirmError('Montant réel invalide');
      return;
    }
    const accountId = confirmAccountIds[occurrence.id] ?? occurrence.accountId ?? undefined;
    if (!accountId) {
      setConfirmError('Choisissez un compte à créditer');
      return;
    }
    setConfirmingId(occurrence.id);
    try {
      await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: value, actualDate: todayIso(), accountId });
      await load();
    } catch (err) {
      setConfirmError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{routeLabel ?? source?.label}</Text>

        {source?.status === 'inactif' && (
          <View style={styles.inactiveBanner}>
            <Text style={styles.inactiveBannerText}>Récurrence arrêtée — aucune nouvelle occurrence ne sera générée.</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Modifier la source</Text>
        <FormField testID="income-source-label-input" label="Libellé" value={editLabel} onChangeText={setEditLabel} onFocus={handleFocus} />
        <FormField
          testID="income-source-amount-input"
          label="Montant habituel"
          placeholder="Montant habituel (DH)"
          keyboardType="decimal-pad"
          value={editAmount}
          onChangeText={setEditAmount}
          onFocus={handleFocus}
        />
        <Select
          testID="income-source-frequency-select"
          label="Fréquence"
          value={editRecurrence}
          options={frequencyOptions(RECURRENCE_VALUES)}
          onChange={setEditRecurrence}
        />
        {editError ? <Text style={styles.error}>{editError}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onSaveSource} disabled={saving} testID="income-source-save">
          {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>
        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.buttonSecondary} onPress={onToggleStatus} disabled={togglingStatus} testID="income-source-toggle-status">
            {togglingStatus ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.buttonSecondaryText}>{source?.status === 'actif' ? 'Arrêter la récurrence' : 'Réactiver'}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonDanger} onPress={onDeleteSource} disabled={deleting} testID="income-source-delete">
            {deleting ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.buttonDangerText}>Supprimer</Text>}
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Prochaine occurrence prévue</Text>
        <DateField label="Date prévue" value={plannedDate} onChange={setPlannedDate} />
        <FormField
          label="Montant prévu (facultatif)"
          placeholder="Reprend le montant habituel"
          keyboardType="decimal-pad"
          value={plannedAmount}
          onChangeText={setPlannedAmount}
        />
        {createError ? <Text style={styles.error}>{createError}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreateOccurrence} disabled={creating}>
          {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Planifier</Text>}
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Occurrences</Text>
        {loading ? (
          <ActivityIndicator />
        ) : occurrences.length === 0 ? (
          <Text style={styles.empty}>Aucune occurrence planifiée pour l'instant.</Text>
        ) : (
          occurrences.map((o) => (
            <View key={o.id} style={styles.card}>
              <Text style={styles.cardTitle}>{formatDate(o.usualDate)}</Text>
              <Text style={styles.cardMeta}>Prévu : {n(o.plannedAmount).toLocaleString('fr-FR')} DH</Text>
              {o.status === 'recu' ? (
                <Text style={styles.received}>
                  Reçu : {n(o.actualAmount).toLocaleString('fr-FR')} DH{o.actualDate ? ` le ${formatDate(o.actualDate)}` : ''}
                </Text>
              ) : (
                <View>
                  <Select
                    testID={`confirm-account-select-${o.id}`}
                    label="Compte à créditer"
                    placeholder="Choisir un compte"
                    value={confirmAccountIds[o.id] ?? o.accountId}
                    onChange={(v) => setConfirmAccountIds((prev) => ({ ...prev, [o.id]: v }))}
                    options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                  />
                  <View style={styles.confirmRow}>
                    <FormField
                      testID={`confirm-amount-${o.id}`}
                      containerStyle={styles.confirmAmountField}
                      placeholder="Montant réel (DH)"
                      keyboardType="decimal-pad"
                      value={actualAmounts[o.id] ?? String(n(o.plannedAmount))}
                      onChangeText={(v) => setActualAmounts((prev) => ({ ...prev, [o.id]: v }))}
                      onFocus={handleFocus}
                    />
                    <TouchableOpacity
                      testID={`confirm-occurrence-${o.id}`}
                      style={styles.buttonSmall}
                      onPress={() => onConfirm(o)}
                      disabled={confirmingId === o.id}
                    >
                      {confirmingId === o.id ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonSmallText}>Reçu</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))
        )}
        {confirmError ? <Text style={styles.error}>{confirmError}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  inactiveBanner: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  inactiveBannerText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.sm, justifyContent: 'space-between' },
  buttonSecondary: { flex: 1, backgroundColor: colors.surfaceActive, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginRight: spacing.sm },
  buttonSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  buttonSmall: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10, marginLeft: spacing.sm, justifyContent: 'center' },
  buttonSmallText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 12 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  received: { fontSize: 12, color: colors.success, marginTop: 6, fontWeight: '600' },
  confirmLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginTop: spacing.sm, marginBottom: 6 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  confirmAmountField: { flex: 1, marginBottom: 0, marginRight: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
