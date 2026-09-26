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

function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/**
 * Correction modèle fonctionnel §1/§8/§9 — "Enveloppes" a disparu du
 * vocabulaire utilisateur : un SOUS-COMPTE est une répartition virtuelle
 * d'une partie de l'argent réellement présent sur un compte bancaire (le
 * solde du compte, lui, ne bouge jamais). Le backend garde ses noms
 * techniques (SavingsPocket/Provision) — seul ce qui est AFFICHÉ change.
 * Trois présentations distinctes selon le sous-compte (§8) : avec objectif,
 * sans objectif (CTA "Définir un objectif"), et adossé à un plan financier à
 * échéances (Besoin/Reste/Recommandé/Prochaine échéance). Le suivi mutuelle
 * (§9) reste structurellement séparé — jamais fusionné avec un sous-compte
 * Santé, qui lui a un solde réel.
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
        <Text style={styles.pageTitle}>Sous-comptes</Text>
        <TouchableOpacity testID="envelopes-add" style={styles.addButton} onPress={() => navigation.navigate('CreatePocket')}>
          <Ionicons name="add" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text style={styles.pageSubtitle}>Une part de votre argent, mise de côté sans jamais quitter le compte.</Text>

      <View style={styles.stack}>
        {provisionCards.map(({ provision, sufficiency }) => {
          const view = computeProvisionCardView(sufficiency);
          const accountName = provision.linkedAccountId ? accountNameById[provision.linkedAccountId] : undefined;
          const remaining = view.hasOpenSteps ? Math.max(0, view.need - toNum(sufficiency.currentAmount)) : 0;
          return (
            <TouchableOpacity
              key={provision.id}
              testID={`envelope-card-provision-${provision.id}`}
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: provision.id })}
            >
              <View style={styles.cardHead}>
                <View style={[styles.cardIcon, { backgroundColor: colors.v6BlueSoft }]}>
                  <Ionicons name="flag-outline" size={17} color={colors.v6Blue} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {provision.name.toUpperCase()}
                  </Text>
                  {accountName && (
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {accountName}
                    </Text>
                  )}
                </View>
              </View>

              <Text style={styles.cardBalance}>{formatDh(toNum(sufficiency.currentAmount))}</Text>
              <Text style={styles.cardBalanceCaption}>disponibles</Text>

              <View style={styles.planBadgeRow}>
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>Plan financier</Text>
                </View>
                {view.nextDueDate && (
                  <Text style={styles.cardFootnote}>Prochaine échéance {formatDayMonth(view.nextDueDate)}</Text>
                )}
              </View>

              {view.hasOpenSteps && (
                <View style={styles.statPairRow}>
                  <View style={styles.statPair}>
                    <Text style={styles.statLabel}>Besoin</Text>
                    <Text style={styles.statValue}>{formatDh(view.need)}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statPair}>
                    <Text style={styles.statLabel}>Reste</Text>
                    <Text style={styles.statValue}>{formatDh(remaining)}</Text>
                  </View>
                </View>
              )}

              {view.recommendedMonthly > 0 && (
                <Text style={styles.recommendedText}>Recommandé {formatDh(view.recommendedMonthly)}/mois</Text>
              )}

              <View style={styles.cardFoot}>
                <Text style={[styles.seeLink, { color: colors.v6Blue }]}>Voir le plan →</Text>
              </View>
            </TouchableOpacity>
          );
        })}

        {pockets.map((pocket) => {
          const view = computePocketCardView(pocket);
          const accountName = pocket.linkedAccountId ? accountNameById[pocket.linkedAccountId] : undefined;
          const hasTarget = !!pocket.targetAmount;
          const remaining = hasTarget ? Math.max(0, toNum(pocket.targetAmount) - toNum(pocket.currentAmount)) : 0;
          return (
            <TouchableOpacity
              key={pocket.id}
              testID={`envelope-card-pocket-${pocket.id}`}
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
            >
              <View style={styles.cardHead}>
                <View style={[styles.cardIcon, { backgroundColor: colors.v6TealSoft }]}>
                  <Ionicons name="wallet-outline" size={17} color={colors.v6Teal} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {pocket.name.toUpperCase()}
                  </Text>
                  {accountName && (
                    <Text style={styles.cardSubtitle} numberOfLines={1}>
                      {accountName}
                    </Text>
                  )}
                </View>
              </View>

              <Text style={styles.cardBalance}>{formatDh(toNum(pocket.currentAmount))}</Text>
              <Text style={styles.cardBalanceCaption}>disponibles</Text>

              {hasTarget ? (
                <>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: colors.v6Teal }]} />
                  </View>
                  <View style={styles.progressLabelRow}>
                    <Text style={[styles.progressPercent, { color: colors.v6Teal }]}>Progression {view.percent}%</Text>
                  </View>
                  <View style={styles.statPairRow}>
                    <View style={styles.statPair}>
                      <Text style={styles.statLabel}>Objectif</Text>
                      <Text style={styles.statValue}>{formatDh(toNum(pocket.targetAmount))}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statPair}>
                      <Text style={styles.statLabel}>Reste à constituer</Text>
                      <Text style={styles.statValue}>{formatDh(remaining)}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <TouchableOpacity
                  testID={`envelope-define-goal-${pocket.id}`}
                  style={styles.defineGoalBtn}
                  onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
                >
                  <Ionicons name="flag-outline" size={13} color={colors.v6Teal} />
                  <Text style={styles.defineGoalText}>Définir un objectif</Text>
                </TouchableOpacity>
              )}

              <View style={styles.cardFoot}>
                <Text style={[styles.seeLink, { color: colors.v6Teal }]}>Voir →</Text>
              </View>
            </TouchableOpacity>
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
          <Text style={styles.empty}>Aucun sous-compte pour l'instant.</Text>
          <TouchableOpacity testID="envelopes-empty-create" style={styles.emptyCta} onPress={() => navigation.navigate('CreatePocket')}>
            <Text style={styles.emptyCtaText}>Créer un sous-compte</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
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

  planBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  planBadge: { backgroundColor: colors.v6BlueSoft, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { fontSize: 10, fontWeight: '800', color: colors.v6Blue, textTransform: 'uppercase', letterSpacing: 0.3 },

  statPairRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm + 4 },
  statPair: { flex: 1 },
  statDivider: { width: 1, height: 28, backgroundColor: colors.v6Line, marginHorizontal: spacing.sm + 2 },
  statLabel: { fontSize: 10, fontWeight: '700', color: colors.v6Muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  statValue: { fontSize: 14, fontWeight: '800', color: colors.v6Text, marginTop: 2 },
  recommendedText: { fontSize: 11, fontWeight: '700', color: colors.v6Muted, marginTop: spacing.sm },

  defineGoalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.v6TealSoft,
    borderRadius: radius.md,
    paddingVertical: 9,
  },
  defineGoalText: { fontSize: 12, fontWeight: '800', color: colors.v6Teal },

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
