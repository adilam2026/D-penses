import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from './theme';
import { useBottomInset } from './useBottomInset';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ChoiceOption {
  key: string;
  label: string;
  description?: string;
  icon?: IconName;
  onPress: () => void;
}

interface ChoiceSheetProps {
  visible: boolean;
  title: string;
  options: ChoiceOption[];
  onClose: () => void;
  cancelLabel?: string;
  testID?: string;
}

/**
 * Modal interne D-Penses+ pour un choix métier à options nommées (§12) — jamais
 * un Alert.alert natif Android/iOS pour une décision fonctionnelle (ex. "Quel
 * type de plan ?"). Les Alert.alert restent légitimes uniquement pour une
 * confirmation destructive simple (Annuler/Supprimer) ou un message informatif.
 */
export function ChoiceSheet({ visible, title, options, onClose, cancelLabel = 'Annuler', testID }: ChoiceSheetProps) {
  // R6.3 (point I safe-area) — jamais un paddingBottom codé en dur.
  const bottomInset = useBottomInset(8);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} testID={testID}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{title}</Text>
        {options.map((o) => (
          <TouchableOpacity
            key={o.key}
            testID={testID ? `${testID}-option-${o.key}` : undefined}
            style={styles.option}
            onPress={() => {
              onClose();
              o.onPress();
            }}
          >
            {o.icon && (
              <View style={styles.iconCircle}>
                <Ionicons name={o.icon} size={20} color={colors.primary} />
              </View>
            )}
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>{o.label}</Text>
              {o.description ? <Text style={styles.optionDescription}>{o.description}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.cancelButton} onPress={onClose} testID={testID ? `${testID}-cancel` : undefined}>
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9D5CC', alignSelf: 'center', marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.lg },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  optionDescription: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  cancelButton: { marginTop: spacing.sm, alignItems: 'center', paddingVertical: spacing.sm },
  cancelText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
});
