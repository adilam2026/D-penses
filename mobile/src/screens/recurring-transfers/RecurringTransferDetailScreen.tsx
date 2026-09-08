import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { DateField } from '../../ui/DateField';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

interface RecurringTransfer {
  id: string;
  label: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: string | number;
  recurrenceRule: string;
  recurrenceAnchorDate: string;
  note: string | null;
  status: 'actif' | 'inactif';
}

interface AccountTransfer {
  id: string;
  recurringTransferId: string | null;
  status: 'prevu' | 'confirme' | 'annule';
  plannedDate: string;
  actualDate: string | null;
  amount: string | number;
}

interface Account {
  id: string;
  name: string;
}

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel'] as const;

function n(v: string | number): number {
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * R6.2 corrections finales §4/§5 — détail d'un transfert récurrent : édition
 * (libellé/montant/fréquence/prochaine date/comptes/note), "ARRÊTER LA
 * RÉCURRENCE" (status=inactif, jamais une suppression — RecurringTransfersService
 * ne retire QUE les occurrences encore 'prevu' quand la règle change, jamais
 * un transfert déjà confirmé), et confirmation d'une occurrence 'prevu'
 * (débit/crédit réel atomique, réutilise AccountsService.confirmTransfer déjà
 * existant — jamais un second moteur de transfert).
 */
