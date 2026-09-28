import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';

/**
 * Application → Réinitialiser les données (§17) — action dangereuse à double
 * confirmation explicite : l'utilisateur doit d'abord comprendre ce qui sera
 * supprimé, puis retaper le nom exact du foyer pour débloquer le bouton final.
 * NE fait jamais un DROP DATABASE : uniquement les données métier du foyer
 * (backend households.reset()) — User/Session/auth ne sont jamais touchés.
 */
export function ResetDataScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [household, setHousehold] = useState<{ name: string } | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [step, setStep] = useState<'explain' | 'confirm'>('explain');
  const [resetting, setResetting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    api.getMyHousehold().then((h) => setHousehold({ name: h.name }));
  }, []);

  async function confirmReset() {
    if (!household || confirmText.trim() !== household.name || resetting) return;
    setResetting(true);
    setError(null);
    try {
      await api.resetHouseholdData();
      setDone(true);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Impossible de réinitialiser les données');
    } finally {
      setResetting(false);
    }
  }

  if (done) {
    return (
      <View style={[styles.container, { paddingTop: topInset }]}>
        <View style={styles.doneCard}>
          <Ionicons name="checkmark-circle" size={40} color={colors.success} />
          <Text style={styles.doneTitle}>Données réinitialisées</Text>
          <Text style={styles.doneText}>Votre foyer et votre compte restent intacts. Vous pouvez recommencer à ajouter vos comptes.</Text>
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.navigate('Tabs')} testID="reset-data-done">
            <Text style={styles.primaryButtonText}>Retour à l'accueil</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView ref={scrollRef} style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Réinitialiser les données</Text>
      </View>

      <View style={styles.warningCard}>
        <Ionicons name="warning-outline" size={28} color={colors.danger} />
        <Text style={styles.warningTitle}>Cette action supprimera les données financières de votre foyer.</Text>
        <Text style={styles.warningText}>Elle ne peut pas être annulée.</Text>
      </View>

      <Text style={styles.sectionLabel}>SERA SUPPRIMÉ</Text>
      <View style={styles.card}>
        {['Comptes et sous-comptes', 'Toutes les transactions et l\'historique', 'Catégories personnalisées', 'Plans financiers et échéances', 'Dossiers santé / mutuelle'].map((line) => (
          <Text key={line} style={styles.listItem}>
            •  {line}
          </Text>
        ))}
      </View>

      <Text style={styles.sectionLabel}>NE SERA JAMAIS SUPPRIMÉ</Text>
      <View style={styles.card}>
        {['Votre compte utilisateur et votre mot de passe', 'Votre foyer et ses membres'].map((line) => (
          <Text key={line} style={styles.listItem}>
            •  {line}
          </Text>
        ))}
      </View>

      {step === 'explain' ? (
        <TouchableOpacity style={styles.dangerButton} onPress={() => setStep('confirm')} testID="reset-data-continue">
          <Text style={styles.dangerButtonText}>Continuer</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Text style={styles.confirmLabel}>Pour confirmer, tapez le nom exact de votre foyer{household ? ` (« ${household.name} »)` : ''} :</Text>
          <TextInput
            style={styles.confirmInput}
            value={confirmText}
            onChangeText={setConfirmText}
            onFocus={handleFocus}
            autoCapitalize="none"
            testID="reset-data-confirm-input"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.dangerButton, (!household || confirmText.trim() !== household.name || resetting) && styles.buttonDisabled]}
            onPress={confirmReset}
            disabled={!household || confirmText.trim() !== household.name || resetting}
            testID="reset-data-confirm"
          >
            {resetting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.dangerButtonText}>Oui, tout réinitialiser</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  title: { ...typography.screenTitle, flex: 1 },
  warningCard: { backgroundColor: colors.dangerLight, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center', marginBottom: spacing.lg },
  warningTitle: { ...typography.body, fontWeight: '700', color: colors.danger, textAlign: 'center', marginTop: spacing.sm },
  warningText: { ...typography.bodySecondary, color: colors.danger, textAlign: 'center', marginTop: spacing.xs },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.lg },
  listItem: { ...typography.body, marginBottom: spacing.xs },
  confirmLabel: { ...typography.body, marginBottom: spacing.sm },
  confirmInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm, fontWeight: '600' },
  dangerButton: { backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  dangerButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  buttonDisabled: { opacity: 0.5 },
  primaryButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, paddingHorizontal: spacing.xl, alignItems: 'center', marginTop: spacing.xl, ...elevation.button },
  primaryButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  doneCard: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  doneTitle: { ...typography.sectionTitle, marginTop: spacing.md, textAlign: 'center' },
  doneText: { ...typography.bodySecondary, marginTop: spacing.sm, textAlign: 'center' },
});
