import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../../ui/useBottomInset';
import * as api from '../../api/client';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { colors, radius, spacing } from '../../ui/theme';

interface Account {
  id: string;
  name: string;
}

interface Child {
  id: string;
  firstName: string;
}

/**
 * Création d'une enveloppe — SavingsPocket ou Provision (§9/§28, vocabulaire unifié
 * Vague 2 §11). backed_by_account exige un compte dédié existant — jamais un montant
 * qui apparaîtrait par magie (RG-074/H-15) : l'utilisateur crée d'abord le compte
 * (écran Comptes) puis le lie ici. La nature (Réservation/Épargne) reste un choix
 * secondaire au sein d'un même écran "Nouvelle enveloppe", jamais deux écrans distincts.
 */
export function CreatePocketScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [kind, setKind] = useState<'pocket' | 'provision'>((route.params?.kind as 'pocket' | 'provision') ?? 'pocket');

  const [name, setName] = useState('');
  const [allocationMode, setAllocationMode] = useState<'virtual_allocation' | 'backed_by_account'>('virtual_allocation');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [targetAmount, setTargetAmount] = useState('');
  const [children, setChildren] = useState<Child[]>([]);
  const [beneficiaryChildId, setBeneficiaryChildId] = useState<string | null>(null);
  const [hasRecurringContribution, setHasRecurringContribution] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listAccounts().then(setAccounts);
    if (kind === 'pocket') api.listChildren().then(setChildren);
  }, [kind]);

  async function onSubmit() {
    setError(null);
    if (!name.trim()) {
      setError('Nom requis');
      return;
    }
    if (allocationMode === 'backed_by_account' && !linkedAccountId) {
      setError('Choisissez le compte dédié');
      return;
    }
    setSubmitting(true);
    try {
      if (kind === 'provision') {
        await api.createProvision({ name: name.trim(), allocationMode, linkedAccountId: linkedAccountId ?? undefined });
      } else {
        await api.createPocket({
          name: name.trim(),
          allocationMode,
          linkedAccountId: linkedAccountId ?? undefined,
          targetAmount: targetAmount ? Number(targetAmount.replace(',', '.')) : undefined,
          beneficiaryChildId: beneficiaryChildId ?? undefined,
          hasRecurringContribution: beneficiaryChildId ? hasRecurringContribution : undefined,
        });
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Nouvelle enveloppe</Text>
      <Text style={styles.intro}>Une enveloppe réserve une partie de votre argent pour un usage précis.</Text>

      <Text style={styles.sectionLabel}>Nature</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, kind === 'pocket' && styles.segmentActive]} onPress={() => setKind('pocket')}>
          <Text style={[styles.segmentText, kind === 'pocket' && styles.segmentTextActive]}>Épargne</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, kind === 'provision' && styles.segmentActive]} onPress={() => setKind('provision')}>
          <Text style={[styles.segmentText, kind === 'provision' && styles.segmentTextActive]}>Réservation</Text>
        </TouchableOpacity>
      </View>

      <FormField
        testID="pocket-name-input"
        label="Nom"
        placeholder="ex. École, Voyage, Épargne enfants"
        value={name}
        onChangeText={setName}
        onFocus={handleFocus}
      />

      <Text style={styles.sectionLabel}>Où se trouve cet argent ?</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, allocationMode === 'virtual_allocation' && styles.segmentActive]} onPress={() => setAllocationMode('virtual_allocation')}>
          <Text style={[styles.segmentText, allocationMode === 'virtual_allocation' && styles.segmentTextActive]}>Réservation sur ma trésorerie</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, allocationMode === 'backed_by_account' && styles.segmentActive]} onPress={() => setAllocationMode('backed_by_account')}>
          <Text style={[styles.segmentText, allocationMode === 'backed_by_account' && styles.segmentTextActive]}>Compte entièrement dédié</Text>
        </TouchableOpacity>
      </View>
      {allocationMode === 'virtual_allocation' ? (
        <>
          <Text style={styles.help}>
            Cette somme reste sur votre trésorerie globale mais n'est plus considérée comme disponible. Vous pouvez
            indiquer, à titre indicatif, sur quel compte elle se trouve réellement — le compte garde son solde entier,
            aucun montant n'y est réellement isolé.
          </Text>
          <Select
            testID="pocket-linked-account-select"
            placeholder="Compte (facultatif, à titre indicatif)"
            value={linkedAccountId}
            onChange={setLinkedAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </>
      ) : (
        <>
          <Text style={styles.help}>
            Attention : ce compte devient ENTIÈREMENT cette enveloppe — tout son solde compte comme réservé, jamais
            partagé avec un autre usage. Pour réserver seulement une partie d'un compte existant, choisissez plutôt
            « Réservation sur ma trésorerie » ci-dessus.
          </Text>
          <Select
            testID="pocket-backed-account-select"
            placeholder="Choisir le compte dédié"
            value={linkedAccountId}
            onChange={setLinkedAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </>
      )}

      {kind === 'pocket' && (
        <>
          <FormField
            testID="pocket-target-amount-input"
            label="Montant cible (optionnel)"
            placeholder="Montant (DH)"
            keyboardType="decimal-pad"
            value={targetAmount}
            onChangeText={setTargetAmount}
            onFocus={handleFocus}
          />

          <Select
            testID="pocket-beneficiary-select"
            label="Bénéficiaire (optionnel)"
            placeholder="Choisir un enfant"
            value={beneficiaryChildId}
            onChange={(v) => setBeneficiaryChildId(beneficiaryChildId === v ? null : v)}
            options={children.map((c) => ({ value: c.id, label: c.firstName }))}
          />
          {beneficiaryChildId && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Versement récurrent déclaré (protège cette épargne, RG-047)</Text>
              <Switch value={hasRecurringContribution} onValueChange={setHasRecurringContribution} />
            </View>
          )}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Créer</Text>}
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
  scroll: { padding: spacing.xxl, paddingTop: spacing.lg },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  intro: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  help: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.md, fontStyle: 'italic' },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.sm },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  switchLabel: { fontSize: 12, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.xxl },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
