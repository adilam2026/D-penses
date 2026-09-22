import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';

interface SimplePlan {
  id: string;
  label: string;
  description: string | null;
  active: boolean;
  chargeCount: number;
}

/**
 * Convergence V6C §1/§2 — Plans financiers desktop : même modèle simple que
 * mobile (liste "Nom / N charges / Voir" + "+ Ajouter un plan"), plus aucun
 * bloc de couverture/objectif/prochaines échéances/wizards École-Voyage.
 */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<SimplePlan[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = (await api.listFinancialPlans()) as SimplePlan[];
      setPlans(all.filter((p) => p.active !== false).sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openCreate() {
    setLabel('');
    setDescription('');
    setError(null);
    setCreateOpen(true);
  }

  async function onCreate() {
    if (!label.trim()) {
      setError('Le nom du plan est obligatoire');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await api.createFinancialPlan({ label: label.trim(), description: description.trim() || undefined });
      setCreateOpen(false);
      await load();
      navigation.navigate('FinancialPlanDetail', { id: created.id });
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title="Plans financiers"
        actions={
          <TouchableOpacity testID="web-financial-plan-add" style={styles.addButton} onPress={openCreate}>
            <Text style={styles.addButtonText}>+ Ajouter un plan</Text>
          </TouchableOpacity>
        }
      />

      {loading && plans.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : plans.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.empty}>Aucun plan financier pour l'instant.</Text>
          <TouchableOpacity testID="web-financial-plan-empty-create" style={styles.addButton} onPress={openCreate}>
            <Text style={styles.addButtonText}>+ Ajouter un plan</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.grid}>
          {plans.map((item) => (
            <View key={item.id} style={styles.card} testID={`web-financial-plan-card-${item.id}`}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.cardMeta}>{item.chargeCount} charge{item.chargeCount > 1 ? 's' : ''}</Text>
              <TouchableOpacity
                testID={`web-financial-plan-view-${item.id}`}
                style={styles.viewButton}
                onPress={() => navigation.navigate('FinancialPlanDetail', { id: item.id })}
              >
                <Text style={styles.viewButtonText}>Voir →</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="web-financial-plan-create-form">
            <Text style={styles.modalTitle}>Nouveau plan</Text>
            <TextInput style={styles.modalInput} value={label} onChangeText={setLabel} placeholder="Nom *" testID="web-financial-plan-create-label" />
            <TextInput
              style={styles.modalInput}
              value={description}
              onChangeText={setDescription}
              placeholder="Description facultative"
              testID="web-financial-plan-create-description"
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setCreateOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-financial-plan-create-save" style={styles.modalButton} onPress={onCreate} disabled={creating}>
                {creating ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  empty: { color: webColors.textSecondary, fontSize: 13, lineHeight: 20 },
  emptyState: { alignItems: 'center', marginTop: webSpacing.xl, gap: webSpacing.md },
  addButton: { backgroundColor: webColors.primary, borderRadius: webRadius.pill, paddingVertical: 8, paddingHorizontal: 16 },
  addButtonText: { color: webColors.textOnPrimary, fontSize: 13, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.md },
  card: {
    backgroundColor: webColors.surface,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    borderWidth: 1,
    borderColor: webColors.borderStrong,
    width: 260,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  cardMeta: { fontSize: 12, color: webColors.textSecondary, marginTop: 4, marginBottom: webSpacing.sm },
  viewButton: { alignSelf: 'flex-start' },
  viewButtonText: { fontSize: 12, fontWeight: '700', color: webColors.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  modalCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 420 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  modalInput: {
    backgroundColor: webColors.background,
    borderRadius: webRadius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: webColors.border,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md },
  modalButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
  error: { color: webColors.danger, fontSize: 12, marginTop: 4, marginBottom: 4 },
});
