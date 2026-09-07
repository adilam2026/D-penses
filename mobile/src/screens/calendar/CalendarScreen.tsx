import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface CalendarEvent {
  date: string;
  kind: 'revenu_prevu' | 'facture_attendue' | 'echeance' | 'montant_inconnu' | 'echeance_payee';
  label: string;
  amount: number | null;
  deadlineId?: string;
  incomeOccurrenceId?: string;
}

const KIND_LABEL: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: 'Revenu prévu',
  facture_attendue: 'Facture attendue',
  echeance: 'À payer',
  montant_inconnu: 'Montant inconnu',
  echeance_payee: 'Payé',
};

// §9 (recette téléphone réel) : jamais la couleur seule pour distinguer un type
// d'événement — un pictogramme différent par kind, la couleur en renfort.
const KIND_ICON: Record<CalendarEvent['kind'], IconName> = {
  revenu_prevu: 'arrow-down-circle-outline',
  facture_attendue: 'document-text-outline',
  echeance: 'alert-circle-outline',
  montant_inconnu: 'help-circle-outline',
  echeance_payee: 'checkmark-circle',
};

const KIND_COLOR: Record<CalendarEvent['kind'], string> = {
  revenu_prevu: colors.success,
  facture_attendue: colors.warning,
  echeance: colors.primary,
  montant_inconnu: colors.danger,
  echeance_payee: colors.textSecondary,
};

// Ordre d'affichage de la légende — dérivé des mêmes constantes que les lignes
// (source unique, jamais une liste dupliquée qui pourrait diverger).
const LEGEND_ORDER: CalendarEvent['kind'][] = ['echeance', 'echeance_payee', 'revenu_prevu', 'montant_inconnu', 'facture_attendue'];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/**
 * Calendrier financier (§14/§15) — vue dérivée (IncomeOccurrence + Deadline),
 * jamais une source de données persistée. Facture attendue et échéance restent
 * deux événements distincts pour une seule Deadline métier.
 */
export function CalendarScreen() {
  const navigation = useNavigation<any>();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Sans `to` explicite, le backend replie sur H* (date du tout prochain revenu
      // prévu) — un horizon de calcul financier, pas une fenêtre d'affichage de
      // calendrier : il coupe mathématiquement juste après ce premier revenu, quel
      // que soit le nombre d'occurrences futures réellement générées en base. On
      // demande donc explicitement une fenêtre de 90 jours, cohérente avec l'écran
      // Projection.
      const to = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const res = await api.getCalendar({ to });
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

      <TouchableOpacity testID="legend-toggle" style={styles.legendToggle} onPress={() => setLegendOpen((v) => !v)}>
        <Text style={styles.legendToggleText}>Légende</Text>
        <Ionicons name={legendOpen ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textSecondary} />
      </TouchableOpacity>
      {legendOpen && (
        <View style={styles.legend} testID="legend-panel">
          {LEGEND_ORDER.map((kind) => (
            <View key={kind} style={styles.legendItem}>
              <Ionicons name={KIND_ICON[kind]} size={14} color={KIND_COLOR[kind]} />
              <Text style={styles.legendItemText}>{KIND_LABEL[kind]}</Text>
            </View>
          ))}
        </View>
      )}

      <FlatList
        data={events}
        keyExtractor={(e, i) => `${e.kind}-${e.date}-${i}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun événement dans les prochains jours.</Text> : null}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            disabled={!item.deadlineId}
            activeOpacity={item.deadlineId ? 0.6 : 1}
            onPress={() => item.deadlineId && navigation.navigate('DeadlineDetail', { id: item.deadlineId })}
          >
            <Ionicons name={KIND_ICON[item.kind]} size={20} color={KIND_COLOR[item.kind]} style={styles.rowIcon} />
            <View style={styles.rowBody}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={[styles.rowMeta, { color: KIND_COLOR[item.kind] }]}>
                {formatDate(item.date)} · {KIND_LABEL[item.kind]}
              </Text>
            </View>
            {item.amount !== null && <Text style={styles.rowAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 56, paddingHorizontal: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  legendToggle: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: spacing.sm },
  legendToggleText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginRight: 4 },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: spacing.md, marginBottom: 4 },
  legendItemText: { fontSize: 11, color: colors.textPrimary, marginLeft: 4 },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  rowIcon: { marginRight: spacing.sm },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
});
