import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { accountCreatedBus } from '../../state/events';
import { colors, radius, spacing } from '../../ui/theme';

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

/** Jour habituel → date d'ancrage du mois courant, clampée (règle jour 29/30/31, Lot 11 §1). */
function anchorDateForDay(day: number): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = Math.min(day, daysInMonth);
  return new Date(Date.UTC(year, month, clamped)).toISOString().slice(0, 10);
}

/**
 * Recette post-Vague 3 (§2/§3/§7) — écran dédié pour créer une source de
 * revenu, séparé de la liste (IncomeScreen). Compte et fréquence via
 * sélecteurs compacts (§2/§3), plus de chips permanentes.
 */
export function CreateIncomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [anchorDay, setAnchorDay] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [accountList, categoryList] = await Promise.all([api.listAccounts(), api.listCategories()]);
    setAccounts(accountList);
    setCategories((categoryList as Category[]).filter((c) => c.kind === 'income' || c.kind === 'both'));
    setAccountId((current) => current ?? accountList[0]?.id ?? null);
    return accountList;
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().then((accountList) => {
        if (accountList && accountList.length === 0) promptCreateAccount();
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  useEffect(() => {
    return accountCreatedBus.on((created) => {
      load().then(() => setAccountId(created.id));
    });
  }, [load]);

  function promptCreateAccount() {
    Alert.alert(
      'Aucun compte configuré',
      "Créez d'abord un compte pour pouvoir y rattacher ce revenu.",
      [
        { text: 'Annuler', style: 'cancel', onPress: () => navigation.goBack() },
        { text: 'Créer un compte', onPress: () => navigation.navigate('QuickCreateAccount') },
      ],
    );
  }

  async function onCreate() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!accountId) {
      promptCreateAccount();
      return;
    }
    const dayNumber = Number(anchorDay);
    if (recurrence !== 'ponctuel' && (!dayNumber || dayNumber < 1 || dayNumber > 31)) {
      setError('Jour habituel invalide (1 à 31)');
      return;
    }
    setCreating(true);
    try {
      await api.createIncomeSource({
        label: label.trim(),
        usualAmount: numericAmount,
        defaultAccountId: accountId,
        isRecurring: recurrence !== 'ponctuel',
        recurrenceRule: recurrence,
        recurrenceAnchorDate: recurrence !== 'ponctuel' ? anchorDateForDay(dayNumber) : undefined,
        categoryId: categoryId ?? undefined,
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>Ajoutez un revenu que vous recevez régulièrement — l'application anticipera automatiquement les prochains versements.</Text>

        <FormField testID="income-label-input" label="Libellé" placeholder="Ex. Salaire" value={label} onChangeText={setLabel} onFocus={handleFocus} />

        <FormField
          testID="income-amount-input"
          label="Montant habituel"
          placeholder="Montant (DH)"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          onFocus={handleFocus}
        />

        <Select testID="income-frequency-select" label="Fréquence" value={recurrence} options={frequencyOptions(RECURRENCE_VALUES)} onChange={setRecurrence} />

        {recurrence !== 'ponctuel' && (
          <FormField
            testID="income-anchor-day-input"
            label="Jour habituel de versement"
            placeholder="1 à 31"
            keyboardType="number-pad"
            maxLength={2}
            value={anchorDay}
            onChangeText={setAnchorDay}
            onFocus={handleFocus}
          />
        )}

        {accounts.length > 0 && (
          <Select
            testID="income-account-select"
            label="Compte"
            placeholder="Sélectionner un compte"
            value={accountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            onChange={setAccountId}
          />
        )}

        {categories.length > 0 && (
          <Select
            testID="income-category-select"
            label="Catégorie (facultatif)"
            placeholder="Sélectionner une catégorie"
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating} testID="create-income-submit">
          {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
