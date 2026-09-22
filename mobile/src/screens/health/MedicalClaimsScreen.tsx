import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { formatDh, formatShortDate } from '../../ui/formatMoney';

const STATUS_LABEL: Record<api.MedicalClaim['status'], string> = {
  en_attente: 'En attente',
  partiellement_rembourse: 'Partiellement remboursé',
  cloture: 'Clôturé',
};
const STATUS_COLOR: Record<api.MedicalClaim['status'], string> = {
  en_attente: colors.v6Amber,
  partiellement_rembourse: colors.v6Blue,
  cloture: colors.v6Teal,
};
const STATUS_BG: Record<api.MedicalClaim['status'], string> = {
  en_attente: colors.v6AmberSoft,
  partiellement_rembourse: colors.v6BlueSoft,
  cloture: colors.v6TealSoft,
};

/** Refonte maquette V6B §10 — suivi mutuelle : dépenses engagées et remboursements. */
export function MedicalClaimsScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
  const [loading, setLoading] = useState(true);
  const [claims, setClaims] = useState<api.MedicalClaim[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMedicalClaims();
      setClaims(res.claims);
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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Suivi mutuelle</Text>
      <Text style={styles.subtitle}>Dépenses engagées et remboursements.</Text>

      {claims.map((claim) => (
        <View key={claim.id} style={styles.card} testID={`medical-claim-card-${claim.id}`}>
          <View style={styles.cardTop}>
            <View>
              <Text style={styles.cardTitle}>{claim.label}</Text>
              <Text style={styles.cardDate}>{formatShortDate(claim.visitDate)}</Text>
            </View>
            <Text style={[styles.statusBadge, { color: STATUS_COLOR[claim.status], backgroundColor: STATUS_BG[claim.status] }]}>
              {STATUS_LABEL[claim.status]}
            </Text>
          </View>
          <View style={styles.metricsRow}>
            <Metric label="Engagé" value={formatDh(claim.amountEngaged)} />
            <Metric label="Remboursé" value={formatDh(claim.amountReimbursed)} />
            <Metric label="Reste" value={formatDh(claim.resteACharge)} />
          </View>
          {claim.status === 'en_attente' && (
            <TouchableOpacity
              testID={`medical-claim-close-${claim.id}`}
              style={styles.closeButton}
              onPress={() => navigation.navigate('CloseMedicalClaim', { id: claim.id })}
            >
              <Text style={styles.closeButtonText}>Clôturer</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}

      {!loading && claims.length === 0 && <Text style={styles.empty}>Aucun dossier mutuelle pour l'instant.</Text>}
    </ScrollView>
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
  back: { color: colors.v6Blue, fontWeight: '800', marginBottom: spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: colors.v6Text },
  subtitle: { fontSize: 13, color: colors.v6Muted, marginTop: 4, marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    ...elevation.card,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 14, fontWeight: '850' as any, color: colors.v6Text },
  cardDate: { fontSize: 10, color: colors.v6Muted, marginTop: 3 },
  statusBadge: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, fontSize: 10, fontWeight: '850' as any },
  metricsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  metric: { flex: 1, backgroundColor: colors.v6SurfaceSoft, borderRadius: radius.md, padding: spacing.sm + 1 },
  metricLabel: { fontSize: 9, color: colors.v6Muted },
  metricValue: { fontSize: 12, fontWeight: '700', color: colors.v6Text, marginTop: 3 },
  closeButton: { marginTop: spacing.md, backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingVertical: spacing.sm + 2, alignItems: 'center' },
  closeButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  empty: { textAlign: 'center', color: colors.v6Muted, marginTop: spacing.xl, fontSize: 13 },
});
