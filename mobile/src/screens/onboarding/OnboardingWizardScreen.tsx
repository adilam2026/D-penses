import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface StepDef {
  key: string;
  title: string;
  help: string;
  route: string;
  routeParams?: Record<string, unknown>;
  actionLabel: string;
  checkCount: () => Promise<number>;
  countLabel: (n: number) => string;
}

const STEPS: StepDef[] = [
  {
    key: 'accounts',
    title: 'Comptes',
    help: 'Vos comptes bancaires ou espèces — la base de tout calcul financier.',
    route: 'QuickCreateAccount',
    actionLabel: 'Ajouter un compte',
    checkCount: async () => (await api.listAccounts()).length,
    countLabel: (n) => `${n} compte(s) déjà créé(s)`,
  },
  {
    key: 'income',
    title: 'Revenus',
    help: 'Vos sources de revenus — salaire, primes, revenus complémentaires.',
    route: 'Income',
    actionLabel: 'Ajouter un revenu',
    checkCount: async () => (await api.listIncomeSources()).length,
    countLabel: (n) => `${n} revenu(s) déjà configuré(s)`,
  },
  {
    key: 'charges',
    title: 'Charges',
    help: 'Vos charges récurrentes — loyer, abonnements, factures.',
    route: 'Charges',
    actionLabel: 'Ajouter une charge',
    checkCount: async () => (await api.listOpenDeadlines()).length,
    countLabel: (n) => `${n} échéance(s) déjà en cours`,
  },
  {
    key: 'budgets',
    title: 'Budgets variables',
    help: 'Une limite prudente pour vos dépenses du quotidien — courses, sorties...',
    route: 'CreateBudget',
    actionLabel: 'Créer un budget',
    checkCount: async () => (await api.listVariableBudgets()).length,
    countLabel: (n) => `${n} budget(s) déjà créé(s)`,
  },
  {
    key: 'savings',
    title: 'Enveloppes / Épargne',
    help: "Réservez une partie de votre argent pour un usage précis — école, voyage, imprévus.",
    route: 'CreatePocket',
    routeParams: { kind: 'pocket' },
    actionLabel: 'Créer une enveloppe',
    checkCount: async () => {
      const [pockets, provisions] = await Promise.all([api.listPockets(), api.listProvisions()]);
      return pockets.length + provisions.length;
    },
    countLabel: (n) => `${n} enveloppe(s) déjà créée(s)`,
  },
];

/**
 * Assistant de démarrage (Lot 3 §A) — mobile uniquement, aucun champ backend
 * nouveau : la détection « déjà configuré » interroge simplement les listes
 * déjà exposées par chaque domaine, en direct à chaque passage sur l'étape —
 * jamais un indicateur stocké qui pourrait se désynchroniser de la réalité.
 * Chaque étape reste sautable ; l'assistant reste accessible à tout moment
 * depuis Plus, il n'est jamais imposé.
 */
export function OnboardingWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const refreshCurrent = useCallback(async () => {
    setLoadingKey(current.key);
    try {
      const n = await current.checkCount();
      setCounts((prev) => ({ ...prev, [current.key]: n }));
    } finally {
      setLoadingKey(null);
    }
  }, [current]);

  useFocusEffect(
    useCallback(() => {
      refreshCurrent();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]),
  );

  function goNext() {
    if (isLast) {
      navigation.goBack();
    } else {
      setStep((s) => s + 1);
    }
  }

  const count = counts[current.key] ?? null;
  const hasExisting = (count ?? 0) > 0;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
        <Text style={styles.stepCounter}>
          Étape {step + 1}/{STEPS.length}
        </Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.help}>{current.help}</Text>

        {loadingKey === current.key ? (
          <ActivityIndicator style={{ marginVertical: 20 }} />
        ) : (
          <View style={[styles.statusCard, hasExisting && styles.statusCardDone]}>
            <Text style={styles.statusText}>{hasExisting ? `✓ ${current.countLabel(count ?? 0)}` : 'Rien de configuré pour l\'instant'}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => navigation.navigate(current.route, current.routeParams)}
        >
          <Text style={styles.actionButtonText}>{current.actionLabel}</Text>
        </TouchableOpacity>

        <View style={styles.dotsRow}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === step && styles.dotActive, (counts[s.key] ?? 0) > 0 && styles.dotDone]} />
          ))}
        </View>
      </ScrollView>

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navButton} onPress={() => (step === 0 ? navigation.goBack() : setStep((s) => s - 1))}>
          <Text style={styles.navButtonText}>{step === 0 ? 'Fermer' : 'Précédent'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navButtonPrimary} onPress={goNext}>
          <Text style={styles.navButtonPrimaryText}>{isLast ? 'Terminer' : hasExisting ? 'Suivant' : 'Passer cette étape'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 40 },
  stepCounter: { fontSize: 11, color: '#6B747C', textAlign: 'center', marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', textAlign: 'center', marginBottom: 8 },
  help: { fontSize: 13, color: '#6B747C', textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  statusCard: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#E3E1DC' },
  statusCardDone: { borderColor: '#2E7D5B', backgroundColor: '#E6F2EC' },
  statusText: { fontSize: 13, color: '#172436', textAlign: 'center', fontWeight: '600' },
  actionButton: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 24 },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E3E1DC' },
  dotActive: { backgroundColor: '#172436', width: 20 },
  dotDone: { backgroundColor: '#2E7D5B' },
  navRow: { flexDirection: 'row', padding: 20, gap: 12 },
  navButton: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#EDEBE6' },
  navButtonText: { color: '#172436', fontWeight: '600', fontSize: 14 },
  navButtonPrimary: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#172436' },
  navButtonPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
