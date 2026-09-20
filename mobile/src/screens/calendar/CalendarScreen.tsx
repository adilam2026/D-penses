import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { useTopInset } from '../../ui/useTopInset';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import {
  CalendarEvent,
  KIND_COLOR,
  KIND_ICON,
  KIND_LABEL,
  LEGEND_ORDER,
  formatDayMonth,
  groupEventsByMonth,
  groupEventsByMonthThenCategory,
} from './calendarLogic';

type ViewMode = 'date' | 'category';

// Point 5B — item plat pour la vue "Par catégorie / plan" : un en-tête de
// groupe suivi de ses événements, aplati pour rester dans le même SectionList
// (même virtualisation/perf que la vue "Par date", jamais un second composant
// de liste). Discriminant `__type` uniquement consommé par renderItem ci-dessous.
type CategoryFlatItem = { __type: 'groupHeader'; label: string } | { __type: 'event'; event: CalendarEvent };

/**
 * Calendrier financier (§14/§15, corrections UI/UX finales §8) — vue dérivée
 * (IncomeOccurrence + Deadline), jamais une source de données persistée.
 * Facture attendue et échéance restent deux événements distincts pour une
 * seule Deadline métier.
 *
 * Point 5 — deux représentations des MÊMES événements (jamais dupliqués/
 * recalculés) : "Par date" (Mois → Date, tri alphabétique à date égale) ou
 * "Par catégorie / plan financier" (Mois → Catégorie/Plan → opérations).
 */
export function CalendarScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('date');
  const [financialPlanLabelById, setFinancialPlanLabelById] = useState<Map<string, string>>(new Map());

  const dateSections = useMemo(() => groupEventsByMonth(events), [events]);
  const categorySections = useMemo(() => {
    return groupEventsByMonthThenCategory(events, financialPlanLabelById).map((month) => ({
      title: month.title,
      data: month.groups.flatMap((g): CategoryFlatItem[] => [
        { __type: 'groupHeader', label: g.label },
        ...g.events.map((event): CategoryFlatItem => ({ __type: 'event', event })),
      ]),
    }));
  }, [events, financialPlanLabelById]);

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
      const [res, plans] = await Promise.all([api.getCalendar({ to }), api.listFinancialPlans()]);
      setEvents(res.events);
      // Point 5B — réutilise GET /financial-plans déjà utilisé ailleurs (Plans
      // financiers/Projection), jamais un second endpoint : le libellé du plan
      // (ex. "Voiture · Opel Astra") est déjà composé/stocké tel quel côté API.
      setFinancialPlanLabelById(new Map(plans.map((p: { id: string; label: string }) => [p.id, p.label])));
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
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.headerRow}>
        <TouchableOpacity testID="calendar-hamburger" style={styles.hamburgerButton} onPress={() => navigation.getParent()?.navigate('HamburgerMenu')}>
          <Ionicons name="menu" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Calendrier</Text>
        <View style={styles.headerRowSpacer} />
      </View>

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

      {/* Point 5B — contrôle simple pour basculer entre les deux représentations
          des mêmes échéances, jamais deux jeux de données distincts. */}
      <View style={styles.viewModeRow} testID="calendar-view-mode-toggle">
        <TouchableOpacity
          testID="calendar-view-mode-date"
          style={[styles.viewModeButton, viewMode === 'date' && styles.viewModeButtonActive]}
          onPress={() => setViewMode('date')}
        >
          <Text style={[styles.viewModeButtonText, viewMode === 'date' && styles.viewModeButtonTextActive]}>Par date</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="calendar-view-mode-category"
          style={[styles.viewModeButton, viewMode === 'category' && styles.viewModeButtonActive]}
          onPress={() => setViewMode('category')}
        >
          <Text style={[styles.viewModeButtonText, viewMode === 'category' && styles.viewModeButtonTextActive]}>Par catégorie / plan</Text>
        </TouchableOpacity>
      </View>

      {viewMode === 'date' ? (
        <SectionList
          sections={dateSections}
          keyExtractor={(e, i) => `${e.kind}-${e.date}-${i}`}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun événement dans les prochains jours.</Text> : null}
          renderItem={({ item }) => <EventRow event={item} navigation={navigation} />}
        />
      ) : (
        <SectionList
          testID="calendar-category-list"
          sections={categorySections}
          keyExtractor={(item, i) => (item.__type === 'groupHeader' ? `group-${item.label}-${i}` : `${item.event.kind}-${item.event.date}-${i}`)}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
          ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucun événement dans les prochains jours.</Text> : null}
          renderItem={({ item }) =>
            item.__type === 'groupHeader' ? (
              <Text style={styles.categoryGroupTitle}>{item.label}</Text>
            ) : (
              <EventRow event={item.event} navigation={navigation} />
            )
          }
        />
      )}
    </View>
  );
}

/** Module-level (jamais une closure imbriquée) — ligne d'événement, partagée entre les 2 modes d'affichage. */
function EventRow({ event, navigation }: { event: CalendarEvent; navigation: any }) {
  return (
    <TouchableOpacity
      style={styles.row}
      disabled={!event.deadlineId && !event.incomeOccurrenceId && !event.recurringTransferId}
      activeOpacity={event.deadlineId || event.incomeOccurrenceId || event.recurringTransferId ? 0.6 : 1}
      onPress={() => {
        if (event.deadlineId) navigation.navigate('DeadlineDetail', { id: event.deadlineId });
        // Correction UX (Calendrier — occurrence de revenu) : ouvre la fiche de
        // CETTE occurrence précise, jamais la source récurrente entière.
        else if (event.incomeOccurrenceId) navigation.navigate('IncomeOccurrenceDetail', { id: event.incomeOccurrenceId });
        else if (event.recurringTransferId) navigation.navigate('RecurringTransferDetail', { id: event.recurringTransferId });
      }}
    >
      <Ionicons name={KIND_ICON[event.kind]} size={20} color={KIND_COLOR[event.kind]} style={styles.rowIcon} />
      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>{event.label}</Text>
        <Text style={[styles.rowMeta, { color: KIND_COLOR[event.kind] }]}>
          {formatDayMonth(event.date)} · {KIND_LABEL[event.kind]}
        </Text>
      </View>
      {event.amount !== null && <Text style={styles.rowAmount}>{event.amount.toLocaleString('fr-FR')} DH</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md },
  hamburgerButton: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerRowSpacer: { width: 32, height: 32 },
  sectionHeader: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    backgroundColor: colors.background,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
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
  viewModeRow: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 3, marginBottom: spacing.md },
  viewModeButton: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
  viewModeButtonActive: { backgroundColor: colors.surface, ...elevation.card },
  viewModeButtonText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  viewModeButtonTextActive: { color: colors.textPrimary },
  categoryGroupTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.textPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowIcon: { marginRight: spacing.sm },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, marginTop: 2, fontWeight: '600' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
});
