import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

/**
 * ☰ Paramètres → Réinitialiser mes données financières (§24). Action sensible :
 * explique ce qui est supprimé/conservé, exige mot de passe + confirmation
 * explicite. Le backend applique tout dans une seule transaction atomique
 * (rien n'est jamais recalculé ici, uniquement affiché).
 */
export function ResetFinancialDataScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onReset() {
    setError(null);
    if (!password) {
      setError('Votre mot de passe est requis');
      return;
    }
    if (!confirmed) {
      setError('Confirmez explicitement avant de continuer');
      return;
    }
    setSubmitting(true);
    try {
      await api.resetFinancialData({ password, confirm: true });
      navigation.navigate('Tabs', { screen: 'Accueil' });
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Réinitialisation impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <Text style={styles.warningTitle}>⚠ Action sensible</Text>
      <Text style={styles.text}>Cette action supprime définitivement :</Text>
      <Text style={styles.bullet}>• Vos comptes et leur historique</Text>
      <Text style={styles.bullet}>• Vos revenus et charges récurrentes</Text>
      <Text style={styles.bullet}>• Vos budgets, plans financiers et enveloppes</Text>
      <Text style={styles.bullet}>• Vos objectifs d'épargne</Text>

      <Text style={[styles.text, { marginTop: 16 }]}>Elle CONSERVE :</Text>
      <Text style={styles.bullet}>• Votre compte et votre foyer</Text>
      <Text style={styles.bullet}>• Les membres du foyer et les enfants</Text>
      <Text style={styles.bullet}>• Vos catégories et types de dépenses</Text>
      <Text style={styles.bullet}>• Vos préférences (coussin de sécurité, seuils)</Text>

      <Text style={styles.sectionLabel}>Mot de passe</Text>
      <TextInput style={styles.input} placeholder="Votre mot de passe" secureTextEntry value={password} onChangeText={setPassword} />

      <View style={styles.confirmRow}>
        <Switch value={confirmed} onValueChange={setConfirmed} />
        <Text style={styles.confirmText}>Je comprends que cette action est irréversible</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onReset} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Réinitialiser mes données financières</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  warningTitle: { fontSize: 16, fontWeight: '700', color: '#B3261E', marginBottom: 12 },
  text: { fontSize: 13, color: '#172436', fontWeight: '600' },
  bullet: { fontSize: 13, color: '#6B747C', marginTop: 4, marginLeft: 8 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginTop: 20, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#E3E1DC' },
  confirmRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  confirmText: { flex: 1, marginLeft: 10, fontSize: 12, color: '#172436' },
  error: { color: '#B3261E', fontSize: 13, marginTop: 12 },
  button: { backgroundColor: '#B3261E', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14, textAlign: 'center' },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13, marginBottom: 24 },
});
