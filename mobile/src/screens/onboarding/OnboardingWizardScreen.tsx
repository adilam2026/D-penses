import React, { useCallback, useRef, useState } from 'react';
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
  actionLabelAgain: string;
  itemAddedLabel: string;
  checkCount: () => Promise<number>;
  countLabel: (n: number) => string;
  // §26 — seules les étapes réellement optionnelles proposent "Je n'en ai pas" :
  // au moins un compte reste indispensable au fonctionnement de l'application.
  allowNotApplicable: boolean;
}

// Vague 3 §26 — 7 étapes conceptuelles (comptes, revenus, charges, enfants si
// applicable, budgets, épargne/enveloppes, projets importants), chacune
// sautable, jamais bloquante (§28).
const STEPS: StepDef[] = [
  {
    key: 'accounts',
    title: 'Comptes',
    help: 'Vos comptes bancaires ou espèces — la base de tout calcul financier.',
    route: 'QuickCreateAccount',
    actionLabel: 'Ajouter un compte',
    actionLabelAgain: 'Ajouter un autre compte',
    itemAddedLabel: 'Compte ajouté.',
    checkCount: async () => (await api.listAccounts()).length,
    countLabel: (n) => `${n} compte(s) déjà créé(s)`,
    allowNotApplicable: false,
  },
  {
    key: 'income',
    title: 'Revenus',
    help: 'Vos sources de revenus — salaire, primes, revenus complémentaires.',
    route: 'Income',
    actionLabel: 'Ajouter un revenu',
    actionLabelAgain: 'Ajouter un autre revenu',
    itemAddedLabel: 'Revenu ajouté.',
    checkCount: async () => (await api.listIncomeSources()).length,
    countLabel: (n) => `${n} revenu(s) déjà configuré(s)`,
    allowNotApplicable: true,
  },
  {
    key: 'charges',
    title: 'Charges',
    help: 'Vos charges récurrentes — loyer, abonnements, factures.',
    route: 'Charges',
    actionLabel: 'Ajouter une charge',
    actionLabelAgain: 'Ajouter une autre charge',
    itemAddedLabel: 'Charge ajoutée.',
    checkCount: async () => (await api.listOpenDeadlines()).length,
    countLabel: (n) => `${n} échéance(s) déjà en cours`,
    allowNotApplicable: true,
  },
  {
    key: 'children',
    title: 'Enfants',
    help: 'Si applicable — permet de suivre les frais scolaires et charges par enfant.',
    route: 'Children',
    actionLabel: 'Ajouter un enfant',
    actionLabelAgain: 'Ajouter un autre enfant',
    itemAddedLabel: 'Enfant ajouté.',
    checkCount: async () => (await api.listChildren()).length,
    countLabel: (n) => `${n} enfant(s) déjà enregistré(s)`,
    allowNotApplicable: true,
  },
  {
    key: 'budgets',
    title: 'Budgets variables',
    help: 'Une limite prudente pour vos dépenses du quotidien — courses, sorties...',
    route: 'CreateBudget',
    actionLabel: 'Créer un budget',
    actionLabelAgain: 'Créer un autre budget',
    itemAddedLabel: 'Budget créé.',
    checkCount: async () => (await api.listVariableBudgets()).length,
    countLabel: (n) => `${n} budget(s) déjà créé(s)`,
    allowNotApplicable: true,
  },
  {
    key: 'savings',
    title: 'Enveloppes / Épargne',
    help: "Réservez une partie de votre argent pour un usage précis — école, voyage, imprévus.",
    route: 'CreatePocket',
    routeParams: {},
    actionLabel: 'Créer une enveloppe',
    actionLabelAgain: 'Créer une autre enveloppe',
    itemAddedLabel: 'Enveloppe créée.',
    checkCount: async () => {
      const [pockets, provisions] = await Promise.all([api.listPockets(), api.listProvisions()]);
      return pockets.length + provisions.length;
    },
    countLabel: (n) => `${n} enveloppe(s) déjà créée(s)`,
    allowNotApplicable: true,
  },
  {
    key: 'plans',
    title: 'Projets importants',
    help: 'École, voyage — un plan financier suit un projet de bout en bout.',
    route: 'FinancialPlans',
    actionLabel: 'Voir mes plans',
    actionLabelAgain: 'Voir mes plans',
    itemAddedLabel: 'Plan créé.',
    checkCount: async () => (await api.listFinancialPlans()).length,
    countLabel: (n) => `${n} plan(s) déjà créé(s)`,
    allowNotApplicable: true,
  },
];

