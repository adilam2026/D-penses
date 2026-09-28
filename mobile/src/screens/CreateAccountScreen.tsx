import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { FormField } from '../ui/FormField';
import { Select } from '../ui/Select';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'COURANT', label: 'Courant' },
  { value: 'EPARGNE', label: 'Épargne' },
  { value: 'ESPECES', label: 'Espèces' },
  { value: 'AUTRE', label: 'Autre' },
];

/**
 * Création d'un compte (§3) — Nom/Banque/Propriétaire/Type/Solde actuel, puis
 * choix explicite "+ Ajouter un autre compte" / "Terminer". Le solde actuel
 * n'est jamais une colonne de vérité (§4) : il crée une opération
 * OPENING_BALANCE côté backend (déjà le comportement de createAccount()).
 */
export function CreateAccountScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [name, setName] = useState('');
  const [bank, setBank] = useState('');
  const [type, setType] = useState('COURANT');
  const [openingBalance, setOpeningBalance] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  function resetForm() {
    setName('');
    setBank('');
    setType('COURANT');
    setOpeningBalance('');
    setCreatedName(null);
    setError(null);
  }

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAccount({
        name: name.trim(),
        bank: bank.trim() || undefined,
        type,
        openingBalance: openingBalance.trim() || undefined,
      });
      setCreatedName(name.trim());
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Impossible de créer le compte');
    } finally {
      setSaving(false);
    }
  }

  if (createdName) {
    return (
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.doneCard}>
          <Ionicons name="checkmark-circle" size={40} color={colors.success} />
          <Text style={styles.doneTitle}>Compte « {createdName} » créé</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={resetForm} testID="create-account-add-another">
            <Text style={styles.primaryButtonText}>+ Ajouter un autre compte</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.goBack()}
            testID="create-account-done"
          >
            <Text style={styles.secondaryButtonText}>Terminer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={styles.backLabel}>Retour</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.title}>Nouveau compte</Text>

      <FormField label="Nom du compte" placeholder="ex. CIH Courant" value={name} onChangeText={setName} onFocus={handleFocus} testID="create-account-name" />
      <FormField label="Banque (optionnel)" placeholder="ex. CIH Bank" value={bank} onChangeText={setBank} onFocus={handleFocus} testID="create-account-bank" />
      <Select label="Type" value={type} options={ACCOUNT_TYPE_OPTIONS} onChange={setType} testID="create-account-type" />
      <FormField
        label="Solde actuel (optionnel)"
        placeholder="0"
        value={openingBalance}
        onChangeText={setOpeningBalance}
        onFocus={handleFocus}
        keyboardType="decimal-pad"
        testID="create-account-opening-balance"
        helperText="Le solde de départ crée automatiquement une opération d'ouverture — il n'est jamais modifiable directement ensuite."
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryButton, (!name.trim() || saving) && styles.buttonDisabled]}
        onPress={submit}
        disabled={!name.trim() || saving}
        testID="create-account-submit"
      >
        <Text style={styles.primaryButtonText}>{saving ? 'Création…' : 'Créer le compte'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  title: { ...typography.screenTitle, marginBottom: spacing.lg },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm, fontWeight: '600' },
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  primaryButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  secondaryButtonText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  doneCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  doneTitle: { ...typography.sectionTitle, marginTop: spacing.md, marginBottom: spacing.xl, textAlign: 'center' },
});
