import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, typography } from './theme';
import { useBottomInset } from './useBottomInset';

/**
 * Aide contextuelle "?" (maquette — bouton circulaire distinct du menu ☰,
 * présent sur chaque écran principal). Un seul composant partagé, jamais une
 * ré-implémentation par écran.
 */
export function HelpButton({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  return (
    <>
      <TouchableOpacity
        testID="help-button"
        style={styles.button}
        onPress={() => setOpen(true)}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.buttonText}>?</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.text}>{text}</Text>
          <TouchableOpacity style={styles.closeButton} onPress={() => setOpen(false)}>
            <Text style={styles.closeButtonText}>Fermer</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    padding: spacing.xl,
  },
  title: { ...typography.sectionTitle, marginBottom: spacing.sm },
  text: { ...typography.body, color: colors.textSecondary, lineHeight: 20 },
  closeButton: { marginTop: spacing.lg, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md },
  closeButtonText: { ...typography.body, fontWeight: '700', color: colors.primary },
});
