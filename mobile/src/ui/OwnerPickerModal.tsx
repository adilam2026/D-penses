import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Select } from './Select';
import { colors, radius, spacing, typography } from './theme';
import { useBottomInset } from './useBottomInset';
import type { AccountOwnerType, HouseholdMembershipApi } from '../api/client';
import { decodeOwnerOption, encodeOwnerOption, ownerSelectOptions } from './accountOwner';

/** "Propriétaire" (Détail compte, lot "responsable automatique") — UX simple : une seule valeur parmi Non défini/<membres>/Commun, jamais ownerType exposé directement. */
export function OwnerPickerModal({
  visible,
  initialOwnerType,
  initialOwnerMemberId,
  members,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initialOwnerType: AccountOwnerType;
  initialOwnerMemberId: string | null;
  members: HouseholdMembershipApi[];
  onClose: () => void;
  onSubmit: (owner: { ownerType: AccountOwnerType; ownerMemberId: string | null }) => Promise<void>;
}) {
  const [ownerOption, setOwnerOption] = useState(encodeOwnerOption(initialOwnerType, initialOwnerMemberId));
  const [saving, setSaving] = useState(false);
  const bottomInset = useBottomInset(spacing.lg);

  async function submit() {
    if (saving) return;
    setSaving(true);
    try {
      await onSubmit(decodeOwnerOption(ownerOption));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <Text style={styles.title}>Propriétaire</Text>
        <Select label="Propriétaire" value={ownerOption} options={ownerSelectOptions(members)} onChange={setOwnerOption} testID="owner-picker-select" />
        <TouchableOpacity style={[styles.button, saving && styles.buttonDisabled]} onPress={submit} disabled={saving} testID="owner-picker-submit">
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
