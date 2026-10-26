import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { AccountCard, GoalProgressLine } from '../ui/AccountCard';
import { isSanteSubaccount } from '../ui/santeDetection';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { useBottomInset } from '../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

/**
 * Épargne — même identité que « MES COMPTES » (Accueil) : une carte blanche
 * par COMPTE RÉEL (AccountCard partagé), avec ses enveloppes à l'intérieur et
 * le non affecté — une enveloppe n'est jamais présentée comme un compte
 * indépendant. Sans curation cachée : tout compte portant des enveloppes
 * (quel que soit son type) et tout compte EPARGNE sans enveloppe. Objectif
 * affiché discrètement sous la ligne concernée, uniquement s'il existe.
 */
export function EpargneScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [goals, setGoals] = useState<api.GoalApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const [accountsData, claimsData, goalsData] = await Promise.all([
      cached('accounts', () => api.listAccounts(), 60_000, force),
      cached('medical-claims:all', () => api.listMedicalClaims(), 60_000, force),
      cached('goals', () => api.listGoals(), 60_000, force),
    ]);
    setAccounts(accountsData);
    setClaims(claimsData);
    setGoals(goalsData);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  if (loading && !accounts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // L'index d'origine est conservé pour que la pastille ait la même couleur
  // que sur l'Accueil (paletteForAccount retombe sur l'index sans colorKey).
  const shown = (accounts ?? [])
    .map((account, idx) => ({ account, idx }))
    .filter(({ account }) => account.subaccounts.length > 0 || account.type === 'EPARGNE');
  // En-tête : mêmes enveloppes et même total qu'avant la refonte (enveloppes
  // + comptes épargne sans enveloppe) — aucun calcul modifié.
  let envelopeCount = 0;
  let totalSaved = 0;
  for (const { account } of shown) {
    if (account.subaccounts.length === 0) {
      envelopeCount += 1;
      totalSaved += account.balance;
    }
    for (const sub of account.subaccounts) {
      envelopeCount += 1;
      totalSaved += sub.balance;
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Épargne</Text>
          <Text style={styles.subtitle} testID="epargne-subtitle">
            {envelopeCount} enveloppe{envelopeCount > 1 ? 's' : ''} · {formatDh(totalSaved)} épargnés
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity style={styles.newButton} onPress={() => navigation.navigate('CreateSubaccount')} testID="epargne-new">
            <Text style={styles.newButtonText}>+ Nouvelle</Text>
          </TouchableOpacity>
          <HelpButton
            title="Épargne"
            text="Chaque carte est un compte bancaire réel ; les enveloppes (voiture, voyage, santé, scolarité…) sont des parts réservées à l'intérieur de ce compte. Solde du compte = enveloppes + non affecté."
          />
        </View>
      </View>

      {shown.length === 0 ? (
        <Text style={styles.emptyText}>Aucune épargne pour l'instant.</Text>
      ) : (
        shown.map(({ account, idx }) => {
          const accountGoal = account.subaccounts.length === 0 ? (goals.find((g) => g.accountId === account.id) ?? null) : null;
          return (
            <AccountCard
              key={account.id}
              account={account}
              accountIdx={idx}
              testIDPrefix="epargne"
              onPressAccount={() => navigation.navigate('AccountDetail', { id: account.id })}
              onPressSubaccount={(sub) => navigation.navigate(isSanteSubaccount(sub.name) ? 'Health' : 'SubaccountDetail', { id: sub.id })}
              accountExtra={accountGoal ? <GoalProgressLine goal={accountGoal} testID={`epargne-goal-${account.id}`} /> : undefined}
              renderSubaccountExtra={(sub) => {
                const goal = goals.find((g) => g.subaccountId === sub.id) ?? null;
                const pendingCount = isSanteSubaccount(sub.name) ? claims.filter((c) => c.subaccountId === sub.id && c.status === 'PENDING').length : 0;
                if (!goal && pendingCount === 0) return null;
                return (
                  <>
                    {goal ? <GoalProgressLine goal={goal} testID={`epargne-goal-${sub.id}`} /> : null}
                    {pendingCount > 0 ? (
                      <Text style={styles.extraLine}>
                        {pendingCount} remboursement{pendingCount > 1 ? 's' : ''} en attente
                      </Text>
                    ) : null}
                  </>
                );
              }}
            />
          );
        })
      )}
    </ScrollView>
  );
}

export function GoalModal({
  target,
  onClose,
  onSaved,
}: {
  target: { accountId?: string; subaccountId?: string; name: string; goal: api.GoalApi | null } | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [targetAmount, setTargetAmount] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (target) {
      setTargetAmount(target.goal ? String(target.goal.targetAmount) : '');
      setTargetDate(target.goal?.targetDate ? target.goal.targetDate.slice(0, 10) : '');
    }
  }, [target]);

  if (!target) return null;

  async function submit() {
    if (!targetAmount.trim() || saving) return;
    setSaving(true);
    try {
      if (target!.goal) await api.deleteGoal(target!.goal.id);
      await api.createGoal({
        accountId: target!.accountId,
        subaccountId: target!.subaccountId,
        targetAmount: targetAmount.trim(),
        targetDate: targetDate || undefined,
        label: target!.name,
      });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!target?.goal || saving) return;
    setSaving(true);
    try {
      await api.deleteGoal(target.goal.id);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView ref={scrollRef} style={styles.sheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.sheetTitle}>Objectif — {target.name}</Text>
        <FormField label="Montant objectif" value={targetAmount} onChangeText={setTargetAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="goal-amount" />
        <DateField label="Date (optionnelle)" value={targetDate} onChange={setTargetDate} />
        <TouchableOpacity style={[styles.submitButton, (!targetAmount.trim() || saving) && styles.submitButtonDisabled]} onPress={submit} disabled={!targetAmount.trim() || saving} testID="goal-submit">
          <Text style={styles.submitButtonText}>{saving ? 'Enregistrement…' : target.goal ? 'Mettre à jour' : "Définir l'objectif"}</Text>
        </TouchableOpacity>
        {target.goal ? (
          <TouchableOpacity style={styles.removeButton} onPress={remove} disabled={saving} testID="goal-remove">
            <Text style={styles.removeButtonText}>Supprimer l'objectif</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 220 },
  newButton: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  newButtonText: { fontSize: 11.5, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  emptyText: { ...typography.bodySecondary },
  extraLine: { ...typography.caption, color: colors.textSecondary, paddingLeft: 10 + spacing.sm, paddingBottom: spacing.xs },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  removeButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  removeButtonText: { ...typography.body, fontWeight: '700', color: colors.danger },
});
