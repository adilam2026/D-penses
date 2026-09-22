import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useResponsiveLayout } from '../../ui/useResponsiveLayout';
import { formatDh } from '../../ui/formatMoney';
import { computePocketCardView, computeProvisionCardView, toNum } from './envelopesLogic';

/**
 * Refonte maquette V6B §6 — version COMPACTE de l'onglet Enveloppes (jamais de
 * grand donut/anneau ici, réservé à l'écran Plan financier). Combine les 2
 * logiques distinctes (§7) sans les confondre : SavingsPocket = "enveloppe
 * permanente" (objectif/mensualité libres), Provision = "plan à échéances"
 * (recalcul dynamique, cf. envelopesLogic.computeProvisionCardView) — plus le
 * résumé Santé/Mutuelle (§10), jamais un revenu projeté avant clôture.
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accounts, pocketList, provisionList, claims] = await Promise.all([
        api.listAccounts(),
        api.listPockets(),
        api.listProvisions(),
        api.listMedicalClaims(),
      ]);
      setAccountNameById(Object.fromEntries(accounts.map((a: any) => [a.id, a.name])));
      setPockets(pocketList);
      const withSufficiency = await Promise.all(
        provisionList.map(async (p: any) => ({ provision: p, sufficiency: await api.getProvisionSufficiency(p.id) })),
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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.pageTitle}>Enveloppes</Text>
          <Text style={styles.pageSubtitle}>Réserves et plans financiers.</Text>
        </View>
        <TouchableOpacity testID="envelopes-add" onPress={() => navigation.navigate('CreatePocket')}>
          <Text style={styles.headerAction}>Ajouter</Text>
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
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.cardTitle}>{provision.name}</Text>
                  <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Plan financier</Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardRightValue}>{view.percent}%</Text>
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
              {toNum(sufficiency.versementMensuelRecommande) > 0 && (
                <Text style={styles.note}>Cotisation recalculée après un versement inférieur au montant prévu.</Text>
              )}
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
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.cardTitle}>{pocket.name}</Text>
                  <Text style={styles.cardSubtitle}>{accountName ? `${accountName} • ` : ''}Réserve permanente</Text>
                </View>
                <View style={styles.cardRight}>
                  <Text style={styles.cardRightValue}>{view.percent}%</Text>
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

        {claimsSummary && (
          <TouchableOpacity
            testID="envelope-card-mutuelle"
            style={[styles.card, cardWidthStyle]}
            onPress={() => navigation.navigate('MedicalClaims')}
          >
            <View style={styles.cardHead}>
              <View style={styles.cardHeadLeft}>
                <Text style={styles.cardTitle}>Santé / Mutuelle</Text>
                <Text style={styles.cardSubtitle}>Dossiers de remboursement</Text>
              </View>
              <View style={styles.cardRight}>
                <Text style={styles.cardRightValue}>{claimsSummary.pendingCount}</Text>
                <Text style={styles.cardRightLabel}>dossiers</Text>
              </View>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${claimsSummary.totalEngaged > 0 ? Math.round((claimsSummary.totalReimbursed / claimsSummary.totalEngaged) * 100) : 0}%`,
                    backgroundColor: colors.v6Gold,
                  },
                ]}
              />
            </View>
            <View style={styles.metricsRow}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Engagé</Text>
                <Text style={styles.metricValue}>{formatDh(claimsSummary.totalEngaged)}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Remboursé</Text>
                <Text style={styles.metricValue}>{formatDh(claimsSummary.totalReimbursed)}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>En attente</Text>
                <Text style={styles.metricValue}>{claimsSummary.pendingCount}</Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>Statut</Text>
                <Text style={styles.metricValue}>{claimsSummary.pendingCount > 0 ? 'À suivre' : 'À jour'}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {!loading && pockets.length === 0 && provisionCards.length === 0 && (
        <Text style={styles.empty}>Aucune enveloppe pour l'instant.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.7, color: colors.v6Text },
  pageSubtitle: { marginTop: 5, fontSize: 13, color: colors.v6Muted },
  headerAction: { color: colors.v6Blue, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  card: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    ...elevation.card,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' },
  cardHeadLeft: { flexShrink: 1 },
  cardTitle: { fontSize: 15, fontWeight: '850' as any, color: colors.v6Text },
  cardSubtitle: { fontSize: 10, color: colors.v6Muted, marginTop: 3 },
  cardRight: { alignItems: 'flex-end' },
  cardRightValue: { fontSize: 14, fontWeight: '800', color: colors.v6Text },
  cardRightLabel: { fontSize: 10, color: colors.v6Muted, marginTop: 2 },
  progressTrack: { marginTop: spacing.sm + 4, height: 8, borderRadius: 999, backgroundColor: colors.v6SurfaceSoft, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2, marginTop: spacing.sm + 4 },
  metric: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.v6Surface, borderWidth: 1, borderColor: colors.v6Line, borderRadius: radius.md, padding: spacing.sm + 2 },
  metricLabel: { fontSize: 10, color: colors.v6Muted },
  metricValue: { fontSize: 13, fontWeight: '700', color: colors.v6Text, marginTop: 4 },
  note: { marginTop: spacing.sm + 2, padding: spacing.sm + 3, borderRadius: radius.md, backgroundColor: colors.v6SurfaceSoft, color: '#5E6C7F', fontSize: 11 },
  empty: { textAlign: 'center', color: colors.v6Muted, marginTop: spacing.xl, fontSize: 13 },
});
