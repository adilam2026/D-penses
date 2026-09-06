import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { accountCreatedBus } from '../../state/events';

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

        <Text style={styles.sectionLabel}>Nom</Text>
        <TextInput style={styles.input} placeholder="ex. Compte principal" value={name} onChangeText={setName} autoFocus />

        <Text style={styles.sectionLabel}>Solde initial (facultatif)</Text>
        <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={initialBalance} onChangeText={setInitialBalance} />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onCreate} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer le compte</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 40 },
  title: { fontSize: 18, fontWeight: '700', color: '#172436', marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 12, color: '#6B747C', textAlign: 'center', marginBottom: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
