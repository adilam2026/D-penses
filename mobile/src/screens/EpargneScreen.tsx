import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { isSanteSubaccount } from '../ui/santeDetection';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { useBottomInset } from '../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

// Dégradés d'enveloppe (maquette « Foyer » 07-Épargne validée) — rotation
// fixe de 4 paires de teintes, jamais une seule couleur plate par carte.
const ENVELOPE_GRADIENTS: [string, string][] = [
  ['#1FA3A3', '#0F6E6E'],
  ['#E2567C', '#B33B61'],
  ['#8E4F97', '#6A3B74'],
  ['#4C5FA6', '#36488A'],
];

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
          <Text style={styles.subtitle}>
            {cards.length} enveloppe{cards.length > 1 ? 's' : ''} · {formatDh(cards.reduce((sum, c) => sum + c.amount, 0))} épargnés
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <TouchableOpacity style={styles.newButton} onPress={() => navigation.navigate('CreateSubaccount')} testID="epargne-new">
            <Text style={styles.newButtonText}>+ Nouvelle</Text>
          </TouchableOpacity>
          <HelpButton
            title="Épargne"
            text="Retrouvez ici tous vos comptes d'épargne ainsi que les enveloppes réservées à l'intérieur de vos comptes courants (voiture, voyage, santé, scolarité…)."
          />
        </View>
      </View>

      {cards.length === 0 ? (
        <Text style={styles.emptyText}>Aucune épargne pour l'instant.</Text>
      ) : (
        <View style={styles.list}>
          {cards.map((card, idx) => {
            const [from, to] = ENVELOPE_GRADIENTS[idx % ENVELOPE_GRADIENTS.length];
            return (
              <TouchableOpacity key={card.key} activeOpacity={0.9} onPress={card.onPress} testID={`epargne-card-${card.key}`}>
                <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
                  <View style={styles.cardTopRow}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {card.name}
                    </Text>
                    {card.goal ? <Text style={styles.cardPercent}>{Math.round(card.goal.percent)}%</Text> : null}
                  </View>
                  <Text style={[typography.amountSecondary, styles.cardAmount]}>
                    {formatDh(card.amount)}
                    {card.goal ? <Text style={styles.cardAmountTarget}> / {formatDh(card.goal.targetAmount)}</Text> : null}
                  </Text>
                  {card.goal ? (
                    <View testID={`epargne-goal-${card.key}`}>
                      <View style={styles.goalBarTrack}>
                        <View style={[styles.goalBarFill, { width: `${Math.min(100, card.goal.percent)}%` }]} />
                      </View>
                      <Text style={[styles.cardMeta, { marginTop: spacing.xs }]}>
                        Objectif {formatDh(card.goal.targetAmount)} · {Math.round(card.goal.percent)}%
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.cardMeta}>{card.meta}</Text>
                  )}
                  {card.extraLine ? <Text style={styles.cardExtra}>{card.extraLine}</Text> : null}
                  {!card.goal ? (
                    <TouchableOpacity
                      style={styles.goalAddLink}
                      onPress={() => setGoalTarget({ accountId: card.accountId, subaccountId: card.subaccountId, name: card.name, goal: null })}
                      testID={`epargne-add-goal-${card.key}`}
                    >
                      <Text style={styles.goalAddLinkText}>+ Définir un objectif</Text>
                    </TouchableOpacity>
                  ) : null}
                </LinearGradient>
              </TouchableOpacity>
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
  // Une carte pleine largeur par enveloppe, dégradé propre (maquette « Foyer »
  // 07-Épargne validée) — pourcentage d'objectif en en-tête, montant en
  // Fraunces, barre de progression blanche translucide DANS la carte.
  list: { gap: spacing.md },
  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...elevation.floating,
  },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { fontSize: 14, fontFamily: fontFamily.sansBold, color: colors.textOnPrimary },
  cardPercent: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.textOnPrimary, opacity: 0.9 },
  cardMeta: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: 'rgba(255,255,255,0.85)', marginTop: spacing.xs },
  cardAmount: { marginTop: 4, color: colors.textOnPrimary },
  cardAmountTarget: { fontSize: 13, fontFamily: fontFamily.sans, color: 'rgba(255,255,255,0.8)' },
  cardExtra: { fontSize: 11, fontFamily: fontFamily.sansBold, color: '#FFFFFF', marginTop: spacing.xs },
  goalBarTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)', overflow: 'hidden', marginTop: spacing.sm },
  goalBarFill: { height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  goalAddLink: { marginTop: spacing.sm },
  goalAddLinkText: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.textOnPrimary, textDecorationLine: 'underline' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.lg },
  submitButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  removeButton: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.sm },
  removeButtonText: { ...typography.body, fontWeight: '700', color: colors.danger },
});
