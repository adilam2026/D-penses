import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { DateField } from '../../ui/DateField';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

interface OccurrenceDetail {
  id: string;
  usualDate: string;
  plannedAmount: number | string;
  actualAmount: number | string | null;
  actualDate: string | null;
  status: 'prevu' | 'recu';
  accountId: string | null;
  incomeSource: { id: string; label: string };
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

/**
 * Correction UX (Calendrier — occurrence de revenu) : fiche d'UNE occurrence
 * précise. Les actions de gestion de la récurrence (libellé, fréquence,
 * prochain versement, arrêter/supprimer la source) restent uniquement dans
 * IncomeSourceDetailScreen — jamais mélangées ici.
 */
export function IncomeOccurrenceDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occurrenceId = route.params?.id as string;

  const [occurrence, setOccurrence] = useState<OccurrenceDetail | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState<string | null>(null);
  const [actualAmount, setActualAmount] = useState('');
  // Correction UX (date réelle éditable) : pré-remplie avec la date PRÉVUE
  // (occurrence.usualDate), jamais figée sur aujourd'hui — un salaire prévu
  // le 26 mais reçu le 28 doit pouvoir être corrigé avant confirmation.
  const [actualDate, setActualDate] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [o, accs] = await Promise.all([api.getIncomeOccurrence(occurrenceId), api.listAccounts()]);
      setOccurrence(o);
      setAccounts(accs);
      setAccountId(o.accountId ?? null);
      setActualAmount(String(n(o.plannedAmount)));
      setActualDate(o.usualDate.slice(0, 10));
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Occurrence introuvable');
    } finally {
      setLoading(false);
    }
  }, [occurrenceId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onConfirm() {
    if (!occurrence) return;
    setConfirmError(null);
    const value = Number(actualAmount.replace(',', '.'));
    if (!value || value <= 0) {
      setConfirmError('Montant réel invalide');
      return;
    }
    if (!accountId) {
      setConfirmError('Choisissez un compte à créditer');
      return;
    }
    if (!actualDate) {
      setConfirmError('La date de réception est requise');
      return;
    }
    setConfirming(true);
    try {
      await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: value, actualDate, accountId });
      await load();
    } catch (err) {
      setConfirmError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirming(false);
    }
  }

  function onCancel() {
    if (!occurrence) return;
    Alert.alert('Annuler ce revenu ?', 'Cette occurrence redevient "prévue" — vous pourrez la reconfirmer avec les bonnes valeurs.', [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Confirmer',
        style: 'destructive',
        onPress: async () => {
          setCancelling(true);
          setConfirmError(null);
          try {
            await api.unconfirmIncomeOccurrence(occurrence.id);
            await load();
          } catch (err) {
            setConfirmError(err instanceof api.ApiError ? err.message : 'Annulation impossible');
          } finally {
            setCancelling(false);
          }
        },
      },
    ]);
  }

  if (loading && !occurrence) {
    return (
      <View style={styles.center} testID="income-occurrence-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !occurrence) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Occurrence introuvable'}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>{occurrence.incomeSource.label}</Text>
          <Text style={styles.heroAmount}>{n(occurrence.plannedAmount).toLocaleString('fr-FR')} DH</Text>
          <View style={[styles.statusBadge, occurrence.status === 'recu' ? styles.statusBadgeReceived : styles.statusBadgePrevu]}>
            <Text style={[styles.statusBadgeText, occurrence.status === 'recu' ? styles.statusBadgeTextReceived : styles.statusBadgeTextPrevu]}>
              {occurrence.status === 'recu' ? 'Reçu' : 'Prévu'}
            </Text>
          </View>
        </View>

        <View style={styles.fieldsCard}>
          <Row label="Date prévue" value={formatDate(occurrence.usualDate)} />
          <Row label="Montant prévu" value={`${n(occurrence.plannedAmount).toLocaleString('fr-FR')} DH`} />
          {occurrence.status === 'recu' && (
            <>
              <Row label="Montant reçu" value={`${n(occurrence.actualAmount).toLocaleString('fr-FR')} DH`} />
              {occurrence.actualDate && <Row label="Reçu le" value={formatDate(occurrence.actualDate)} />}
              <Row label="Compte crédité" value={accounts.find((a) => a.id === occurrence.accountId)?.name ?? '—'} />
            </>
          )}
        </View>

        {occurrence.status === 'prevu' && (
          <View style={styles.fieldsCard}>
            <Select
              testID="income-occurrence-account-select"
              label="Compte à créditer"
              placeholder="Choisir un compte"
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
            <FormField
              testID="income-occurrence-amount-input"
              label="Montant réel"
              keyboardType="decimal-pad"
              value={actualAmount}
              onChangeText={setActualAmount}
              onFocus={handleFocus}
            />
            <DateField label="Date de réception" value={actualDate} onChange={setActualDate} />
          </View>
        )}

        {confirmError ? <Text style={styles.error}>{confirmError}</Text> : null}

        <View style={styles.actionsCard}>
          {occurrence.status === 'prevu' ? (
            <TouchableOpacity testID="income-occurrence-confirm" style={styles.button} onPress={onConfirm} disabled={confirming}>
              {confirming ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Reçu</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity testID="income-occurrence-cancel" style={styles.buttonDanger} onPress={onCancel} disabled={cancelling}>
              {cancelling ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.buttonDangerText}>Annuler</Text>}
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
  heroCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, marginBottom: spacing.lg },
  heroLabel: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  heroAmount: { fontSize: 26, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm },
  statusBadge: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginTop: spacing.sm },
  statusBadgePrevu: { backgroundColor: colors.surfaceActive },
  statusBadgeReceived: { backgroundColor: colors.successLight },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  statusBadgeTextPrevu: { color: colors.textSecondary },
  statusBadgeTextReceived: { color: colors.success },
  fieldsCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 13, color: colors.textSecondary },
  rowValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  actionsCard: { marginTop: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  buttonDanger: { backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: colors.danger, fontWeight: '600', fontSize: 14 },
});
