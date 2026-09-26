import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { cached } from '../../state/cache';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';
import { webColors, webElevation, webRadius, webSpacing } from '../../web/webTheme';
import { formatDh } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

const MAX_WIDTH = 1360;

/**
 * Équivalent Web de EnvelopesScreen.tsx (mêmes 2 logiques, mêmes appels
 * réseau, jamais un dashboard consolidé en plus) — n'existait pas avant
 * cette passe : sur Web, cet écran retombait sur le composant mobile rendu
 * tel quel dans la zone de contenu du shell desktop (colonne étroite au
 * milieu d'un écran large). Ici : grille large à 3 colonnes (comme
 * l'Accueil Web), même accent couleur bleu/teal.
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
        <View>
          <Text style={styles.pageTitle}>Enveloppes</Text>
          <Text style={styles.pageSubtitle}>Réserves et plans financiers.</Text>
        </View>
        <TouchableOpacity testID="envelopes-add" style={styles.headerActionButton} onPress={() => navigation.navigate('CreatePocket')}>
          <Text style={styles.headerActionButtonText}>＋ Ajouter</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {provisionCards.map(({ provision, sufficiency }) => {
          const view = computeProvisionCardView(sufficiency);
          const accountName = provision.linkedAccountId ? accountNameById[provision.linkedAccountId] : undefined;
          return (
            <View key={provision.id} style={[styles.cell, cellStyle]}>
              <TouchableOpacity
                testID={`envelope-card-provision-${provision.id}`}
                style={styles.card}
                onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: provision.id })}
              >
                <View style={[styles.cardAccent, { backgroundColor: webColors.blue }]} />
                <View style={styles.cardHead}>
                  <View style={styles.cardHeadLeft}>
                    <Text style={styles.cardTitle}>{provision.name}</Text>
                    <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Réserve à échéances</Text>
                  </View>
                  <View style={[styles.cardRight, { backgroundColor: webColors.blueSoft }]}>
                    <Text style={[styles.cardRightValue, { color: webColors.blue }]}>{view.percent}%</Text>
                    <Text style={styles.cardRightLabel}>constitué</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: webColors.blue }]} />
                </View>
                <View style={styles.metricsRow}>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Disponible</Text>
                    <Text style={styles.metricValue}>{formatDh(toNum(sufficiency.currentAmount))}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Échéance</Text>
                    <Text style={styles.metricValue}>{view.hasOpenSteps ? formatDh(view.nextAmount) : '—'}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Date</Text>
                    <Text style={styles.metricValue}>
                      {view.nextDueDate ? new Date(view.nextDueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '—'}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>À verser</Text>
                    <Text style={styles.metricValue}>{formatDh(toNum(sufficiency.versementMensuelRecommande))}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}

        {pockets.map((pocket) => {
          const view = computePocketCardView(pocket);
          const accountName = pocket.linkedAccountId ? accountNameById[pocket.linkedAccountId] : undefined;
          return (
            <View key={pocket.id} style={[styles.cell, cellStyle]}>
              <TouchableOpacity
                testID={`envelope-card-pocket-${pocket.id}`}
                style={styles.card}
                onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
              >
                <View style={[styles.cardAccent, { backgroundColor: webColors.teal }]} />
                <View style={styles.cardHead}>
                  <View style={styles.cardHeadLeft}>
                    <Text style={styles.cardTitle}>{pocket.name}</Text>
                    <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Réserve permanente</Text>
                  </View>
                  <View style={[styles.cardRight, { backgroundColor: webColors.tealSoft }]}>
                    <Text style={[styles.cardRightValue, { color: webColors.teal }]}>{view.percent}%</Text>
                    <Text style={styles.cardRightLabel}>{view.status === 'sans_objectif' ? '' : 'objectif'}</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: webColors.teal }]} />
                </View>
                <View style={styles.metricsRow}>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Disponible</Text>
                    <Text style={styles.metricValue}>{formatDh(toNum(pocket.currentAmount))}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Objectif</Text>
                    <Text style={styles.metricValue}>{pocket.targetAmount ? formatDh(toNum(pocket.targetAmount)) : '—'}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Mensuel</Text>
                    <Text style={styles.metricValue}>{pocket.monthlyContribution ? formatDh(toNum(pocket.monthlyContribution)) : '—'}</Text>
                  </View>
                  <View style={styles.metric}>
                    <Text style={styles.metricLabel}>Statut</Text>
                    <Text style={styles.metricValue}>{view.statusLabel}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {claimsSummary && (
        <TouchableOpacity testID="envelope-card-mutuelle" style={styles.mutuelleRow} onPress={() => navigation.navigate('MedicalClaims')}>
          <View style={styles.mutuelleIcon}>
            <Text style={styles.mutuelleIconText}>+</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: webSpacing.lg },
  pageTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, color: webColors.textPrimary },
  pageSubtitle: { marginTop: 4, fontSize: 13, color: webColors.textSecondary },
  headerActionButton: { backgroundColor: webColors.navy, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.lg, paddingVertical: webSpacing.sm + 2 },
  headerActionButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', marginHorizontal: -(webSpacing.sm / 2) },
  cell: { paddingHorizontal: webSpacing.sm / 2, marginBottom: webSpacing.md },
  card: {
    backgroundColor: webColors.surface,
    borderWidth: 1,
    borderColor: webColors.border,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    paddingTop: webSpacing.md + 3,
    overflow: 'hidden',
    ...webElevation.card,
  },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: webSpacing.sm, alignItems: 'flex-start' },
  cardHeadLeft: { flexShrink: 1 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: webColors.textPrimary },
  cardSubtitle: { fontSize: 10, color: webColors.textSecondary, marginTop: 3 },
  cardRight: { alignItems: 'center', borderRadius: webRadius.md, paddingHorizontal: webSpacing.sm, paddingVertical: 4 },
  cardRightValue: { fontSize: 13, fontWeight: '800' },
  cardRightLabel: { fontSize: 9, color: webColors.textSecondary, marginTop: 1 },
  progressTrack: { marginTop: webSpacing.sm + 2, height: 6, borderRadius: 999, backgroundColor: webColors.surfaceMuted, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: webSpacing.sm + 2 },
  metric: { flexBasis: '47%', flexGrow: 1, backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.sm, padding: webSpacing.sm },
  metricLabel: { fontSize: 9, color: webColors.textSecondary },
  metricValue: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary, marginTop: 3 },
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
  mutuelleIconText: { fontSize: 16, fontWeight: '800', color: webColors.amber },
  mutuelleTextCol: { flex: 1 },
  mutuelleTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  mutuelleSubtitle: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  mutuelleAmount: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary },
  emptyState: { alignItems: 'flex-start', marginTop: webSpacing.xl, gap: webSpacing.md },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  emptyCta: { backgroundColor: webColors.blue, borderRadius: webRadius.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
