import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { PinDots, PinPad } from '../../ui/PinPad';
import { CreatePinSteps } from './CreatePinSteps';
import { authStyles } from './authStyles';

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
    <ScrollView contentContainerStyle={[authStyles.screen, { flexGrow: 1 }]} testID="pin-setup-screen">
      <Text style={authStyles.brand}>Finance Maison</Text>
      <Text style={authStyles.name}>{profile?.firstName ?? ''}</Text>
      {askCurrent ? (
        <View testID="pin-setup-current">
          <Text style={authStyles.prompt}>Saisissez votre mot de passe actuel</Text>
          <PinDots length={Math.max(6, current.length)} filled={current.length} />
          {error ? <Text style={authStyles.error}>{error}</Text> : null}
          <PinPad value={current} onChange={setCurrent} maxLength={CURRENT_MAX_LENGTH} />
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
