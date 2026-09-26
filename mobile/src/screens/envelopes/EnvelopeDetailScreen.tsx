import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Donut } from '../../ui/Donut';
import { formatDh, formatFullDate, formatMonthLabel } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

type Kind = 'savings_pocket' | 'provision';

/**
 * Correction modèle fonctionnel §1/§8 — détail d'un SOUS-COMPTE. Un Provision
 * (plan à échéances) est présenté à l'utilisateur comme "Plan financier"
 * (jamais "Réserve à échéances", ancien vocabulaire) avec Besoin/Reste/
 * Recommandé/Prochaine échéance — même modèle que la carte sous-compte
 * (EnvelopesScreen). Un SavingsPocket sans objectif propose une action
 * claire "Définir un objectif" (updatePocket), jamais un tiret muet. Le
 * recalcul dynamique reste entièrement produit par
 * computeProvisionSufficiency côté backend (jamais dupliqué ici, uniquement
 * affiché) ; le versement réel direct reste une écriture immédiate, jamais
 * planifiée silencieusement.
 */
export function EnvelopeDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { kind, id } = route.params as { kind: Kind; id: string };
  const top = useTopInset();
  const bottom = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [loading, setLoading] = useState(true);
  const [pocket, setPocket] = useState<any>(null);
  const [sufficiency, setSufficiency] = useState<any>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [settingGoal, setSettingGoal] = useState(false);
  const [goalAmount, setGoalAmount] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (kind === 'savings_pocket') {
        const p = await api.getPocket(id);
        setPocket(p);
        if (p.linkedAccountId) {
          const accounts = await api.listAccounts();
          setAccountName(accounts.find((a: any) => a.id === p.linkedAccountId)?.name ?? null);
        }
      } else {
        const [p, s] = await Promise.all([api.getProvision(id), api.getProvisionSufficiency(id)]);
        setPocket(p);
        setSufficiency(s);
        if (p.linkedAccountId) {
          const accounts = await api.listAccounts();
          setAccountName(accounts.find((a: any) => a.id === p.linkedAccountId)?.name ?? null);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onVerser = async () => {
    const numeric = Number(amount.replace(',', '.'));
    if (!numeric || numeric <= 0) return;
    setSubmitting(true);
    try {
      if (kind === 'savings_pocket') {
        await api.contributePocket(id, { amount: numeric, confirmed: true });
      } else {
        await api.contributeProvision(id, { amount: numeric, confirmed: true });
      }
      setAmount('');
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const onSaveGoal = async () => {
    const numeric = Number(goalAmount.replace(',', '.'));
    if (!numeric || numeric <= 0) return;
    setSavingGoal(true);
    try {
      await api.updatePocket(id, { targetAmount: numeric });
      setGoalAmount('');
      setSettingGoal(false);
      await load();
    } finally {
      setSavingGoal(false);
    }
  };

  if (loading && !pocket) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.v6Navy} />
      </View>
    );
  }
  if (!pocket) return null;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Retour</Text>
      </TouchableOpacity>

      {kind === 'provision' ? (
        <ProvisionDetail pocket={pocket} sufficiency={sufficiency} accountName={accountName} />
      ) : (
        <PocketDetail
          pocket={pocket}
          accountName={accountName}
          settingGoal={settingGoal}
          goalAmount={goalAmount}
          savingGoal={savingGoal}
          onStartGoal={() => setSettingGoal(true)}
          onChangeGoalAmount={setGoalAmount}
          onSaveGoal={onSaveGoal}
          onFocusGoalInput={handleFocus}
        />
      )}

      <View style={styles.contributeCard} testID="envelope-contribute-card">
        <Text style={styles.contributeTitle}>Verser un montant</Text>
        <View style={styles.contributeRow}>
          <TextInput
            testID="envelope-contribute-amount"
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="Montant en DH"
            placeholderTextColor={colors.v6Muted}
            value={amount}
            onChangeText={setAmount}
            onFocus={handleFocus}
          />
          <TouchableOpacity
            testID="envelope-contribute-submit"
            style={[styles.contributeButton, (!amount || submitting) && styles.contributeButtonDisabled]}
            disabled={!amount || submitting}
            onPress={onVerser}
          >
            <Text style={styles.contributeButtonText}>Verser</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );
}

