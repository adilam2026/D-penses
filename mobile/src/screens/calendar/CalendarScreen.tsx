import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import * as api from '../../api/client';

interface CalendarEvent {
  date: string;
  kind: 'revenu_prevu' | 'facture_attendue' | 'echeance' | 'montant_inconnu' | 'echeance_payee';
  label: string;
  amount: number | null;
}

const KIND_LABEL: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: 'Revenu prévu',
  facture_attendue: 'Facture attendue',
  echeance: 'Échéance',
  montant_inconnu: 'Montant inconnu',
  echeance_payee: 'Échéance payée',
};

const KIND_COLOR: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: '#2E7D5B',
  facture_attendue: '#B8860B',
  echeance: '#172436',
  montant_inconnu: '#B3261E',
  echeance_payee: '#6B747C',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/**
 * Calendrier financier (§14/§15) — vue dérivée (IncomeOccurrence + Deadline),
 * jamais une source de données persistée. Facture attendue et échéance restent
 * deux événements distincts pour une seule Deadline métier.
 */
export function CalendarScreen() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCalendar();
      setEvents(res.events);
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
    <View style={styles.container}>
      <Text style={styles.title}>Calendrier</Text>
      <FlatList
        data={events}
        keyExtractor={(e, i) => `${e.kind}-${e.date}-${i}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun événement dans les prochains jours.</Text> : null}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: KIND_COLOR[item.kind] }]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowMeta}>
                {formatDate(item.date)} · {KIND_LABEL[item.kind]}
              </Text>
            </View>
            {item.amount !== null && <Text style={styles.rowAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 56, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 16 },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
});
