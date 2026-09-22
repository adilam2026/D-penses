import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Donut } from '../../ui/Donut';
import { formatDh, formatFullDate } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

type Kind = 'savings_pocket' | 'provision';

/**
 * Refonte maquette V6B §7/§8 — détail d'une enveloppe. Pour un plan à échéances
 * (Provision), reproduit l'écran "Plan" de la maquette (anneau + métriques) —
 * le recalcul dynamique (§8) est déjà entièrement produit par
 * computeProvisionSufficiency côté backend (jamais dupliqué ici, uniquement
 * affiché). Pour une enveloppe permanente (SavingsPocket), permet un
 * versement réel direct (jamais une écriture planifiée silencieuse).
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
        <PocketDetail pocket={pocket} accountName={accountName} />
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
  const reste = view.hasOpenSteps ? Math.max(0, toNum(sufficiency.steps[0].cumulativeNeed) - toNum(sufficiency.currentAmount)) : 0;
  return (
    <View>
      <Text style={styles.title}>{pocket.name}</Text>
      <Text style={styles.subtitle}>{accountName ? `${accountName} • ` : ''}Plan financier</Text>

      {view.hasOpenSteps && (
        <View style={styles.headlineCard}>
          <View style={styles.headlineTop}>
            <View>
              <Text style={styles.headlineLabel}>Échéance du {formatFullDate(view.nextDueDate!)}</Text>
              <Text style={styles.headlineSub}>Objectif principal</Text>
            </View>
            <Text style={styles.headlineAmount}>{formatDh(view.nextAmount)}</Text>
          </View>
          <View style={styles.ringRow}>
            <Donut size={100} pct={view.percent} warn={view.percent < 50} />
            <View style={styles.ringMetrics}>
              <Metric label="Disponible" value={formatDh(toNum(sufficiency.currentAmount))} />
              <Metric label="Reste" value={formatDh(reste)} />
              <Metric label="Mensualité recommandée" value={formatDh(toNum(sufficiency.versementMensuelRecommande))} />
            </View>
          </View>
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

function PocketDetail({ pocket, accountName }: { pocket: any; accountName: string | null }) {
  const view = computePocketCardView(pocket);
  return (
    <View>
      <Text style={styles.title}>{pocket.name}</Text>
      <Text style={styles.subtitle}>{accountName ? `${accountName} • ` : ''}Réserve permanente</Text>
      <View style={styles.headlineCard}>
        <View style={styles.ringRow}>
          <Donut size={100} pct={view.percent} warn={false} />
          <View style={styles.ringMetrics}>
            <Metric label="Disponible" value={formatDh(toNum(pocket.currentAmount))} />
            <Metric label="Objectif" value={pocket.targetAmount ? formatDh(toNum(pocket.targetAmount)) : '—'} />
            <Metric label="Mensuel" value={pocket.monthlyContribution ? formatDh(toNum(pocket.monthlyContribution)) : '—'} />
            <Metric label="Statut" value={view.statusLabel} />
          </View>
        </View>
      </View>
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
