import React, { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface TimelineEvent {
  label: string;
  amount: number;
  kind: string;
}

interface TimelinePoint {
  date: string;
  physicalTreasury: number;
  reservedAmount: number;
  engagedAmount: number;
  freeCapacity: number;
  events: TimelineEvent[];
}

interface Projection {
  reference_date: string;
  horizon_end: string;
  opening_physical_treasury: number;
  closing_physical_treasury: number;
  physical_low_point: number;
  physical_low_point_date: string;
  opening_free_capacity: number;
  closing_free_capacity: number;
  free_capacity_low_point: number;
  free_capacity_low_point_date: string;
  first_negative_date: string | null;
  deficit_at_first_negative: number | null;
  contains_estimates: boolean;
  unknown_events_count: number;
  is_complete: boolean;
  envisaged_events_total: number;
  status: 'OK' | 'TENSION' | 'DEFICIT_PHYSIQUE' | 'INCOMPLETE';
  timeline: TimelinePoint[];
}

const HORIZONS = [7, 30, 60, 90] as const;

const STATUS_LABEL: Record<Projection['status'], string> = {
  OK: 'Stable',
  TENSION: 'Tension',
  DEFICIT_PHYSIQUE: 'Déficit prévu',
  INCOMPLETE: 'Projection incomplète',
};

const STATUS_COLOR: Record<Projection['status'], string> = {
  OK: '#2E7D5B',
  TENSION: '#B8860B',
  DEFICIT_PHYSIQUE: '#B3261E',
  INCOMPLETE: '#6B747C',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Écran Projection (§34 Lot 7) — deux courbes TOUJOURS distinctes (§2) : trésorerie
 * physique (vrais flux) et capacité libre (ce qui reste réellement mobilisable).
 * Priorité aux chiffres et aux dates, pas de graphique sophistiqué qui nuirait à
 * la lisibilité.
 */
export function ProjectionScreen() {
  const [horizon, setHorizon] = useState<number>(30);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (h: number) => {
    setLoading(true);
    try {
      setProjection(await api.getProjection({ horizon: h }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(horizon);
  }, [horizon, load]);

  useFocusEffect(
    useCallback(() => {
      load(horizon);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  if (loading || !projection) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const notableDays = projection.timeline.filter((t) => t.events.length > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.segment}>
        {HORIZONS.map((h) => (
          <TouchableOpacity key={h} style={[styles.segmentItem, horizon === h && styles.segmentActive]} onPress={() => setHorizon(h)}>
            <Text style={[styles.segmentText, horizon === h && styles.segmentTextActive]}>{h}j</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={[styles.statusBanner, { backgroundColor: `${STATUS_COLOR[projection.status]}1A` }]}>
        <Text style={[styles.statusText, { color: STATUS_COLOR[projection.status] }]}>{STATUS_LABEL[projection.status]}</Text>
        {projection.status === 'DEFICIT_PHYSIQUE' && projection.first_negative_date && (
          <Text style={styles.statusDetail}>
            Risque de {projection.deficit_at_first_negative?.toLocaleString('fr-FR')} DH le {formatDate(projection.first_negative_date)}
          </Text>
        )}
        {!projection.is_complete && (
          <Text style={styles.statusDetail}>
            Projection minimale — {projection.unknown_events_count} montant(s) encore inconnu(s) dans cet horizon.
          </Text>
        )}
        {projection.contains_estimates && projection.is_complete && <Text style={styles.statusDetail}>Inclut des montants estimés.</Text>}
      </View>

      <Text style={styles.sectionTitle}>Trésorerie physique</Text>
      <View style={styles.card}>
        <View style={styles.figuresRow}>
          <Figure label="Aujourd'hui" value={projection.opening_physical_treasury} />
          <Figure label={`Dans ${horizon}j`} value={projection.closing_physical_treasury} />
        </View>
        <Text style={styles.lowPoint}>
          Point bas : {projection.physical_low_point.toLocaleString('fr-FR')} DH le {formatDate(projection.physical_low_point_date)}
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Capacité libre</Text>
      <View style={styles.card}>
        <View style={styles.figuresRow}>
          <Figure label="Aujourd'hui" value={projection.opening_free_capacity} />
          <Figure label={`Dans ${horizon}j`} value={projection.closing_free_capacity} />
        </View>
        <Text style={styles.lowPoint}>
          Minimum : {projection.free_capacity_low_point.toLocaleString('fr-FR')} DH le {formatDate(projection.free_capacity_low_point_date)}
        </Text>
      </View>

      {projection.envisaged_events_total > 0 && (
        <Text style={styles.envisaged}>+ {projection.envisaged_events_total.toLocaleString('fr-FR')} DH d'options envisagées (hors courbe ci-dessus)</Text>
      )}

      <Text style={styles.sectionTitle}>Événements principaux</Text>
      {notableDays.length === 0 ? (
        <Text style={styles.empty}>Aucun événement notable sur cette période.</Text>
      ) : (
        notableDays.map((day) => (
          <View key={day.date} style={styles.dayCard}>
            <Text style={styles.dayDate}>{formatDate(day.date)}</Text>
            {day.events.map((e, i) => (
              <View key={i} style={styles.eventRow}>
                <Text style={styles.eventLabel}>{e.label}</Text>
                <Text style={[styles.eventAmount, e.amount < 0 && styles.eventAmountNegative]}>
                  {e.amount >= 0 ? '+' : ''}
                  {e.amount.toLocaleString('fr-FR')} DH
                </Text>
              </View>
            ))}
          </View>
        ))
      )}
    </ScrollView>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, value < 0 && styles.figureValueNegative]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 16 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
  statusBanner: { borderRadius: 12, padding: 14, marginBottom: 16 },
  statusText: { fontSize: 16, fontWeight: '800' },
  statusDetail: { fontSize: 12, color: '#172436', marginTop: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 8, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8 },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 20, fontWeight: '800', color: '#172436', marginTop: 4 },
  figureValueNegative: { color: '#B3261E' },
  lowPoint: { fontSize: 12, color: '#6B747C' },
  envisaged: { fontSize: 11, color: '#6B747C', fontStyle: 'italic', marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  dayCard: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  dayDate: { fontSize: 12, fontWeight: '700', color: '#172436', marginBottom: 6 },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  eventLabel: { fontSize: 12, color: '#172436', flex: 1, marginRight: 8 },
  eventAmount: { fontSize: 12, fontWeight: '700', color: '#2E7D5B' },
  eventAmountNegative: { color: '#B3261E' },
});
