import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { cached } from '../../state/cache';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';
import { webColors, webElevation, webRadius, webSpacing } from '../../web/webTheme';
import { formatDh } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

const MAX_WIDTH = 1360;

function formatDayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

/**
 * Correction modèle fonctionnel §1/§8/§9/§11 — même vocabulaire et mêmes
 * trois présentations de carte que le mobile (avec objectif / sans objectif
 * / adossée à un plan financier), grille responsive 2-3 colonnes déjà en
 * place (useResponsiveLayout) : le contenu enrichi (Besoin/Reste/Recommandé,
 * CTA "Définir un objectif") comble le vide constaté en desktop.
 */
export function EnvelopesScreen() {
  const navigation = useNavigation<any>();
  const { columns } = useResponsiveLayout();
  const gridColumns = Math.max(columns, 2);
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

  if (loading && pockets.length === 0 && provisionCards.length === 0 && !claimsSummary) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={webColors.navy} />
      </View>
    );
  }

  const cellStyle = { flexBasis: `${100 / gridColumns}%` as const, maxWidth: `${100 / gridColumns}%` as const };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.headerRow}>
        <Text style={styles.pageTitle}>Sous-comptes</Text>
        <TouchableOpacity testID="envelopes-add" style={styles.addButton} onPress={() => navigation.navigate('CreatePocket')}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addButtonText}>Ajouter</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.pageSubtitle}>Une part de votre argent, mise de côté sans jamais quitter le compte.</Text>

      <View style={styles.grid}>
        {provisionCards.map(({ provision, sufficiency }) => {
          const view = computeProvisionCardView(sufficiency);
          const accountName = provision.linkedAccountId ? accountNameById[provision.linkedAccountId] : undefined;
          const remaining = view.hasOpenSteps ? Math.max(0, view.need - toNum(sufficiency.currentAmount)) : 0;
          return (
            <View key={provision.id} style={[styles.cell, cellStyle]}>
              <TouchableOpacity
                testID={`envelope-card-provision-${provision.id}`}
                style={styles.card}
                onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: provision.id })}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.cardIcon, { backgroundColor: webColors.blueSoft }]}>
                    <Ionicons name="flag-outline" size={15} color={webColors.blue} />
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
                  <Text style={[styles.seeLink, { color: webColors.blue }]}>Voir le plan →</Text>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
        {pockets.map((pocket) => {
          const view = computePocketCardView(pocket);
          const accountName = pocket.linkedAccountId ? accountNameById[pocket.linkedAccountId] : undefined;
          const hasTarget = !!pocket.targetAmount;
          const remaining = hasTarget ? Math.max(0, toNum(pocket.targetAmount) - toNum(pocket.currentAmount)) : 0;
          return (
            <View key={pocket.id} style={[styles.cell, cellStyle]}>
              <TouchableOpacity
                testID={`envelope-card-pocket-${pocket.id}`}
                style={styles.card}
                onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
              >
                <View style={styles.cardHead}>
                  <View style={[styles.cardIcon, { backgroundColor: webColors.tealSoft }]}>
                    <Ionicons name="wallet-outline" size={15} color={webColors.teal} />
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
                      <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: webColors.teal }]} />
                    </View>
                    <Text style={[styles.progressPercent, { color: webColors.teal }]}>Progression {view.percent}%</Text>

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
                    <Ionicons name="flag-outline" size={12} color={webColors.teal} />
                    <Text style={styles.defineGoalText}>Définir un objectif</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.cardFoot}>
                  <Text style={[styles.seeLink, { color: webColors.teal }]}>Voir →</Text>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {claimsSummary && (
        <TouchableOpacity testID="envelope-card-mutuelle" style={styles.mutuelleRow} onPress={() => navigation.navigate('MedicalClaims')}>
          <View style={styles.mutuelleIcon}>
            <Ionicons name="medkit-outline" size={15} color={webColors.amber} />
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
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: webColors.textPrimary },
  pageSubtitle: { fontSize: 13, color: webColors.textSecondary, marginTop: 4, marginBottom: webSpacing.lg },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: webColors.navy, borderRadius: webRadius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', marginHorizontal: -(webSpacing.sm / 2) },
  cell: { paddingHorizontal: webSpacing.sm / 2, marginBottom: webSpacing.md },
  card: { backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.lg, padding: webSpacing.md, ...webElevation.card },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm, marginBottom: webSpacing.sm },
  cardIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  cardName: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3, color: webColors.textPrimary },
  cardSubtitle: { fontSize: 10, color: webColors.textSecondary, marginTop: 1 },

  cardBalance: { fontSize: 26, fontWeight: '900', letterSpacing: -0.6, color: webColors.textPrimary },
  cardBalanceCaption: { fontSize: 10, color: webColors.textSecondary, marginTop: -2, marginBottom: webSpacing.sm + 2 },

  progressTrack: { height: 7, borderRadius: 999, backgroundColor: webColors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  progressPercent: { fontSize: 11, fontWeight: '800', marginTop: 5 },

  planBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: webSpacing.sm },
  planBadge: { backgroundColor: webColors.blueSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  planBadgeText: { fontSize: 9, fontWeight: '800', color: webColors.blue, textTransform: 'uppercase' },
  cardFootnote: { fontSize: 10, color: webColors.textSecondary },

  statPairRow: { flexDirection: 'row', alignItems: 'center', marginTop: webSpacing.sm },
  statPair: { flex: 1 },
  statDivider: { width: 1, height: 24, backgroundColor: webColors.border, marginHorizontal: webSpacing.sm },
  statLabel: { fontSize: 9, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  statValue: { fontSize: 13, fontWeight: '800', color: webColors.textPrimary, marginTop: 2 },
  recommendedText: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, marginTop: webSpacing.sm },

  defineGoalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: webColors.tealSoft,
    borderRadius: webRadius.md,
    paddingVertical: 8,
  },
  defineGoalText: { fontSize: 11, fontWeight: '800', color: webColors.teal },

  cardFoot: { alignItems: 'flex-end', marginTop: webSpacing.sm },
  seeLink: { fontSize: 11, fontWeight: '800' },

  mutuelleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: webColors.surface,
    borderWidth: 1,
    borderColor: webColors.border,
    borderRadius: webRadius.lg,
    paddingVertical: webSpacing.sm + 4,
    paddingHorizontal: webSpacing.md,
    marginTop: webSpacing.sm,
    gap: webSpacing.sm,
    maxWidth: 480,
  },
  mutuelleIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: webColors.amberSoft, alignItems: 'center', justifyContent: 'center' },
  mutuelleTextCol: { flex: 1 },
  mutuelleTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  mutuelleSubtitle: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  mutuelleAmount: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary },
  emptyState: { alignItems: 'flex-start', marginTop: webSpacing.xl, gap: webSpacing.md },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  emptyCta: { backgroundColor: webColors.blue, borderRadius: webRadius.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
