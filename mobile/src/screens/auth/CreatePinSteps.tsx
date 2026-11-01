import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { PinDots, PinPad } from '../../ui/PinPad';
import { isTrivialPin, PIN_LENGTH } from '../../auth/pinRules';
import { colors, radius, spacing, typography } from '../../ui/theme';
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
  const stepNumber = step === 'create' ? 1 : 2;
  return (
    <View testID={`create-pin-${step}`}>
      <View style={[authStyles.card, authStyles.cardCentered]}>
        <View style={styles.progressRow} accessibilityLabel={`Étape ${stepNumber} sur 2`}>
          <View style={[styles.segment, styles.segmentActive]} />
          <View style={[styles.segment, stepNumber === 2 && styles.segmentActive]} />
          <Text style={styles.stepText}>Étape {stepNumber} sur 2</Text>
        </View>
        <Text style={authStyles.prompt}>{step === 'create' ? 'Créez votre code à 6 chiffres' : 'Confirmez votre code'}</Text>
        {step === 'create' ? <Text style={authStyles.hint}>Évitez 123456 ou 111111</Text> : null}
        <PinDots length={PIN_LENGTH} filled={value.length} />
        {shownError ? (
          <Text style={authStyles.error} testID="create-pin-error">
            {shownError}
          </Text>
        ) : null}
      </View>
      <View style={authStyles.padArea}>
        {busy ? <ActivityIndicator style={authStyles.busy} color={colors.primary} /> : <PinPad value={value} onChange={onChange} maxLength={PIN_LENGTH} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Progression légère : deux segments fins + « Étape n sur 2 » sur une seule ligne.
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.md },
  segment: { width: 26, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  segmentActive: { backgroundColor: colors.primary },
  stepText: { ...typography.caption, marginLeft: spacing.xs },
});
