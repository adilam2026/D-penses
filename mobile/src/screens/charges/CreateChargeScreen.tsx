import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;
const STATUS_LABEL: Record<string, string> = { inconnu: 'Montant inconnu', estime: 'Estimé', confirme: 'Confirmé' };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Recette post-Vague 3 (§2/§3/§7) — écran dédié pour créer une charge récurrente,
 * séparé de la liste (ChargesScreen). Catégorie via sélecteur compact (§2),
 * fréquence via sélecteur compact (§3) — plus de 15-20 chips affichées en
 * permanence. Estimé/Confirmé/Inconnu reste un segmented control (choix court, §2).
 */
export function CreateChargeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [categories, setCategories] = useState<Category[]>([]);

  const [label, setLabel] = useState('');
  const [recurrence, setRecurrence] = useState('mensuel');
  const [dueDate, setDueDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [amountStatus, setAmountStatus] = useState<'estime' | 'confirme' | 'inconnu'>('estime');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      api.listCategories().then((list: Category[]) => setCategories(list.filter((c) => c.kind === 'expense' || c.kind === 'both')));
    }, []),
  );

  async function onCreate() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (amountStatus !== 'inconnu' && (!amount.trim() || Number(amount.replace(',', '.')) <= 0)) {
      setError('Montant invalide');
      return;
    }
    setCreating(true);
    try {
      const plan = await api.createChargePlan({
        label: label.trim(),
        startDate: dueDate,
        recurrenceRule: recurrence === 'ponctuel' ? undefined : recurrence,
        categoryId: categoryId ?? undefined,
      });
      await api.createDeadline(plan.id, {
        dueDate,
        amountStatus,
        amountCurrent: amountStatus !== 'inconnu' ? Number(amount.replace(',', '.')) : undefined,
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
        <Text style={styles.intro}>Ajoutez une dépense que vous connaissez déjà (loyer, internet, école...) afin que l'application puisse l'anticiper.</Text>

        <Text style={styles.label}>Libellé</Text>
        <TextInput style={styles.input} placeholder="Ex. Internet, Loyer, École" value={label} onChangeText={setLabel} onFocus={handleFocus} />

        <Select
          testID="charge-frequency-select"
          label="Fréquence"
          value={recurrence}
          options={frequencyOptions(RECURRENCE_VALUES)}
          onChange={setRecurrence}
        />

        <DateField label="Date d'échéance" value={dueDate} onChange={setDueDate} />

        <Text style={styles.label}>Montant</Text>
        <View style={styles.segment}>
          {(['estime', 'confirme', 'inconnu'] as const).map((s) => (
            <TouchableOpacity key={s} style={[styles.segmentItem, amountStatus === s && styles.segmentActive]} onPress={() => setAmountStatus(s)}>
              <Text style={[styles.segmentText, amountStatus === s && styles.segmentTextActive]}>{STATUS_LABEL[s]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {amountStatus !== 'inconnu' && (
          <TextInput
            style={styles.input}
            placeholder="Montant (DH)"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
            onFocus={handleFocus}
          />
        )}

        {categories.length > 0 && (
          <Select
            testID="charge-category-select"
            label="Catégorie (facultatif)"
            placeholder="Sélectionner une catégorie"
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={creating} testID="create-charge-submit">
          {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Ajouter la charge</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 6 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
  },
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 8 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 12, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
