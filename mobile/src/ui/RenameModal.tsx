import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { FormField } from './FormField';
import { colors, radius, spacing, typography } from './theme';
import { useBottomInset } from './useBottomInset';

/** "Modifier" (Détail compte/sous-compte, §8/§9) — renommage uniquement, écran très simple. */
export function RenameModal({
  visible,
  title,
  initialValue,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialValue: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  async function submit() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <Text style={styles.title}>{title}</Text>
        <FormField label="Nom" value={name} onChangeText={setName} autoFocus testID="rename-modal-input" />
        <TouchableOpacity
          style={[styles.button, (!name.trim() || saving) && styles.buttonDisabled]}
          onPress={submit}
          disabled={!name.trim() || saving}
          testID="rename-modal-submit"
        >
          <Text style={styles.buttonText}>{saving ? 'Enregistrement…' : 'Enregistrer'}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl },
  title: { ...typography.sectionTitle, marginBottom: spacing.lg },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
});
