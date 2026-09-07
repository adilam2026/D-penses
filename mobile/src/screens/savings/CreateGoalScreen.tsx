import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

interface CreatedGoal {
  label: string;
  targetAmount: number;
  targetDate?: string;
}

/**
 * Création d'un objectif (§23/25) — pattern CRÉER → VOIR CE QUI EST CRÉÉ →
 * AJOUTER ENCORE ou CONTINUER (même convention que Budgets/Comptes/Revenus/Charges).
 */
export function CreateGoalScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [label, setLabel] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedGoal[]>([]);

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(targetAmount.replace(',', '.'));
    if (!label.trim()) {
      setError('Nom requis');
      return;
    }
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant cible invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.createGoal({ label: label.trim(), targetAmount: numericAmount, targetDate: targetDate || undefined });
      setCreated((prev) => [...prev, { label: label.trim(), targetAmount: numericAmount, targetDate: targetDate || undefined }]);
      setLabel('');
      setTargetAmount('');
      setTargetDate('');
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouvel objectif</Text>

        {created.length > 0 && (
          <View style={styles.createdBox}>
            <Text style={styles.sectionLabel}>Objectifs ajoutés</Text>
            {created.map((g, i) => (
              <Text key={i} style={styles.createdLine}>
                {g.label} — {g.targetAmount.toLocaleString('fr-FR')} DH{g.targetDate ? ` · ${g.targetDate}` : ''}
              </Text>
            ))}
          </View>
        )}

        <FormField testID="goal-label-input" label="Nom" placeholder="ex. PC" value={label} onChangeText={setLabel} onFocus={handleFocus} />

        <FormField
          testID="goal-target-amount-input"
          label="Montant cible"
          placeholder="15000"
          keyboardType="decimal-pad"
          value={targetAmount}
          onChangeText={setTargetAmount}
          onFocus={handleFocus}
        />

        <Text style={styles.sectionLabel}>Date souhaitée (optionnelle)</Text>
        <DateField value={targetDate} onChange={setTargetDate} placeholder="Aucune date choisie" />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting} testID="create-goal-submit">
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>{created.length > 0 ? 'Ajouter un autre objectif' : 'Créer'}</Text>}
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
  scroll: { padding: spacing.xl, paddingTop: 24 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  createdBox: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  createdLine: { fontSize: 13, color: colors.textPrimary, marginTop: 4 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 4 },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  continueButton: { borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.xl },
  continueButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