function ProvisionDetail({ pocket, sufficiency, accountName }: { pocket: any; sufficiency: any; accountName: string | null }) {
  if (!sufficiency) return null;
  const view = computeProvisionCardView(sufficiency);
  const reste = view.hasOpenSteps ? Math.max(0, view.need - toNum(sufficiency.currentAmount)) : 0;
  return (
    <View>
      <Text style={styles.title}>{pocket.name}</Text>
      {/* Correction modèle fonctionnel §8 — un Provision se présente à
          l'utilisateur comme "Plan financier" (même vocabulaire que la
          carte sous-compte d'EnvelopesScreen), jamais "Réserve à échéances". */}
      <Text style={styles.subtitle}>{accountName ? `${accountName} • ` : ''}Plan financier</Text>

      {view.hasOpenSteps && (
        <View style={styles.headlineCard}>
          <View style={styles.headlineTop}>
            <View>
              <Text style={styles.headlineLabel}>Prochaine échéance</Text>
              <Text style={styles.headlineSub}>{formatFullDate(view.nextDueDate!)}</Text>
            </View>
            <Text style={styles.headlineAmount}>{formatDh(view.nextAmount)}</Text>
          </View>
          <View style={styles.ringRow}>
            <Donut size={100} pct={view.percent} warn={view.percent < 50} />
            <View style={styles.ringMetrics}>
              <Metric label="Disponible" value={formatDh(toNum(sufficiency.currentAmount))} />
              <Metric label="Besoin" value={formatDh(view.need)} />
              <Metric label="Reste à constituer" value={formatDh(reste)} />
              {view.recommendedMonthly > 0 && <Metric label="Recommandé" value={`${formatDh(view.recommendedMonthly)}/mois`} />}
            </View>
          </View>
        </View>
      )}

      {Array.isArray(sufficiency.monthlyCalendar) && sufficiency.monthlyCalendar.length > 0 && (
        <View style={styles.calendarCard} testID="provision-monthly-calendar">
          <Text style={styles.calendarTitle}>Calendrier de versement recommandé</Text>
          {sufficiency.monthlyCalendar.map((m: { month: string; recommendedAmount: number }) => (
            <View key={m.month} style={styles.calendarRow}>
              <Text style={styles.calendarMonth}>{formatMonthLabel(m.month)}</Text>
              <Text style={styles.calendarAmount}>{formatDh(m.recommendedAmount)}</Text>
            </View>
          ))}
        </View>
      )}

      {!view.hasOpenSteps && <Text style={styles.emptyNote}>Aucune échéance en attente pour ce plan.</Text>}

      {sufficiency.tensionAlert && (
        <View style={styles.tensionCard}>
          <Text style={styles.tensionText}>
            Tension : il manquera {formatDh(toNum(sufficiency.tensionAlert.manque))} à l'échéance du {formatFullDate(sufficiency.tensionAlert.dueDate)}.
          </Text>
        </View>
      )}
    </View>
  );
}

