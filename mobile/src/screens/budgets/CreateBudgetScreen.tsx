import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface CreatedBudget {
  categoryName: string;
  amount: number;
  period: 'semaine' | 'mois';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Création d'un budget variable (§12/§17 refonte UX) — pattern CRÉER → VOIR CE QUI
 * EST CRÉÉ → AJOUTER ENCORE ou CONTINUER (comme Comptes/Revenus/Charges), plutôt
 * qu'une modale qui se referme après une seule création.
 */
export function CreateBudgetScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<'semaine' | 'mois'>('semaine');
  const [startDate, setStartDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBudget[]>([]);

  useEffect(() => {
    api
      .listCategories()
      .then((list: Category[]) => setCategories(list.filter((c) => c.kind === 'expense' || c.kind === 'both')))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!categoryId) {
      setError('Choisissez une catégorie');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.createVariableBudget({ categoryId, referenceAmount: numericAmount, referencePeriod: period, startDate });
      const categoryName = categories.find((c) => c.id === categoryId)?.name ?? '';
      setCreated((prev) => [...prev, { categoryName, amount: numericAmount, period }]);
      setCategoryId(null);
      setAmount('');
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
      <Text style={styles.intro}>Fixez une limite pour vos dépenses du quotidien.</Text>

      {created.length > 0 && (
        <View style={styles.createdBox}>
          <Text style={styles.sectionLabel}>Budgets ajoutés</Text>
          {created.map((b, i) => (
            <Text key={i} style={styles.createdLine}>
              {b.categoryName} — {b.amount.toLocaleString('fr-FR')} DH / {b.period === 'semaine' ? 'semaine' : 'mois'}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.sectionLabel}>Catégorie</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        // R5 clôture §6 — sélecteur compact (catégories potentiellement nombreuses), jamais un mur de chips.
        <Select
          testID="create-budget-category-select"
          placeholder="Choisir une catégorie"
          value={categoryId}
          onChange={setCategoryId}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
      )}

      <FormField
        testID="create-budget-amount-input"
        label="Montant"
        placeholder="Montant (DH)"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={setAmount}
        onFocus={handleFocus}
      />

      <Text style={styles.sectionLabel}>Période</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, period === 'semaine' && styles.segmentActive]} onPress={() => setPeriod('semaine')}>
          <Text style={[styles.segmentText, period === 'semaine' && styles.segmentTextActive]}>Semaine</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, period === 'mois' && styles.segmentActive]} onPress={() => setPeriod('mois')}>
          <Text style={[styles.segmentText, period === 'mois' && styles.segmentTextActive]}>Mois</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionLabel}>Date de début</Text>
      <DateField value={startDate} onChange={setStartDate} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting} testID="create-budget-submit">
        {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>{created.length > 0 ? 'Ajouter un autre budget' : 'Créer le budget'}</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.continueButton} onPress={() => navigation.goBack()}>
        <Text style={styles.continueButtonText}>{created.length > 0 ? 'Continuer' : 'Annuler'}</Text>
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: spacing.md },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  createdBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  createdLine: { fontSize: 13, color: colors.textPrimary, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.md },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  continueButton: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xl },
  continueButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
