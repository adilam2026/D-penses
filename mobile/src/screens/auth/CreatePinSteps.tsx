import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PinDots, PinPad } from '../../ui/PinPad';
import { isTrivialPin, PIN_LENGTH } from '../../auth/pinRules';
import { colors, spacing, typography } from '../../ui/theme';
import { authStyles } from './authStyles';

/**
 * « Créez votre code à 6 chiffres » puis « Confirmez votre code » : les deux
 * saisies doivent correspondre, sinon on recommence. Le code n'existe qu'en
 * mémoire le temps de l'envoyer (onDone).
 */
export function CreatePinSteps({ onDone, error: externalError }: { onDone: (pin: string) => Promise<void>; error?: string | null }) {
  const [step, setStep] = useState<'create' | 'confirm'>('create');
  const [first, setFirst] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(next: string) {
    setValue(next);
    if (next.length < PIN_LENGTH) return;
    if (step === 'create') {
      if (isTrivialPin(next)) {
        setError('Ce code est trop simple — évitez les chiffres identiques ou qui se suivent');
        setValue('');
        return;
      }
      setFirst(next);
      setValue('');
      setError(null);
      setStep('confirm');
      return;
    }
    if (next !== first) {
      setError('Les deux codes ne correspondent pas. Recommencez.');
      setFirst('');
      setValue('');
      setStep('create');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onDone(next);
    } finally {
      setFirst('');
      setValue('');
      setStep('create');
      setBusy(false);
    }
  }

  const shownError = error ?? externalError ?? null;
  return (
    <View testID={`create-pin-${step}`}>
      <Text style={authStyles.prompt}>{step === 'create' ? 'Créez votre code à 6 chiffres' : 'Confirmez votre code'}</Text>
      <PinDots length={PIN_LENGTH} filled={value.length} />
      {shownError ? (
        <Text style={authStyles.error} testID="create-pin-error">
          {shownError}
        </Text>
      ) : null}
      {busy ? <ActivityIndicator style={styles.busy} color={colors.primary} /> : <PinPad value={value} onChange={onChange} maxLength={PIN_LENGTH} />}
    </View>
  );
}

const styles = StyleSheet.create({
  busy: { marginVertical: spacing.xl, ...typography.body },
});
