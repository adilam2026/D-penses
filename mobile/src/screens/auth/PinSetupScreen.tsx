import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PinDots, PinPad } from '../../ui/PinPad';
import { CreatePinSteps } from './CreatePinSteps';
import { colors, fontFamily, spacing } from '../../ui/theme';
import { AuthHeader } from './AuthHeader';
import { authStyles, initialOf } from './authStyles';

const CURRENT_MAX_LENGTH = 12;

/**
 * Passage obligatoire au code à 6 chiffres (ancien mot de passe 8/9 chiffres).
 * Utilisateur qui vient de se connecter : création + confirmation. Utilisateur
 * déjà connecté (session existante) : dernière saisie de l'ancien mot de passe
 * d'abord. Le serveur revérifie l'ancien credential et remplace le hash.
 */
export function PinSetupScreen() {
  const { profile, pinSetupNeedsCurrent, setupPin, switchUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [currentConfirmed, setCurrentConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askCurrent = pinSetupNeedsCurrent && !currentConfirmed;

  async function onDone(pin: string) {
    setError(null);
    try {
      await setupPin(pin, pinSetupNeedsCurrent ? current : undefined);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_CREDENTIAL') {
        setCurrent('');
        setCurrentConfirmed(false);
      }
      setError(err instanceof ApiError && err.status < 500 ? err.message : 'Impossible de définir le code. Réessayez.');
    }
  }

  return (
    <ScrollView contentContainerStyle={authStyles.screen} testID="pin-setup-screen">
      <AuthHeader compact />
      {profile?.firstName ? (
        <View style={styles.person}>
          <View style={authStyles.avatarSmall}>
            <Text style={authStyles.avatarSmallText}>{initialOf(profile.firstName)}</Text>
          </View>
          <Text style={styles.personName}>{profile.firstName}</Text>
        </View>
      ) : null}
      {askCurrent ? (
        <View testID="pin-setup-current">
          <View style={[authStyles.card, authStyles.cardCentered]}>
            <Text style={authStyles.prompt}>Saisissez votre mot de passe actuel</Text>
            <PinDots length={Math.max(6, current.length)} filled={current.length} />
            {error ? <Text style={authStyles.error}>{error}</Text> : null}
          </View>
          <View style={authStyles.padArea}>
            <PinPad value={current} onChange={setCurrent} maxLength={CURRENT_MAX_LENGTH} />
          </View>
          <TouchableOpacity
            style={[authStyles.button, current.length < 6 && authStyles.buttonDisabled]}
            disabled={current.length < 6}
            onPress={() => {
              setError(null);
              setCurrentConfirmed(true);
            }}
            testID="pin-setup-current-submit"
          >
            <Text style={authStyles.buttonText}>Valider</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <CreatePinSteps onDone={onDone} error={error} />
      )}
      <View style={authStyles.links}>
        <TouchableOpacity onPress={() => switchUser(null)} testID="pin-setup-switch-user">
          <Text style={authStyles.linkMuted}>Changer d'utilisateur</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  person: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  personName: { fontSize: 20, fontFamily: fontFamily.displayBold, color: colors.textPrimary },
});
