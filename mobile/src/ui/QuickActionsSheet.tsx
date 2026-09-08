import React, { useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useQuickActions } from '../state/QuickActionsContext';
import { ChoiceSheet } from './ChoiceSheet';
import { useBottomInset } from './useBottomInset';

type IconName = keyof typeof Ionicons.glyphMap;

interface QuickAction {
  key: string;
  label: string;
  description: string;
  icon: IconName;
}

// Vague 3 §3 — maximum 6 actions du quotidien, jamais une liste de 15 fonctionnalités.
const ACTIONS: QuickAction[] = [
  { key: 'depense', label: 'Dépense', description: 'Une dépense réelle', icon: 'remove-circle-outline' },
  { key: 'revenu', label: 'Revenu', description: 'Un revenu reçu', icon: 'add-circle-outline' },
  { key: 'paiement', label: 'Payer une échéance', description: 'Régler une charge existante', icon: 'card-outline' },
  { key: 'alimenter', label: 'Alimenter une enveloppe', description: 'Mettre de côté', icon: 'wallet-outline' },
  { key: 'plan', label: 'Créer un plan', description: 'École, voyage...', icon: 'folder-outline' },
  { key: 'transfert', label: 'Transfert', description: 'Entre deux comptes', icon: 'swap-horizontal-outline' },
];

/**
 * Bottom sheet du bouton "+" central (§3/§4). Monte depuis le bas, ~1/3 à 1/2
 * de l'écran. Chaque action anticipe ses prérequis (§4) : jamais une impasse —
 * même pattern que QuickAddScreen.promptCreateAccount() (Alert + CTA de création).
 */
export function QuickActionsSheet() {
  const navigation = useNavigation<any>();
  const { visible, close } = useQuickActions();
  const [checking, setChecking] = useState<string | null>(null);
  const [planChoiceOpen, setPlanChoiceOpen] = useState(false);
  // R6.3 (point I safe-area) — jamais un paddingBottom codé en dur : la barre
  // système Android (gestes ou 3 boutons) doit toujours être évitée.
  const bottomInset = useBottomInset(12);

  function goToQuickAdd(mode: 'depense' | 'revenu' | 'paiement' | 'transfert') {
    close();
    navigation.navigate('QuickAdd', { mode });
  }

  async function onAlimenterEnveloppe() {
    setChecking('alimenter');
    try {
      const [pockets, provisions] = await Promise.all([api.listPockets(), api.listProvisions()]);
      close();
      if (pockets.length === 0 && provisions.length === 0) {
        Alert.alert("Vous n'avez pas encore d'enveloppe.", undefined, [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Créer une enveloppe', onPress: () => navigation.navigate('CreatePocket', {}) },
        ]);
        return;
      }
      navigation.navigate('Enveloppes');
    } finally {
      setChecking(null);
    }
  }

  async function onPayerEcheance() {
    setChecking('paiement');
    try {
      const deadlines = await api.listOpenDeadlines();
      close();
      if (deadlines.length === 0) {
        Alert.alert("Vous n'avez pas encore d'échéance à payer.", undefined, [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Créer une charge récurrente', onPress: () => navigation.navigate('Charges') },
        ]);
        return;
      }
      navigation.navigate('QuickAdd', { mode: 'paiement' });
    } finally {
      setChecking(null);
    }
  }

  function onCreerPlan() {
    close();
    // §12 : un choix métier (type de plan) ne passe jamais par un Alert natif —
    // le ChoiceSheet interne s'ouvre APRÈS la fermeture du bottom sheet "+"
    // (deux modals React Native simultanées se marchent dessus sur Android).
    setTimeout(() => setPlanChoiceOpen(true), 300);
  }

  function onPress(key: string) {
    if (checking) return;
    switch (key) {
      case 'depense':
        return goToQuickAdd('depense');
      case 'revenu':
        return goToQuickAdd('revenu');
      case 'transfert':
        return goToQuickAdd('transfert');
      case 'paiement':
        return onPayerEcheance();
      case 'alimenter':
        return onAlimenterEnveloppe();
      case 'plan':
        return onCreerPlan();
    }
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
        <TouchableWithoutFeedback onPress={close}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>
        <View style={[styles.sheet, { paddingBottom: bottomInset }]} testID="quick-actions-sheet">
          <View style={styles.handle} />
          <Text style={styles.title}>Ajouter</Text>
          <View style={styles.grid}>
            {ACTIONS.map((a) => (
              <TouchableOpacity key={a.key} testID={`quick-action-${a.key}`} style={styles.action} onPress={() => onPress(a.key)} disabled={checking === a.key}>
                <View style={styles.iconCircle}>
                  <Ionicons name={a.icon} size={22} color="#172436" />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
                <Text style={styles.actionDescription}>{a.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.cancelButton} onPress={close}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </Modal>
      <ChoiceSheet
        visible={planChoiceOpen}
        title="Créer un plan"
        testID="plan-type-choice"
        onClose={() => setPlanChoiceOpen(false)}
        options={[
          {
            key: 'scolaire',
            label: 'Frais scolaires',
            description: 'Échéances de scolarité et services associés',
            icon: 'school-outline',
            onPress: () => navigation.navigate('SchoolWizard'),
          },
          {
            key: 'voyage',
            label: 'Voyage',
            description: "Budget et dépenses d'un voyage",
            icon: 'airplane-outline',
            onPress: () => navigation.navigate('TravelWizard'),
          },
        ]}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: {
    backgroundColor: '#F6F5F2',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D9D5CC', alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: '#172436', marginBottom: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  action: { width: '31%', alignItems: 'center', marginBottom: 20 },
  iconCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  actionLabel: { fontSize: 12, fontWeight: '600', color: '#172436', textAlign: 'center' },
  actionDescription: { fontSize: 10, color: '#6B747C', textAlign: 'center', marginTop: 2 },
  cancelButton: { marginTop: 4, alignItems: 'center' },
  cancelText: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
});