export function RecurringTransferDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const id = route.params?.id as string;

  const [transfer, setTransfer] = useState<RecurringTransfer | null>(null);
  const [occurrences, setOccurrences] = useState<AccountTransfer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState('mensuel');
  const [anchorDate, setAnchorDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, tr, acc] = await Promise.all([api.getRecurringTransfer(id), api.listTransfers(), api.listAccounts()]);
      const rt = t as RecurringTransfer;
      setTransfer(rt);
      setOccurrences((tr as AccountTransfer[]).filter((o) => o.recurringTransferId === id));
      setAccounts(acc as Account[]);
      setLabel(rt.label);
      setFromAccountId(rt.fromAccountId);
      setToAccountId(rt.toAccountId);
      setAmount(String(n(rt.amount)));
      setRecurrenceRule(rt.recurrenceRule);
      setAnchorDate(String(rt.recurrenceAnchorDate).slice(0, 10));
      setNote(rt.note ?? '');
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
    if (!fromAccountId || !toAccountId) {
      setError('Le compte source et le compte destination sont requis');
      return;
    }
    if (fromAccountId === toAccountId) {
      setError('Le compte source et le compte destination doivent être différents');
      return;
    }
    const amountValue = Number(amount.replace(',', '.'));
    if (!amountValue || amountValue <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!anchorDate) {
      setError('La prochaine date de transfert est requise');
      return;
    }
    setSaving(true);
    try {
      // R6.2 corrections finales §4 : une modification ne réécrit jamais les occurrences
      // déjà confirmées — le backend ne retire que les occurrences futures 'prevu'.
      await api.updateRecurringTransfer(id, {
        label: label.trim(),
        fromAccountId,
        toAccountId,
        amount: amountValue,
        recurrenceRule: recurrenceRule as any,
        recurrenceAnchorDate: anchorDate,
        note: note.trim() || undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!transfer) return;
    setError(null);
    setTogglingStatus(true);
    try {
      await api.updateRecurringTransfer(id, { status: transfer.status === 'actif' ? 'inactif' : 'actif' });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Opération impossible');
    } finally {
      setTogglingStatus(false);
    }
  }

  async function onConfirmOccurrence(occurrenceId: string) {
    setError(null);
    setConfirmingId(occurrenceId);
    try {
      await api.confirmTransfer(occurrenceId);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirmingId(null);
    }
  }

  if (loading && !transfer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!transfer) return null;

  const accountName = (accId: string | null) => accounts.find((a) => a.id === accId)?.name ?? '—';
  const upcoming = occurrences.filter((o) => o.status === 'prevu').sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
  const history = occurrences.filter((o) => o.status !== 'prevu').sort((a, b) => b.plannedDate.localeCompare(a.plannedDate));

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        {transfer.status === 'inactif' && (
          <View style={styles.inactiveBanner}>
            <Text style={styles.inactiveBannerText}>Récurrence arrêtée — aucune nouvelle occurrence ne sera générée.</Text>
          </View>
        )}

        <FormField testID="recurring-transfer-label-input" label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} />

        <Select
          testID="recurring-transfer-from-select"
          label="Compte source"
          placeholder="Sélectionner un compte"
          value={fromAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          onChange={setFromAccountId}
        />

        <Select
          testID="recurring-transfer-to-select"
          label="Compte destination"
          placeholder="Sélectionner un compte"
          value={toAccountId}
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          onChange={setToAccountId}
        />

        <FormField
          testID="recurring-transfer-amount-input"
          label="Montant (DH)"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          onFocus={handleFocus}
        />

        <Select
          testID="recurring-transfer-frequency-select"
          label="Fréquence"
          value={recurrenceRule}
          options={frequencyOptions(RECURRENCE_VALUES)}
          onChange={setRecurrenceRule}
        />

        <DateField label="Prochain transfert" value={anchorDate} onChange={setAnchorDate} />

        <FormField testID="recurring-transfer-note-input" label="Note (facultatif)" value={note} onChangeText={setNote} onFocus={handleFocus} />

        <Text style={styles.hint}>
          Une modification ne touche jamais les transferts déjà confirmés — uniquement les prochaines occurrences prévues.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onSave} disabled={saving} testID="recurring-transfer-save">
          {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.buttonSecondary} onPress={onToggleStatus} disabled={togglingStatus} testID="recurring-transfer-toggle-status">
          {togglingStatus ? (
            <ActivityIndicator color={colors.textPrimary} />
          ) : (
            <Text style={styles.buttonSecondaryText}>{transfer.status === 'actif' ? 'ARRÊTER LA RÉCURRENCE' : 'Réactiver'}</Text>
          )}
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Occurrences prévues</Text>
        {upcoming.length === 0 ? (
          <Text style={styles.empty}>Aucune occurrence prévue pour l'instant.</Text>
        ) : (
          upcoming.map((o) => (
            <View key={o.id} testID={`occurrence-row-${o.id}`} style={styles.occurrenceRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.occurrenceDate}>{formatDate(o.plannedDate)}</Text>
                <Text style={styles.occurrenceAmount}>{n(o.amount).toLocaleString('fr-FR')} DH</Text>
              </View>
              <TouchableOpacity
                testID={`confirm-occurrence-${o.id}`}
                style={styles.confirmButton}
                onPress={() => onConfirmOccurrence(o.id)}
                disabled={confirmingId === o.id}
              >
                {confirmingId === o.id ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.confirmButtonText}>Confirmer</Text>}
              </TouchableOpacity>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Historique</Text>
        {history.length === 0 ? (
          <Text style={styles.empty}>Aucun transfert confirmé pour l'instant.</Text>
        ) : (
          history.map((o) => (
            <View key={o.id} testID={`history-row-${o.id}`} style={styles.historyRow}>
              <Text style={styles.occurrenceDate}>{formatDate(o.actualDate ?? o.plannedDate)}</Text>
              <Text style={styles.occurrenceAmount}>{n(o.amount).toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.historyStatus}>{o.status === 'confirme' ? 'Confirmé' : 'Annulé'}</Text>
            </View>
          ))
        )}

        <Text style={styles.footerMeta}>
          {accountName(transfer.fromAccountId)} → {accountName(transfer.toAccountId)}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  inactiveBanner: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  inactiveBannerText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  hint: { fontSize: 11, color: colors.textSecondary, marginTop: -6, marginBottom: spacing.sm, fontStyle: 'italic' },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  buttonSecondary: { backgroundColor: colors.surfaceActive, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  occurrenceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  occurrenceDate: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  occurrenceAmount: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  confirmButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 10 },
  confirmButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 12 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  historyStatus: { fontSize: 11, color: colors.textSecondary, marginLeft: 'auto' },
  footerMeta: { fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
});
