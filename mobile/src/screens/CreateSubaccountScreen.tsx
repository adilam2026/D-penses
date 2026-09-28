import React, { useCallback, useEffect, useState } from 'react';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { FormField } from '../ui/FormField';
import { Select } from '../ui/Select';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

/**
 * Création d'un sous-compte (§5) — l'argent reste physiquement sur le compte
 * bancaire support, Finance Maison l'identifie simplement comme réservé.
 * L'allocation initiale crée une opération OPENING_BALANCE (§4) et respecte
 * l'invariant non-affecté (§6, déjà appliqué côté backend par assertInvariants).
 */
export function CreateSubaccountScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ CreateSubaccount: { accountId?: string } }, 'CreateSubaccount'>>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [accounts, setAccounts] = useState<{ value: string; label: string; sublabel?: string }[]>([]);
  const [accountId, setAccountId] = useState<string | null>(route.params?.accountId ?? null);
  const [name, setName] = useState('');
  const [initialAllocation, setInitialAllocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const list = await api.listAccounts();
    setAccounts(list.map((a) => ({ value: a.id, label: a.name, sublabel: `Non affecté : ${a.nonAffecte} DH` })));
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  function resetForm() {
    setName('');
    setInitialAllocation('');
    setCreatedName(null);
    setError(null);
  }

  async function submit() {
    if (!name.trim() || !accountId || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.createSubaccount({ accountId, name: name.trim(), initialAllocation: initialAllocation.trim() || undefined });
      setCreatedName(name.trim());
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Impossible de créer le sous-compte');
    } finally {
      setSaving(false);
    }
  }

  if (createdName) {
    return (
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.doneCard}>
          <Ionicons name="checkmark-circle" size={40} color={colors.success} />
          <Text style={styles.doneTitle}>Sous-compte « {createdName} » créé</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={resetForm} testID="create-subaccount-add-another">
            <Text style={styles.primaryButtonText}>+ Ajouter un autre sous-compte</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()} testID="create-subaccount-done">
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
      <Text style={styles.title}>Nouveau sous-compte</Text>
      <Text style={styles.intro}>
        Cet argent reste sur votre compte bancaire. Finance Maison l'identifie simplement comme réservé à cet usage.
      </Text>

      <FormField label="Nom" placeholder="ex. Voiture" value={name} onChangeText={setName} onFocus={handleFocus} testID="create-subaccount-name" />
      <Select
        label="Compte bancaire support"
        placeholder="Sélectionner un compte…"
        value={accountId}
        options={accounts}
        onChange={setAccountId}
        testID="create-subaccount-account"
      />
      <FormField
        label="Montant initial affecté (optionnel)"
        placeholder="0"
        value={initialAllocation}
        onChangeText={setInitialAllocation}
        onFocus={handleFocus}
        keyboardType="decimal-pad"
        testID="create-subaccount-allocation"
        helperText="Ne peut pas dépasser le montant non affecté du compte support."
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.primaryButton, (!name.trim() || !accountId || saving) && styles.buttonDisabled]}
        onPress={submit}
        disabled={!name.trim() || !accountId || saving}
        testID="create-subaccount-submit"
      >
        <Text style={styles.primaryButtonText}>{saving ? 'Création…' : 'Créer le sous-compte'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  title: { ...typography.screenTitle, marginBottom: spacing.sm },
  intro: { ...typography.bodySecondary, marginBottom: spacing.lg },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm, fontWeight: '600' },
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  primaryButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.5 },
  secondaryButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  secondaryButtonText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  doneCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  doneTitle: { ...typography.sectionTitle, marginTop: spacing.md, marginBottom: spacing.xl, textAlign: 'center' },
});
