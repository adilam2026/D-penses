import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormContainer } from '../../ui/FormLayout';
import { Select } from '../../ui/Select';
import { DateField } from '../../ui/DateField';
import { formatDh } from '../../ui/formatMoney';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Refonte maquette V6B §11 — formulaire minimal de clôture : montant reçu,
 * date, compte bénéficiaire, affectation optionnelle à une enveloppe. Le
 * calcul du reste à charge (engagé - reçu) et le statut final sont produits
 * par MedicalClaimsService.close côté backend (jamais dupliqués ici).
 */
export function CloseMedicalClaimScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { id } = route.params as { id: string };
  const top = useTopInset();
  const bottom = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [claim, setClaim] = useState<api.MedicalClaim | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [pockets, setPockets] = useState<any[]>([]);
  const [amountReceived, setAmountReceived] = useState('');
  const [date, setDate] = useState(todayIso());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [pocketId, setPocketId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, accountList, pocketList] = await Promise.all([api.getMedicalClaim(id), api.listAccounts(), api.listPockets()]);
    setClaim(c);
    setAccounts(accountList);
    setPockets(pocketList);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const onSubmit = async () => {
    if (!claim || !accountId) return;
    const numeric = Number(amountReceived.replace(',', '.'));
    if (!numeric || numeric <= 0) {
      setError('Montant reçu invalide.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.closeMedicalClaim(claim.id, {
        amountReceived: numeric,
        reimbursementDate: date,
        reimbursementAccountId: accountId,
        allocatedSavingsPocketId: pocketId ?? undefined,
      });
      navigation.goBack();
    } catch (e: any) {
      setError(e?.message ?? 'Impossible de clôturer le dossier.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!claim) return null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.back}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Clôturer le remboursement</Text>

        <FormContainer style={styles.form}>
          <Field label="Dossier">
            <Text style={styles.readonly}>{claim.label}</Text>
          </Field>
          <Field label="Montant engagé">
            <Text style={styles.readonly}>{formatDh(claim.amountEngaged)}</Text>
          </Field>
          <Field label="Montant reçu">
            <TextInput
              testID="close-claim-amount"
              style={styles.input}
              keyboardType="decimal-pad"
              value={amountReceived}
              onChangeText={setAmountReceived}
              onFocus={handleFocus}
              placeholder="Ex. 420"
              placeholderTextColor={colors.v6Muted}
            />
          </Field>
          <Field label="Date">
            <DateField value={date} onChange={setDate} />
          </Field>
          <Field label="Compte bénéficiaire">
            <Select
              testID="close-claim-account"
              value={accountId}
              onChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              placeholder="Sélectionner un compte"
            />
          </Field>
          <Field label="Affectation (facultatif)">
            <Select
              testID="close-claim-pocket"
              value={pocketId}
              onChange={setPocketId}
              options={pockets.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Aucune affectation"
            />
          </Field>

          {error && <Text style={styles.error}>{error}</Text>}

          <TouchableOpacity
            testID="close-claim-submit"
            style={[styles.submitButton, (!accountId || submitting) && styles.submitDisabled]}
            disabled={!accountId || submitting}
            onPress={onSubmit}
          >
            <Text style={styles.submitText}>Valider</Text>
          </TouchableOpacity>
        </FormContainer>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  back: { color: colors.v6Blue, fontWeight: '800', marginBottom: spacing.md },
  title: { fontSize: 20, fontWeight: '800', color: colors.v6Text, marginBottom: spacing.lg },
  form: { gap: spacing.md },
  field: {},
  fieldLabel: { fontSize: 11, color: colors.v6Muted, marginBottom: spacing.xs + 1, fontWeight: '600' },
  readonly: { fontSize: 14, color: colors.v6Text, paddingVertical: spacing.sm },
  input: { borderWidth: 1, borderColor: colors.v6Line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, color: colors.v6Text, backgroundColor: colors.v6Surface },
  error: { color: colors.v6Red, fontSize: 12 },
  submitButton: { backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.card },
  submitDisabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