/**
 * Assistant de démarrage (Lot 3 §A, étendu Vague 3 §26-28) — mobile uniquement
 * pour la détection "déjà configuré" (comptée en direct sur chaque domaine, jamais
 * un indicateur stocké désynchronisable) ; seule l'étape volontairement ignorée
 * ("Je n'en ai pas") est persistée côté backend (HouseholdSettings.onboardingSkippedSteps,
 * §25), partagée entre les adultes du foyer. Jamais imposé : accessible à tout
 * moment depuis ☰, jamais affiché automatiquement à chaque ouverture (§28).
 */
export function OnboardingWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const previousCounts = useRef<Record<string, number>>({});

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const refreshCurrent = useCallback(async () => {
    setLoadingKey(current.key);
    try {
      const n = await current.checkCount();
      const prev = previousCounts.current[current.key];
      setJustAdded(prev !== undefined && n > prev);
      previousCounts.current[current.key] = n;
      setCounts((prevCounts) => ({ ...prevCounts, [current.key]: n }));
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

  async function onNotApplicable() {
    await api.skipOnboardingStep(current.key);
    goNext();
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
            <Text style={styles.statusText}>
              {justAdded ? `✓ ${current.itemAddedLabel}` : hasExisting ? `✓ ${current.countLabel(count ?? 0)}` : "Rien de configuré pour l'instant"}
            </Text>
          </View>
        )}

        <TouchableOpacity
          testID={`onboarding-action-${current.key}`}
          style={styles.actionButton}
          onPress={() => navigation.navigate(current.route, current.routeParams)}
        >
          <Text style={styles.actionButtonText}>{hasExisting ? current.actionLabelAgain : current.actionLabel}</Text>
        </TouchableOpacity>

        {hasExisting && (
          <TouchableOpacity testID="onboarding-continue" style={styles.continueButton} onPress={goNext}>
            <Text style={styles.continueButtonText}>Continuer</Text>
          </TouchableOpacity>
        )}

        {!hasExisting && current.allowNotApplicable && (
          <TouchableOpacity testID="onboarding-not-applicable" style={styles.notApplicableButton} onPress={onNotApplicable}>
            <Text style={styles.notApplicableText}>Je n'en ai pas</Text>
          </TouchableOpacity>
        )}

        <View style={styles.dotsRow}>
          {STEPS.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === step && styles.dotActive, (counts[s.key] ?? 0) > 0 && styles.dotDone]} />
          ))}
        </View>
      </ScrollView>

      <View style={[styles.navRow, { paddingBottom: bottomInset }]}>
        <TouchableOpacity style={styles.navButton} onPress={() => (step === 0 ? navigation.goBack() : setStep((s) => s - 1))}>
          <Text style={styles.navButtonText}>{step === 0 ? 'Fermer' : 'Précédent'}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="onboarding-later" style={styles.navButtonPrimary} onPress={goNext}>
          <Text style={styles.navButtonPrimaryText}>{isLast ? 'Terminer' : 'Plus tard'}</Text>
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
  actionButton: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  actionButtonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  continueButton: { borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#172436' },
  continueButtonText: { color: '#172436', fontWeight: '600', fontSize: 14 },
  notApplicableButton: { alignItems: 'center', marginBottom: 12 },
  notApplicableText: { color: '#6B747C', fontSize: 13, fontWeight: '600' },
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
