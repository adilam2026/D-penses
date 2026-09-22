import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { webColors, webRadius, webSpacing } from '../webTheme';

interface Props {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

/**
 * Portail Web v4 (WEB-V4.4A) — `Alert.alert` (RN) est un no-op sur Web
 * (react-native-web : `class Alert { static alert() {} }`) — jamais utilisable
 * tel quel pour une confirmation destructive. Ce composant le remplace,
 * partagé dès ce lot (≥2 usages réels : TransactionDetail/AccountDetail/
 * BudgetDetail/FinancialPlanDetail/ChargePlanDetail).
 */
export function ConfirmDialog({ visible, title, message, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', destructive, loading, onConfirm, onCancel, testID }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card} testID={testID}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={testID ? `${testID}-confirm` : undefined}
              style={[styles.confirmButton, destructive && styles.confirmButtonDanger]}
              onPress={onConfirm}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={destructive ? webColors.danger : webColors.textOnPrimary} />
              ) : (
                <Text style={[styles.confirmText, destructive && styles.confirmTextDanger]}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,26,41,0.45)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  card: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 420, maxWidth: '100%' },
  title: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  message: { fontSize: 13, color: webColors.textSecondary, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.lg, gap: webSpacing.sm },
  cancelButton: { paddingHorizontal: 14, paddingVertical: 10 },
  cancelText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
  confirmButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  confirmButtonDanger: { backgroundColor: webColors.dangerLight },
  confirmText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  confirmTextDanger: { color: webColors.danger },
});
