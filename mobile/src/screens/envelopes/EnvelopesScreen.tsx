import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { cached } from '../../state/cache';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';
import { formatDh } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

/**
 * Enveloppes — combine les 2 logiques distinctes sans les confondre :
 * SavingsPocket = "enveloppe permanente" (objectif/mensualité libres),
 * Provision = "plan à échéances" (recalcul dynamique) — plus le résumé
 * Santé/Mutuelle, jamais un revenu projeté avant clôture. Reset visuel :
 * accent bleu (plans à échéances) / teal (réserves permanentes) réellement
 * porté par la carte (bandeau + badge), jamais confiné à la seule barre de
 * progression comme avant. `cached()` évite de refetcher à chaque focus ;
 * le calcul de suffisance par provision reste parallélisé (Promise.all,
 * déjà correct ici avant cette passe).
 */
export function EnvelopesScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
  const { columns } = useResponsiveLayout();
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

  const cardWidthStyle = columns > 1 ? { width: `${100 / columns - 2}%` as const } : { width: '100%' as const };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: spacing.lg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />}
    >
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
            <TouchableOpacity
              key={provision.id}
              testID={`envelope-card-provision-${provision.id}`}
              style={[styles.card, cardWidthStyle]}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: provision.id })}
            >
              <View style={[styles.cardAccent, { backgroundColor: colors.v6Blue }]} />
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.cardTitle}>{provision.name}</Text>
                  {/* Convergence V6 §5 — une enveloppe est UNIQUEMENT une
                      réserve d'argent : jamais le mot "Plan financier"
                      (concept désormais distinct, cf. Plans financiers). */}
                  <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Réserve à échéances</Text>
                </View>
                <View style={[styles.cardRight, { backgroundColor: colors.v6BlueSoft }]}>
                  <Text style={[styles.cardRightValue, { color: colors.v6Blue }]}>{view.percent}%</Text>
                  <Text style={styles.cardRightLabel}>constitué</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: colors.v6Blue }]} />
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
          );
        })}

        {pockets.map((pocket) => {
          const view = computePocketCardView(pocket);
          const accountName = pocket.linkedAccountId ? accountNameById[pocket.linkedAccountId] : undefined;
          return (
            <TouchableOpacity
              key={pocket.id}
              testID={`envelope-card-pocket-${pocket.id}`}
              style={[styles.card, cardWidthStyle]}
              onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'savings_pocket', id: pocket.id })}
            >
              <View style={[styles.cardAccent, { backgroundColor: colors.v6Teal }]} />
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.cardTitle}>{pocket.name}</Text>
                  <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Réserve permanente</Text>
                </View>
                <View style={[styles.cardRight, { backgroundColor: colors.v6TealSoft }]}>
                  <Text style={[styles.cardRightValue, { color: colors.v6Teal }]}>{view.percent}%</Text>
                  <Text style={styles.cardRightLabel}>{view.status === 'sans_objectif' ? '' : 'objectif'}</Text>
                </View>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${view.percent}%`, backgroundColor: colors.v6Teal }]} />
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
          );
        })}
      </View>

      {/* Convergence V6 §11 — Santé/Mutuelle n'est JAMAIS l'enveloppe principale
          du système : ce n'est pas une carte "enveloppe" (progress bar +
          4 métriques pleine largeur), mais une entrée secondaire compacte,
          affichée qu'il y ait ou non de vraies enveloppes, sans jamais
          dominer l'écran ni se substituer à l'état vide ci-dessous. */}
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
  container: { flex: 1, backgroundColor: colors.v6Bg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.7, color: colors.v6Text },
  pageSubtitle: { marginTop: 5, fontSize: 13, color: colors.v6Muted },
  headerActionButton: { backgroundColor: colors.v6Navy, borderRadius: radius.pill, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2 },
  headerActionButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    paddingTop: spacing.md + 2 + 3,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...elevation.card,
  },
  cardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' },
  cardHeadLeft: { flexShrink: 1 },
  cardTitle: { fontSize: 15, fontWeight: '850' as any, color: colors.v6Text },
  cardSubtitle: { fontSize: 10, color: colors.v6Muted, marginTop: 3 },
  cardRight: { alignItems: 'center', borderRadius: radius.md, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  cardRightValue: { fontSize: 14, fontWeight: '800' },
  cardRightLabel: { fontSize: 9, color: colors.v6Muted, marginTop: 1 },
  progressTrack: { marginTop: spacing.sm + 4, height: 8, borderRadius: 999, backgroundColor: colors.v6SurfaceSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.sm + 4 },
  metric: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.v6Surface, borderWidth: 1, borderColor: colors.v6Line, borderRadius: radius.md, padding: spacing.sm + 2 },
  metricLabel: { fontSize: 10, color: colors.v6Muted },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.v6Text, marginTop: 4 },
  mutuelleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  mutuelleIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.v6AmberSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutuelleIconText: { fontSize: 16, fontWeight: '800', color: colors.v6Amber },
  mutuelleTextCol: { flex: 1 },
  mutuelleTitle: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  mutuelleSubtitle: { fontSize: 11, color: colors.v6Muted, marginTop: 2 },
  mutuelleAmount: { fontSize: 12, fontWeight: '700', color: colors.v6Text },
  emptyState: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.md },
  empty: { textAlign: 'center', color: colors.v6Muted, fontSize: 13 },
  emptyCta: { backgroundColor: colors.v6Blue, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 20 },
  emptyCtaText: { color: '#fff', fontWeight: '700', fontSize: 13 },
});
