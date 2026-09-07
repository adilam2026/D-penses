import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { accountCreatedBus } from '../../state/events';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

type AccountType = 'courant' | 'especes' | 'epargne' | 'autre';

const TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Banque',
  especes: 'Espèces',
  epargne: 'Épargne',
  autre: 'Autre',
};

/**
 * Création de compte accessible depuis n'importe quel formulaire bloqué par
 * un prérequis manquant (§7 refonte UX) — mêmes champs que AccountsScreen,
 * mêmes API, jamais un système parallèle. Émet accountCreatedBus puis revient
 * automatiquement à l'écran d'origine, qui recharge et présélectionne.
 */
export function QuickCreateAccountScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('courant');
  const [initialBalance, setInitialBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Nom requis');
      return;
    }
    setSubmitting(true);
    try {
      const balance = initialBalance.trim() ? Number(initialBalance.replace(',', '.')) : 0;
      const account = await api.createAccount({ name: name.trim(), type, initialBalance: balance });
      accountCreatedBus.emit({ id: account.id, name: account.name, type });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouveau compte</Text>
        <Text style={styles.subtitle}>Créez d'abord un compte — vous reviendrez ensuite exactement où vous étiez.</Text>

        <Text style={styles.sectionLabel}>Type</Text>
        <View style={styles.chipRow}>
          {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)}>
              <Text style={[styles.chipText, type === t && styles.chipTextActive]}>{TYPE_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <FormField testID="quickcreate-account-name-input" label="Nom" placeholder="ex. Compte principal" value={name} onChangeText={setName} autoFocus />

        <FormField
          testID="quickcreate-account-balance-input"
          label="Solde initial (facultatif)"
          placeholder="Montant (DH)"
          keyboardType="decimal-pad"
          value={initialBalance}
          onChangeText={setInitialBalance}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={submitting} testID="quickcreate-account-submit">
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Créer le compte</Text>}
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
  scroll: { padding: spacing.xl, paddingTop: 40 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.sm, textAlign: 'center' },
  subtitle: { fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md, fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
