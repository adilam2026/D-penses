import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

const PROJECTION_MODE_LABEL: Record<string, string> = {
  contractuel: 'Contractuel (montant de référence)',
  rythme_reel: 'Rythme réel (déjà dépensé au prorata)',
  prudent_max: 'Prudent (le plus élevé des deux)',
};

/** ☰ Paramètres → Préférences (coussin de sécurité, seuils, mode de projection des budgets). */
export function PreferencesScreen() {
  const bottomInset = useBottomInset();
  const [loading, setLoading] = useState(true);
  const [securityMarginAmount, setSecurityMarginAmount] = useState('0');
  const [seuilAVenirDays, setSeuilAVenirDays] = useState('30');
  const [seuilAPayerDays, setSeuilAPayerDays] = useState('7');
  const [mode, setMode] = useState('prudent_max');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const household = await api.getMyHousehold();
      const s = household.settings;
      if (s) {
        setSecurityMarginAmount(String(s.securityMarginAmount));
        setSeuilAVenirDays(String(s.seuilAVenirDays));
        setSeuilAPayerDays(String(s.seuilAPayerDays));
        setMode(s.variableBudgetProjectionMode);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateHouseholdSettings({
        securityMarginAmount: Number(securityMarginAmount.replace(',', '.')) || 0,
        seuilAVenirDays: Number(seuilAVenirDays) || 0,
        seuilAPayerDays: Number(seuilAPayerDays) || 0,
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <Text style={styles.sectionLabel}>Coussin de sécurité (DH)</Text>
      <Text style={styles.help}>Montant toujours mis de côté avant de calculer votre disponible libre.</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={securityMarginAmount} onChangeText={setSecurityMarginAmount} />

      <Text style={styles.sectionLabel}>Seuil "à venir" (jours)</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={seuilAVenirDays} onChangeText={setSeuilAVenirDays} />

      <Text style={styles.sectionLabel}>Seuil "à payer bientôt" (jours)</Text>
      <TextInput style={styles.input} keyboardType="number-pad" value={seuilAPayerDays} onChangeText={setSeuilAPayerDays} />

      <Text style={styles.sectionLabel}>Mode de projection des budgets variables</Text>
      <Text style={styles.help}>{PROJECTION_MODE_LABEL[mode] ?? mode}</Text>

      {saved ? <Text style={styles.savedText}>Enregistré.</Text> : null}
      <TouchableOpacity style={styles.button} onPress={onSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginTop: 12, marginBottom: 4 },
  help: { fontSize: 11, color: '#6B747C', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1, borderColor: '#E3E1DC' },
  savedText: { color: '#2E7D5B', fontSize: 12, fontWeight: '600', marginTop: 16, textAlign: 'center' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
