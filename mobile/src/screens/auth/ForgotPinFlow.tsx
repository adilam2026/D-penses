import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { maskEmail } from '../../auth/maskEmail';
import { PIN_LENGTH } from '../../auth/pinRules';
import { PinDots, PinPad } from '../../ui/PinPad';
import { CreatePinSteps } from './CreatePinSteps';
import { colors, spacing } from '../../ui/theme';
import { authStyles } from './authStyles';

function messageOf(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.status >= 500 ? fallback : err.message;
  return 'Erreur réseau — vérifiez votre connexion et réessayez.';
}

/**
 * « Code oublié ? » : code envoyé à l'adresse enregistrée (affichée masquée),
 * vérification, nouveau code + confirmation. Le serveur révoque ensuite
 * toutes les sessions et en ouvre une nouvelle pour cet appareil.
 */
export function ForgotPinFlow({ initialEmail, onCancel }: { initialEmail?: string; onCancel: () => void }) {
  const { requestPinReset, verifyPinReset, completePinReset } = useAuth();
  const [email, setEmail] = useState(initialEmail ?? '');
  const [step, setStep] = useState<'email' | 'send' | 'code' | 'newPin'>(initialEmail ? 'send' : 'email');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await requestPinReset(email.trim());
      setStep('code');
    } catch (err) {
      setError(messageOf(err, "L'email n'a pas pu être envoyé. Réessayez."));
    } finally {
      setBusy(false);
    }
  }

  async function onCode(next: string) {
    setCode(next);
    if (next.length < PIN_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      setResetToken(await verifyPinReset(email.trim(), next));
      setStep('newPin');
    } catch (err) {
      setError(messageOf(err, 'Vérification impossible. Réessayez.'));
    } finally {
      setCode('');
      setBusy(false);
    }
  }

  async function onNewPin(pin: string) {
    if (!resetToken) return;
    try {
      await completePinReset(email.trim(), resetToken, pin);
    } catch (err) {
      setError(messageOf(err, 'Impossible de définir le code. Réessayez.'));
      if (err instanceof ApiError && err.status === 400 && /expirée/.test(err.message)) setStep('send');
    }
  }

  const masked = maskEmail(email.trim());
  return (
    <View testID="forgot-pin">
      {step === 'newPin' ? (
        <CreatePinSteps onDone={onNewPin} error={error} />
      ) : (
        <>
          <View style={[authStyles.card, step === 'code' && authStyles.cardCentered]}>
            <Text style={authStyles.cardTitle}>Code oublié</Text>
            {step === 'email' && (
              <>
                <Text style={authStyles.cardSubtitle}>Recevez un code par email pour choisir un nouveau code.</Text>
                <Text style={authStyles.fieldLabel}>ADRESSE EMAIL</Text>
                <View style={authStyles.inputRow}>
                  <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                  <TextInput
                    style={authStyles.inputInRow}
                    placeholder="Adresse email du compte"
                    placeholderTextColor={colors.textSecondary}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    testID="forgot-email"
                  />
                </View>
                {error ? <Text style={authStyles.error}>{error}</Text> : null}
                <TouchableOpacity style={[authStyles.button, !email.trim() && authStyles.buttonDisabled]} onPress={send} disabled={!email.trim() || busy} testID="forgot-send">
                  {busy ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={authStyles.buttonText}>Recevoir un code</Text>}
                </TouchableOpacity>
              </>
            )}
            {step === 'send' && (
              <>
                <Text style={[authStyles.cardSubtitle, styles.sendText]} testID="forgot-masked-email">
                  Un code de vérification sera envoyé à {masked}
                </Text>
                {error ? <Text style={authStyles.error}>{error}</Text> : null}
                <TouchableOpacity style={authStyles.button} onPress={send} disabled={busy} testID="forgot-send">
                  {busy ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={authStyles.buttonText}>Envoyer le code</Text>}
                </TouchableOpacity>
              </>
            )}
            {step === 'code' && (
              <>
                <Text style={authStyles.cardSubtitle}>Saisissez le code reçu à {masked}</Text>
                <PinDots length={PIN_LENGTH} filled={code.length} testID="forgot-code-dots" />
                {error ? <Text style={authStyles.error}>{error}</Text> : null}
              </>
            )}
          </View>
          {step === 'code' && (
            <View style={authStyles.padArea}>
              {busy ? <ActivityIndicator style={authStyles.busy} color={colors.primary} /> : <PinPad value={code} onChange={onCode} maxLength={PIN_LENGTH} />}
            </View>
          )}
        </>
      )}
      <View style={authStyles.links}>
        <TouchableOpacity onPress={onCancel} testID="forgot-cancel">
          <Text style={authStyles.linkMuted}>Annuler</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sendText: { marginTop: spacing.sm },
});
