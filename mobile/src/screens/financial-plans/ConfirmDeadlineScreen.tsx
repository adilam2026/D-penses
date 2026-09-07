import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface DeadlineContext {
  chargePlan: { label: string };
  dueDate: string;
  amountCurrent: number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Confirmation de facture (§5) — « Facture reçue » : saisie du montant réel et de
 * la billing_date. amount_initial_estimated est conservé côté serveur (RG-104),
 * jamais recalculé ici. Fonctionne aussi pour un montant jusque-là inconnu (§4/§17).
 *
 * Lot 9 (§20 — audit UX) : affiche QUELLE charge est confirmée (libellé, échéance,
 * montant estimé) avant de demander le montant réel — une action financière ne
 * doit jamais être validée à l'aveugle (§37).
 */
export function ConfirmDeadlineScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const id = route.params?.id as string;
  const [context, setContext] = useState<DeadlineContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDeadline(id)
      .then((d: DeadlineContext) => {
        setContext(d);
        if (d.amountCurrent !== null) setAmount(String(d.amountCurrent));
      })
      .finally(() => setLoadingContext(false));
  }, [id]);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.updateDeadline(id, { amountCurrent: numericAmount, amountStatus: 'confirme', billingDate: todayIso() });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Facture reçue</Text>

        {loadingContext ? (
          <ActivityIndicator style={{ marginBottom: 16 }} />
        ) : context ? (
          <View style={styles.contextCard}>
            <Text style={styles.contextLabel}>{context.chargePlan.label}</Text>
            <Text style={styles.contextLine}>Échéance du {formatDate(context.dueDate)}</Text>
            <Text style={styles.contextLine}>
              {context.amountStatus === 'inconnu' || context.amountCurrent === null
                ? 'Montant jusqu\'ici inconnu'
                : `Montant estimé : ${context.amountCurrent.toLocaleString('fr-FR')} DH`}
            </Text>
          </View>
        ) : null}

        <Text style={styles.subtitle}>Saisissez le montant réel de la facture. L'estimation initiale, si elle existe, est conservée.</Text>

        <FormField placeholder="Montant réel (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} autoFocus onFocus={handleFocus} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Confirmer</Text>}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xxl, paddingTop: 40 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  contextCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  contextLabel: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  contextLine: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
