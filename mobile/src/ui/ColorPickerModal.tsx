import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AccountColorSwatchGrid } from './AccountColorPicker';
import { colors, radius, spacing, typography } from './theme';
import { useBottomInset } from './useBottomInset';

/** "Couleur de la carte" (Détail compte/sous-compte, Lot ciblé §1) — édition après création, même palette. */
export function ColorPickerModal({
  visible,
  title,
  initialColorKey,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  initialColorKey: string | null;
  onClose: () => void;
  onSubmit: (colorKey: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string | null>(initialColorKey);
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  React.useEffect(() => {
    if (visible) setSelected(initialColorKey);
  }, [visible, initialColorKey]);

  async function submit() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await onSubmit(selected);
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
        <AccountColorSwatchGrid selected={selected} onSelect={setSelected} />
        <TouchableOpacity
          style={[styles.button, (!selected || saving) && styles.buttonDisabled]}
          onPress={submit}
          disabled={!selected || saving}
          testID="color-picker-submit"
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
