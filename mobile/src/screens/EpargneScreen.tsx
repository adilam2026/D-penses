import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { isSanteSubaccount } from '../ui/santeDetection';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { useBottomInset } from '../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';
import { accountPalette } from '../ui/accountPalette';

interface Card {
  key: string;
  name: string;
  meta: string;
  amount: number;
  extraLine?: string;
  goal: api.GoalApi | null;
  accountId?: string;
  subaccountId?: string;
  onPress: () => void;
}

/**
 * Épargne (Checkpoint 2 §3) — sans curation cachée : tous les comptes de type
 * EPARGNE sans sous-compte, et TOUS les sous-comptes de TOUS les comptes
 * (enveloppes de réserve), y compris ceux sans objectif explicite.
 */
export function EpargneScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [goals, setGoals] = useState<api.GoalApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [goalTarget, setGoalTarget] = useState<{ accountId?: string; subaccountId?: string; name: string; goal: api.GoalApi | null } | null>(null);

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

  const cards: Card[] = [];
  for (const account of accounts ?? []) {
    if (account.type === 'EPARGNE' && account.subaccounts.length === 0) {
      cards.push({
        key: account.id,
        name: account.name,
        meta: 'Compte bancaire',
        amount: account.balance,
        goal: goals.find((g) => g.accountId === account.id) ?? null,
        accountId: account.id,
        onPress: () => navigation.navigate('AccountDetail', { id: account.id }),
      });
    }
    for (const sub of account.subaccounts) {
      const sante = isSanteSubaccount(sub.name);
      const pendingCount = sante ? claims.filter((c) => c.subaccountId === sub.id && c.status === 'PENDING').length : 0;
      cards.push({
        key: sub.id,
        name: sub.name,
        meta: 'Disponible',
        amount: sub.balance,
        extraLine: pendingCount > 0 ? `${pendingCount} remboursement${pendingCount > 1 ? 's' : ''} en attente` : undefined,
        goal: goals.find((g) => g.subaccountId === sub.id) ?? null,
        subaccountId: sub.id,
        onPress: () => navigation.navigate(sante ? 'Health' : 'SubaccountDetail', { id: sub.id }),
      });
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
          <Text style={styles.subtitle}>Comptes d'épargne et enveloppes de réserve du foyer.</Text>
        </View>
        <HelpButton
          title="Épargne"
          text="Retrouvez ici tous vos comptes d'épargne ainsi que les enveloppes réservées à l'intérieur de vos comptes courants (voiture, voyage, santé, scolarité…)."
        />
      </View>

      {cards.length === 0 ? (
        <Text style={styles.emptyText}>Aucune épargne pour l'instant.</Text>
      ) : (
        <View style={styles.grid}>
          {cards.map((card, idx) => {
            const palette = accountPalette(idx);
            return (
              <View key={card.key} style={styles.cardSlot}>
                <TouchableOpacity style={[styles.card, { backgroundColor: palette.bg }]} onPress={card.onPress} testID={`epargne-card-${card.key}`}>
                  <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
                    {card.name}
                  </Text>
                  <Text style={[styles.cardMeta, { color: palette.textSecondary }]}>{card.meta}</Text>
                  <Text style={[styles.cardAmount, { color: palette.text }]}>{formatDh(card.amount)}</Text>
                  {card.extraLine ? <Text style={styles.cardExtra}>{card.extraLine}</Text> : null}
                </TouchableOpacity>
                {card.goal ? (
                  <TouchableOpacity
                    style={styles.goalRow}
                    onPress={() => setGoalTarget({ accountId: card.accountId, subaccountId: card.subaccountId, name: card.name, goal: card.goal })}
                    testID={`epargne-goal-${card.key}`}
                  >
                    <View style={styles.goalBarTrack}>
                      <View style={[styles.goalBarFill, { width: `${Math.min(100, card.goal.percent)}%` }]} />
                    </View>
                    <Text style={styles.goalText}>
                      Objectif {formatDh(card.goal.targetAmount)} · {Math.round(card.goal.percent)}%
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.goalAddLink}
                    onPress={() => setGoalTarget({ accountId: card.accountId, subaccountId: card.subaccountId, name: card.name, goal: null })}
                    testID={`epargne-add-goal-${card.key}`}
                  >
                    <Text style={styles.goalAddLinkText}>+ Définir un objectif</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}

      <GoalModal
        target={goalTarget}
        onClose={() => setGoalTarget(null)}
        onSaved={async () => {
          setGoalTarget(null);
          await load(true);
        }}
      />
    </ScrollView>
  );
}

function GoalModal({
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
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 260 },
  emptyText: { ...typography.bodySecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cardSlot: { width: '50%', paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  card: {
    borderRadius: radius.lg,
    padding: spacing.md,
    ...elevation.card,
  },
  cardName: { ...typography.body, fontWeight: '700' },
  cardMeta: { ...typography.caption, marginTop: 2 },
  cardAmount: { ...typography.amountSecondary, marginTop: spacing.sm },
  cardExtra: { fontSize: 11, fontWeight: '700', color: '#FFFFFF', marginTop: spacing.xs },
  goalRow: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  goalBarTrack: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceSecondary, overflow: 'hidden' },
  goalBarFill: { height: 5, borderRadius: 3, backgroundColor: colors.success },
  goalText: { ...typography.caption, marginTop: 3 },
  goalAddLink: { marginTop: spacing.xs, paddingHorizontal: spacing.xs },
  goalAddLinkText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  removeButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  removeButtonText: { ...typography.body, fontWeight: '700', color: colors.danger },
});