function PocketDetail({
  pocket,
  accountName,
  settingGoal,
  goalAmount,
  savingGoal,
  onStartGoal,
  onChangeGoalAmount,
  onSaveGoal,
  onFocusGoalInput,
}: {
  pocket: any;
  accountName: string | null;
  settingGoal: boolean;
  goalAmount: string;
  savingGoal: boolean;
  onStartGoal: () => void;
  onChangeGoalAmount: (v: string) => void;
  onSaveGoal: () => void;
  onFocusGoalInput: (e: any) => void;
}) {
  const view = computePocketCardView(pocket);
  const hasTarget = !!pocket.targetAmount;
  const reste = hasTarget ? Math.max(0, toNum(pocket.targetAmount) - toNum(pocket.currentAmount)) : 0;
  return (
    <View>
      <Text style={styles.title}>{pocket.name}</Text>
      <Text style={styles.subtitle}>{accountName ? `${accountName} • ` : ''}Sous-compte</Text>
      <View style={styles.headlineCard}>
        <View style={styles.ringRow}>
          <Donut size={100} pct={view.percent} warn={false} />
          <View style={styles.ringMetrics}>
            <Metric label="Disponible" value={formatDh(toNum(pocket.currentAmount))} />
            <Metric label="Objectif" value={hasTarget ? formatDh(toNum(pocket.targetAmount)) : '—'} />
            {hasTarget && <Metric label="Reste à constituer" value={formatDh(reste)} />}
            <Metric label="Mensuel" value={pocket.monthlyContribution ? formatDh(toNum(pocket.monthlyContribution)) : '—'} />
            <Metric label="Statut" value={view.statusLabel} />
          </View>
        </View>
      </View>

      {!hasTarget && (
        <View style={styles.goalCard} testID="pocket-define-goal-card">
          {settingGoal ? (
            <>
              <Text style={styles.goalTitle}>Objectif à atteindre</Text>
              <View style={styles.contributeRow}>
                <TextInput
                  testID="pocket-goal-amount"
                  style={styles.input}
                  keyboardType="decimal-pad"
                  placeholder="Montant en DH"
                  placeholderTextColor={colors.v6Muted}
                  value={goalAmount}
                  onChangeText={onChangeGoalAmount}
                  onFocus={onFocusGoalInput}
                />
                <TouchableOpacity
                  testID="pocket-goal-save"
                  style={[styles.contributeButton, (!goalAmount || savingGoal) && styles.contributeButtonDisabled]}
                  disabled={!goalAmount || savingGoal}
                  onPress={onSaveGoal}
                >
                  <Text style={styles.contributeButtonText}>Enregistrer</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity testID="pocket-define-goal-start" style={styles.goalStartButton} onPress={onStartGoal}>
              <Text style={styles.goalStartButtonText}>Définir un objectif</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  back: { color: colors.v6Blue, fontWeight: '800', marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.v6Text },
  subtitle: { fontSize: 13, color: colors.v6Muted, marginTop: 4, marginBottom: spacing.md },
  headlineCard: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...elevation.card,
  },
  headlineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headlineLabel: { fontSize: 14, fontWeight: '800', color: colors.v6Text },
  headlineSub: { fontSize: 11, color: colors.v6Muted, marginTop: 2 },
  headlineAmount: { fontSize: 16, fontWeight: '800', color: colors.v6Red },
  ringRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  ringMetrics: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metric: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.v6SurfaceSoft, borderRadius: radius.md, padding: spacing.sm + 2 },
  metricLabel: { fontSize: 10, color: colors.v6Muted },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.v6Text, marginTop: 4 },
  emptyNote: { color: colors.v6Muted, fontSize: 13, marginTop: spacing.md },
  goalCard: {
    marginTop: spacing.md,
    backgroundColor: colors.v6TealSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  goalTitle: { fontSize: 13, fontWeight: '800', color: colors.v6Text, marginBottom: spacing.sm },
  goalStartButton: { alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  goalStartButtonText: { color: colors.v6Teal, fontWeight: '800', fontSize: 13 },
  calendarCard: {
    marginTop: spacing.md,
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...elevation.card,
  },
  calendarTitle: { fontSize: 13, fontWeight: '800', color: colors.v6Text, marginBottom: spacing.sm },
  calendarRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.v6Line,
  },
  calendarMonth: { fontSize: 12, color: colors.v6Text, fontWeight: '600' },
  calendarAmount: { fontSize: 12, color: colors.v6Text, fontWeight: '800' },
  tensionCard: { marginTop: spacing.md, backgroundColor: colors.v6RedSoft, borderRadius: radius.md, padding: spacing.md },
  tensionText: { color: colors.v6Red, fontSize: 12, fontWeight: '600' },
  contributeCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...elevation.card,
  },
  contributeTitle: { fontSize: 14, fontWeight: '800', color: colors.v6Text, marginBottom: spacing.sm },
  contributeRow: { flexDirection: 'row', gap: spacing.sm },
  input: { flex: 1, borderWidth: 1, borderColor: colors.v6Line, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, color: colors.v6Text },
  contributeButton: { backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  contributeButtonDisabled: { opacity: 0.5 },
  contributeButtonText: { color: '#fff', fontWeight: '800' },
});
