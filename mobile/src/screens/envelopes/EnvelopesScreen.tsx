import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { cached } from '../../state/cache';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { formatDh } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

/**
 * Reset design (§2/§3/§7) — CHAQUE sous-compte a une vraie identité visuelle
 * (besoin utilisateur -> nouvelle composition, pas l'ancienne grille de
 * cartes carrées recolorée) : pastille + nom, GRAND solde disponible en
 * premier ("4 500 DH disponibles"), barre de progression pilule avec le %
 * intégré, puis Objectif/Reste en paire compacte, puis "Voir →" — exactement
 * l'ordre demandé. Logique/hooks/appels réseau inchangés.
 */
export function EnvelopesScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
  const [loading, setLoading] = useState(true);
  const [accountNameById, setAccountNameById] = useState<Record<string, string>>({});
  const [pockets, setPockets] = useState<any[]>([]);
  const [provisionCards, setProvisionCards] = useState<Array<{ provision: any; sufficiency: any }>>([]);
  const [claimsSummary, setClaimsSummary] = useState<{ pendingCount: number; totalEngaged: number; totalReimbursed: number } | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [accounts, pocketList, provisionList, claims] = await Promise.all([
        cached('accounts', () => api.listAccounts(), undefined, force),
        cached('pockets', () => api.listPockets(), undefined, force),
        cached('provisions', () => api.listProvisions(), undefined, force),
        cached('medicalClaims', () => api.listMedicalClaims(), undefined, force),
      ]);
      setAccountNameById(Object.fromEntries(accounts.map((a: any) => [a.id, a.name])));
      setPockets(pocketList);
      const withSufficiency = await Promise.all(
        provisionList.map(async (p: any) => ({
          provision: p,
          sufficiency: await cached(`provisionSufficiency:${p.id}`, () => api.getProvisionSufficiency(p.id), undefined, force),
        })),
      );
      setProvisionCards(withSufficiency);
      setClaimsSummary(claims.summary);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: spacing.lg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={colors.v6Navy} />}
    >
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>Enveloppes</Text>
        <TouchableOpacity testID="envelopes-add" style={styles.addButton} onPress={() => navigation.navigate('CreatePocket')}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text style={styles.pageSubtitle}>Réserves et plans financiers.</Text>

      <View style={styles.stack}>
        {provisionCards.map(({ provision, sufficiency }) => {
          const view = computeProvisionCardView(sufficiency);
          const accountName = provision.linkedAccountId ? accountNameById[provision.linkedAccountId] : undefined;
          return (
            <EnvelopeCard
              key={provision.id}
              testID={`envelope-card-provision-${provision.id}`}
              name={provision.name}
              subtitle={accountName ? `${accountName} · plan à échéances` : 'Plan à échéances'}
              icon="flag-outline"
              accent={colors.v6Blue}
              accentSoft={colors.v6BlueSoft}
              available={toNum(sufficiency.currentAmount)}
              target={view.hasOpenSteps ? view.nextAmount : null}
              targetLabel="Prochaine échéance"
              percent={view.percent}
              remaining={view.hasOpenSteps ? Math.max(0, view.nextAmount - toNum(sufficiency.currentAmount)) : null}
              footNote={view.nextDueDate ? new Date(view.nextDueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : undefined}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: provision.id })}
            />
          );
        })}

        {pockets.map((pocket) => {
          const view = computePocketCardView(pocket);
          const accountName = pocket.linkedAccountId ? accountNameById[pocket.linkedAccountId] : undefined;
          return (
            <EnvelopeCard
              key={pocket.id}
              testID={`envelope-card-pocket-${pocket.id}`}
              name={pocket.name}
              subtitle={accountName ? `${accountName} · réserve permanente` : 'Réserve permanente'}
              icon="wallet-outline"
              accent={colors.v6Teal}
              accentSoft={colors.v6TealSoft}
              available={toNum(pocket.currentAmount)}
              target={pocket.targetAmount ? toNum(pocket.targetAmount) : null}
              targetLabel="Objectif"
              percent={view.percent}
              remaining={pocket.targetAmount ? Math.max(0, toNum(pocket.targetAmount) - toNum(pocket.currentAmount)) : null}
              footNote={pocket.monthlyContribution ? `${formatDh(toNum(pocket.monthlyContribution))}/mois` : undefined}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
            />
          );
        })}
      </View>

      {claimsSummary && (
        <TouchableOpacity testID="envelope-card-mutuelle" style={styles.mutuelleRow} onPress={() => navigation.navigate('MedicalClaims')}>
          <View style={styles.mutuelleIcon}>
            <Ionicons name="medkit-outline" size={16} color={colors.v6Amber} />
          </View>
          <View style={styles.mutuelleTextCol}>
            <Text style={styles.mutuelleTitle}>Suivi mutuelle</Text>
            <Text style={styles.mutuelleSubtitle}>
              {claimsSummary.pendingCount > 0 ? `${claimsSummary.pendingCount} dossier(s) en attente` : 'À jour — aucun dossier en attente'}
            </Text>
          </View>
          <Text style={styles.mutuelleAmount}>{formatDh(claimsSummary.totalReimbursed)}</Text>
        </TouchableOpacity>
      )}

      {!loading && pockets.length === 0 && provisionCards.length === 0 && (
        <View style={styles.emptyState}>
          <Text style={styles.empty}>Aucune enveloppe pour l'instant.</Text>
          <TouchableOpacity testID="envelopes-empty-create" style={styles.emptyCta} onPress={() => navigation.navigate('CreatePocket')}>
            <Text style={styles.emptyCtaText}>Créer une enveloppe</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

function EnvelopeCard({
  testID,
  name,
  subtitle,
  icon,
  accent,
  accentSoft,
  available,
  target,
  targetLabel,
  percent,
  remaining,
  footNote,
  onPress,
}: {
  testID: string;
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
  accentSoft: string;
  available: number;
  target: number | null;
  targetLabel: string;
  percent: number;
  remaining: number | null;
  footNote?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity testID={testID} style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHead}>
        <View style={[styles.cardIcon, { backgroundColor: accentSoft }]}>
          <Ionicons name={icon} size={17} color={accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.cardName} numberOfLines={1}>
            {name.toUpperCase()}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
      </View>

      <Text style={styles.cardBalance}>{formatDh(available)}</Text>
      <Text style={styles.cardBalanceCaption}>disponibles</Text>

      {target !== null && (
        <>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: accent }]} />
          </View>
          <View style={styles.progressLabelRow}>
            <Text style={[styles.progressPercent, { color: accent }]}>{percent}%</Text>
            {footNote && <Text style={styles.cardFootnote}>{footNote}</Text>}
          </View>

          <View style={styles.statPairRow}>
            <View style={styles.statPair}>
              <Text style={styles.statLabel}>{targetLabel}</Text>
              <Text style={styles.statValue}>{formatDh(target)}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statPair}>
              <Text style={styles.statLabel}>Reste</Text>
              <Text style={styles.statValue}>{remaining !== null ? formatDh(remaining) : '—'}</Text>
            </View>
          </View>
        </>
      )}

      <View style={styles.cardFoot}>
        <Text style={[styles.seeLink, { color: accent }]}>Voir →</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  pageTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6, color: colors.v6Text },
  pageSubtitle: { fontSize: 13, color: colors.v6Muted, marginBottom: spacing.lg },
  addButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.v6Navy, alignItems: 'center', justifyContent: 'center', ...elevation.card },

  stack: { gap: spacing.md },
  card: {
    backgroundColor: colors.v6Surface,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    ...elevation.card,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, marginBottom: spacing.sm + 2 },
  cardIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3, color: colors.v6Text },
  cardSubtitle: { fontSize: 10, color: colors.v6Muted, marginTop: 1 },

  cardBalance: { fontSize: 30, fontWeight: '900', letterSpacing: -0.8, color: colors.v6Text },
  cardBalanceCaption: { fontSize: 11, color: colors.v6Muted, marginTop: -2, marginBottom: spacing.sm + 4 },

  progressTrack: { height: 8, borderRadius: 999, backgroundColor: colors.v6SurfaceSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  progressPercent: { fontSize: 12, fontWeight: '800' },
  cardFootnote: { fontSize: 10, color: colors.v6Muted },

  statPairRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm + 4 },
  statPair: { flex: 1 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.v6Line, marginHorizontal: spacing.sm + 2 },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.v6Muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  statValue: { fontSize: 14, fontWeight: '800', color: colors.v6Text, marginTop: 2 },

  cardFoot: { alignItems: 'flex-end', marginTop: spacing.sm + 2 },
  seeLink: { fontSize: 12, fontWeight: '800' },

  mutuelleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.v6Surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
    ...elevation.card,
  },
  mutuelleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.v6AmberSoft, alignItems: 'center', justifyContent: 'center' },
  mutuelleTextCol: { flex: 1 },
  mutuelleTitle: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  mutuelleSubtitle: { fontSize: 11, color: colors.v6Muted, marginTop: 2 },
  mutuelleAmount: { fontSize: 12, fontWeight: '700', color: colors.v6Text },
  emptyState: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
  empty: { textAlign: 'center', color: colors.v6Muted, fontSize: 13 },
  emptyCta: { backgroundColor: colors.v6Blue, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
