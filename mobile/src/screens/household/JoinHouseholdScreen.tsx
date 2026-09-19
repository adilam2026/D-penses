import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import * as api from '../../api/client';
import { ApiError } from '../../api/client';
import { FormField } from '../../ui/FormField';
import { useBottomInset } from '../../ui/useBottomInset';
import { colors, radius, spacing } from '../../ui/theme';

type Membership = { householdId: string; name: string; role: string; isActive: boolean };

/**
 * Corrections consolidées §16/§17 — deux concepts distincts, jamais mélangés :
 *  - "Vos foyers" : changer de foyer ACTIF parmi les memberships EXISTANTS,
 *    sans jamais redemander de code d'invitation (switchActiveHousehold).
 *  - "Rejoindre un nouveau foyer" : ajoute un NOUVEAU membership via un code
 *    d'invitation (joinHousehold, comportement §16 inchangé) — reste
 *    atteignable à tout moment depuis le menu ☰, même une fois connecté avec
 *    un foyer déjà actif, sans déconnexion forcée ni redémarrage de
 *    l'onboarding. Les deux actions bascule le foyer actif — toujours
 *    confirmées explicitement avant l'appel réseau.
 */
export function JoinHouseholdScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { joinHousehold, switchActiveHousehold } = useAuth();
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    // Échec silencieux volontaire : cette liste est un raccourci pratique, jamais un
    // prérequis — la fonctionnalité "Rejoindre un nouveau foyer" ci-dessous reste
    // utilisable même si cet appel échoue.
    api.listHouseholdMemberships().then(setMemberships).catch(() => {});
  }, []);

  async function doSwitch(householdId: string) {
    setSwitchError(null);
    setSwitchingId(householdId);
    try {
      await switchActiveHousehold(householdId);
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    } catch (err) {
      setSwitchError(err instanceof ApiError ? err.message : 'Changement de foyer impossible');
    } finally {
      setSwitchingId(null);
    }
  }

  function onSwitchPress(m: Membership) {
    Alert.alert(
      `Passer sur « ${m.name} » ?`,
      'Ce foyer devient votre foyer actif. Vos données actuelles restent intactes et consultables en revenant sur ce foyer à tout moment.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Changer', onPress: () => doSwitch(m.householdId) },
      ],
    );
  }

  async function doJoin() {
    setError(null);
    setJoining(true);
    try {
      await joinHousehold(code.trim());
      // Rafraîchissement des données post-jonction (§16) : repartir de l'Accueil
      // force le useFocusEffect de chaque écran à recharger depuis le nouveau
      // foyer actif, jamais un cache de l'ancien foyer laissé affiché.
      navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Code invalide ou expiré');
    } finally {
      setJoining(false);
    }
  }

  function onSubmit() {
    if (!code.trim()) {
      setError('Un code d\'invitation est requis');
      return;
    }
    Alert.alert(
      'Rejoindre ce foyer ?',
      'Le foyer que vous rejoignez devient votre foyer actif. Vos données actuelles restent intactes et consultables en rejoignant ce foyer à nouveau plus tard.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Rejoindre', onPress: doJoin },
      ],
    );
  }

  // N'affiche la section "Vos foyers" que s'il y a réellement un choix à faire
  // (≥2 memberships) — jamais un bloc vide ou redondant pour le cas courant
  // (un seul foyer) où seul "Rejoindre un nouveau foyer" a du sens.
  const showSwitcher = memberships.length > 1;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        {showSwitcher && (
          <View style={styles.section} testID="household-switcher-section">
            <Text style={styles.sectionTitle}>Vos foyers</Text>
            <Text style={styles.intro}>Passez d'un foyer à l'autre sans code d'invitation — vos données restent séparées et intactes.</Text>
            {memberships.map((m) => (
              <TouchableOpacity
                key={m.householdId}
                testID={`household-switch-row-${m.householdId}`}
                style={[styles.membershipRow, m.isActive && styles.membershipRowActive]}
                disabled={m.isActive || switchingId !== null}
                onPress={() => onSwitchPress(m)}
              >
                <Text style={styles.membershipName}>{m.name}</Text>
                {m.isActive ? (
                  <Text style={styles.membershipActiveBadge}>Actif</Text>
                ) : switchingId === m.householdId ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Text style={styles.membershipSwitchLink}>Changer →</Text>
                )}
              </TouchableOpacity>
            ))}
            {switchError ? <Text style={styles.error}>{switchError}</Text> : null}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rejoindre un nouveau foyer</Text>
          <Text style={styles.intro}>
            Saisissez le code d'invitation partagé par un membre du foyer que vous souhaitez rejoindre.
          </Text>
          <FormField
            testID="join-household-code-input"
            label="Code d'invitation"
            placeholder="Ex. ABC123"
            autoCapitalize="characters"
            value={code}
            onChangeText={setCode}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity testID="join-household-submit" style={styles.button} onPress={onSubmit} disabled={joining}>
            {joining ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Rejoindre</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xs },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  membershipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  membershipRowActive: { borderColor: colors.primary, backgroundColor: colors.surfaceActive },
  membershipName: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  membershipActiveBadge: { fontSize: 11, fontWeight: '700', color: colors.primary },
  membershipSwitchLink: { fontSize: 12, fontWeight: '600', color: colors.primary },
});
