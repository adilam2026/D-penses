import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { CalendarEvent, KIND_COLOR, KIND_ICON, KIND_LABEL, LEGEND_ORDER } from './calendarLogic';

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MAX_EVENTS_PER_CELL = 3;

function dayKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Lundi (0) à dimanche (6) — semaine à la française, jamais dimanche en premier. */
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7;
}

/**
 * Portail Web v4 §1/§4 (WEB-V4.3) — Calendrier desktop : vraie grille
 * mensuelle (navigation mois précédent/suivant + Aujourd'hui), événements
 * directement dans les cases, mêmes codes couleur/icône que mobile, légende
 * toujours visible (jamais repliée par défaut), clic événement → DeadlineDetail
 * existant. Fenêtre de données = les semaines réellement affichées dans la
 * grille (from/to élargis aux jours des mois adjacents visibles), toujours via
 * GET /calendar existant.
 */
export function CalendarScreen() {
  const navigation = useNavigation<any>();
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(today.getUTCMonth()); // 0-11
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const grid = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const lastOfMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0));
    const leadingDays = mondayIndex(firstOfMonth.getUTCDay());
    const gridStart = new Date(Date.UTC(viewYear, viewMonth, 1 - leadingDays));
    const cells: { y: number; m: number; d: number; inMonth: boolean; key: string }[] = [];
    for (let i = 0; i < 42; i++) {
      const cellDate = new Date(gridStart.getTime() + i * 86400000);
      const y = cellDate.getUTCFullYear();
      const m = cellDate.getUTCMonth();
      const d = cellDate.getUTCDate();
      cells.push({ y, m, d, inMonth: m === viewMonth, key: dayKey(y, m, d) });
    }
    return { cells, gridStart, gridEnd: new Date(gridStart.getTime() + 41 * 86400000), lastOfMonth };
  }, [viewYear, viewMonth]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const from = grid.gridStart.toISOString().slice(0, 10);
      const to = grid.gridEnd.toISOString().slice(0, 10);
      const res = await api.getCalendar({ from, to });
      setEvents(res.events);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.gridStart, grid.gridEnd]);

  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const key = e.date.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  function goToday() {
    setViewYear(today.getUTCFullYear());
    setViewMonth(today.getUTCMonth());
  }
  function goPrev() {
    const d = new Date(Date.UTC(viewYear, viewMonth - 1, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  }
  function goNext() {
    const d = new Date(Date.UTC(viewYear, viewMonth + 1, 1));
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
  }

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const todayKey = dayKey(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title="Calendrier"
        actions={
          <View style={styles.navRow}>
            <TouchableOpacity testID="web-calendar-prev" style={styles.navButton} onPress={goPrev}>
              <Ionicons name="chevron-back" size={16} color={webColors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity testID="web-calendar-today" style={styles.todayButton} onPress={goToday}>
              <Text style={styles.todayButtonText}>Aujourd'hui</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="web-calendar-next" style={styles.navButton} onPress={goNext}>
              <Ionicons name="chevron-forward" size={16} color={webColors.textPrimary} />
            </TouchableOpacity>
          </View>
        }
      />

      <Text style={styles.monthLabel}>{monthLabel}</Text>

      <View style={styles.legend} testID="web-legend-panel">
        {LEGEND_ORDER.map((kind) => (
          <View key={kind} style={styles.legendItem}>
            <Ionicons name={KIND_ICON[kind]} size={14} color={KIND_COLOR[kind]} />
            <Text style={styles.legendItemText}>{KIND_LABEL[kind]}</Text>
          </View>
        ))}
      </View>

      {loading && events.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <View style={styles.grid}>
          <View style={styles.weekHeaderRow}>
            {WEEKDAY_LABELS.map((w) => (
              <Text key={w} style={styles.weekHeaderCell}>
                {w}
              </Text>
            ))}
          </View>
          {Array.from({ length: 6 }).map((_, week) => (
            <View key={week} style={styles.weekRow}>
              {grid.cells.slice(week * 7, week * 7 + 7).map((cell) => {
                const dayEvents = eventsByDay.get(cell.key) ?? [];
                const shown = dayEvents.slice(0, MAX_EVENTS_PER_CELL);
                const extra = dayEvents.length - shown.length;
                const isToday = cell.key === todayKey;
                return (
                  <View key={cell.key} style={[styles.dayCell, !cell.inMonth && styles.dayCellOutside, isToday && styles.dayCellToday]}>
                    <Text style={[styles.dayNumber, !cell.inMonth && styles.dayNumberOutside, isToday && styles.dayNumberToday]}>{cell.d}</Text>
                    {shown.map((e, i) => (
                      <TouchableOpacity
                        key={`${e.kind}-${i}`}
                        testID={`web-calendar-event-${cell.key}-${i}`}
                        style={styles.eventChip}
                        disabled={!e.deadlineId}
                        onPress={() => e.deadlineId && navigation.navigate('DeadlineDetail', { id: e.deadlineId })}
                      >
                        <Ionicons name={KIND_ICON[e.kind]} size={11} color={KIND_COLOR[e.kind]} />
                        <Text style={[styles.eventChipText, { color: KIND_COLOR[e.kind] }]} numberOfLines={1}>
                          {e.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {extra > 0 && <Text style={styles.moreText}>+{extra} autre(s)</Text>}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  navRow: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.xs },
  navButton: { width: 32, height: 32, borderRadius: webRadius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.surfaceMuted, borderWidth: 1, borderColor: webColors.border },
  todayButton: { paddingHorizontal: webSpacing.md, paddingVertical: 8, borderRadius: webRadius.pill, backgroundColor: webColors.primary },
  todayButtonText: { color: webColors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  monthLabel: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, textTransform: 'capitalize', marginBottom: webSpacing.sm },

  legend: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.sm, marginBottom: webSpacing.lg, borderWidth: 1, borderColor: webColors.border },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: webSpacing.lg, marginBottom: 4 },
  legendItemText: { fontSize: 11, color: webColors.textPrimary, marginLeft: 4 },

  grid: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  weekHeaderRow: { flexDirection: 'row', backgroundColor: webColors.tableHeaderBg },
  weekHeaderCell: { flexBasis: `${100 / 7}%`, textAlign: 'center', paddingVertical: 8, fontSize: 11, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase' },
  weekRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  dayCell: { flexBasis: `${100 / 7}%`, minHeight: 100, padding: 6, borderRightWidth: 1, borderRightColor: webColors.tableRowBorder },
  dayCellOutside: { backgroundColor: webColors.surfaceMuted },
  dayCellToday: { backgroundColor: webColors.successLight },
  dayNumber: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary, marginBottom: 4 },
  dayNumberOutside: { color: webColors.textSecondary },
  dayNumberToday: { color: webColors.success },
  eventChip: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 2 },
  eventChipText: { fontSize: 10, fontWeight: '600', flexShrink: 1 },
  moreText: { fontSize: 9, color: webColors.textSecondary, fontStyle: 'italic', marginTop: 1 },
});
