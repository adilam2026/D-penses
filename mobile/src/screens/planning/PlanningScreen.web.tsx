import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { cached } from '../../state/cache';
import { webColors, webSpacing } from '../../web/webTheme';
import { formatDh } from '../../ui/formatMoney';
import {
  buildPlanningRows,
  rowsBySection,
  groupRowsByPlan,
  isCurrentMonth,
  SECTION_LABEL,
  SECTION_ORDER,
  PlanningSection,
  PlanningRow,
  PlanningPlanTotalRow,
  PlanningProvision,
  FinancialPlanRef,
} from './planningLogic';

const LABEL_COL_WIDTH = 180;
const MONTH_COL_WIDTH = 120;
const ROW_HEIGHT = 38;
const MAX_WIDTH = 1600;
const DATA_HORIZON_MONTHS = 12;

type GridLine =
  | { kind: 'section'; section: PlanningSection; label: string }
  | { kind: 'plan'; row: PlanningPlanTotalRow }
  | { kind: 'child'; row: PlanningRow }
  | { kind: 'row'; row: PlanningRow }
  | { kind: 'total'; section: PlanningSection; label: string; valuesByMonth: Record<string, number> }
  | { kind: 'balance'; label: string; valuesByMonth: Record<string, number> };

const SECTION_ACCENT: Record<PlanningSection, { solid: string; soft: string }> = {
  revenus: { solid: webColors.teal, soft: webColors.tealSoft },
  charges: { solid: webColors.red, soft: webColors.redSoft },
  enveloppes: { solid: webColors.amber, soft: webColors.amberSoft },
  exceptionnel: { solid: webColors.purple, soft: webColors.purpleSoft },
};

function shiftMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyTotals(monthKeys: string[]): Record<string, number> {
  return Object.fromEntries(monthKeys.map((k) => [k, 0]));
}

/**
 * Équivalent Web de PlanningScreen.tsx — même moteur (planningLogic.ts,
 * jamais un second calcul), même densité "type Excel" (§11 — "le Planning
 * doit rester dense... jamais un gros tableau gris fade"), largeur pleine du
 * shell desktop au lieu de retomber sur la version mobile étroite.
 */
export function PlanningScreen() {
  const [windowStart, setWindowStart] = useState<string>(todayIso());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<api.MonthlyProjectionApi | null>(null);
  const [provisions, setProvisions] = useState<PlanningProvision[]>([]);
  const [financialPlans, setFinancialPlans] = useState<FinancialPlanRef[]>([]);
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, provisionList, plans] = await Promise.all([
        cached(`monthlyProjection:${windowStart}`, () => api.getMonthlyProjection({ at: windowStart, horizonMonths: DATA_HORIZON_MONTHS })),
        cached('provisions', () => api.listProvisions()),
        cached('financialPlans', () => api.listFinancialPlans()),
      ]);
      setData(res);
      const withCalendar = await Promise.all(
        provisionList.map(async (p: any) => {
          const sufficiency = await cached(`provisionSufficiency:${p.id}`, () => api.getProvisionSufficiency(p.id));
          return { id: p.id, name: p.name, monthlyCalendar: sufficiency.monthlyCalendar ?? [] };
        }),
      );
      setProvisions(withCalendar);
      setFinancialPlans((plans as any[]).map((p) => ({ id: p.id, label: p.label })));
    } finally {
      setLoading(false);
    }
  }, [windowStart]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const groups = useMemo(() => {
    if (!data) return [];
    const rows = buildPlanningRows(data.months, provisions);
    return rowsBySection(rows).map((g) => ({ section: g.section, items: groupRowsByPlan(g.rows, financialPlans) }));
  }, [data, provisions, financialPlans]);

  function togglePlan(planId: string) {
    setExpandedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  }

  const monthKeys = useMemo(() => (data ? data.months.map((m) => m.month) : []), [data]);

  const lines = useMemo(() => {
    const out: GridLine[] = [];
    const sectionTotals: Partial<Record<PlanningSection, Record<string, number>>> = {};

    for (const group of groups) {
      out.push({ kind: 'section', section: group.section, label: SECTION_LABEL[group.section] });
      const totals = emptyTotals(monthKeys);
      for (const item of group.items) {
        for (const k of monthKeys) totals[k] += item.row.valuesByMonth[k] ?? 0;
        if (item.kind === 'plan') {
          out.push({ kind: 'plan', row: item.row });
          if (expandedPlans.has(item.row.financialPlanId)) {
            for (const child of item.row.children) out.push({ kind: 'child', row: child });
          }
        } else {
          out.push({ kind: 'row', row: item.row });
        }
      }
      sectionTotals[group.section] = totals;
      out.push({ kind: 'total', section: group.section, label: `Total ${SECTION_LABEL[group.section].toLowerCase()}`, valuesByMonth: totals });
    }

    const balance = emptyTotals(monthKeys);
    for (const k of monthKeys) {
      const revenus = sectionTotals.revenus?.[k] ?? 0;
      const sorties = SECTION_ORDER.filter((s) => s !== 'revenus').reduce((sum, s) => sum + (sectionTotals[s]?.[k] ?? 0), 0);
      balance[k] = revenus - sorties;
    }
    if (groups.length > 0) out.push({ kind: 'balance', label: 'Balance', valuesByMonth: balance });

    return out;
  }, [groups, expandedPlans, monthKeys]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={webColors.navy} />
      </View>
    );
  }
  if (!data) return null;

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.header}>
          <Text style={styles.title}>Planning</Text>
          <View style={styles.windowRow}>
            <TouchableOpacity testID="planning-window-prev" style={styles.windowButton} onPress={() => setWindowStart((w) => shiftMonths(w, -DATA_HORIZON_MONTHS))}>
              <Ionicons name="chevron-back" size={15} color={webColors.textPrimary} />
              <Text style={styles.windowButtonText}>Précédent</Text>
            </TouchableOpacity>
            <Text style={styles.subtitle} numberOfLines={1}>
              {data.months[0]?.label} — {data.months[data.months.length - 1]?.label}
            </Text>
            <TouchableOpacity testID="planning-window-next" style={styles.windowButton} onPress={() => setWindowStart((w) => shiftMonths(w, DATA_HORIZON_MONTHS))}>
              <Text style={styles.windowButtonText}>Suivant</Text>
              <Ionicons name="chevron-forward" size={15} color={webColors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView>
          <View style={styles.gridRow}>
            <View style={{ width: LABEL_COL_WIDTH }}>
              <View style={[styles.cell, styles.cornerCell]} />
              {lines.map((line, idx) => {
                const accent = line.kind === 'section' || line.kind === 'total' ? SECTION_ACCENT[line.section] : null;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.cell,
                      line.kind === 'section' && [styles.sectionCell, accent && { backgroundColor: accent.soft }],
                      line.kind === 'total' && [styles.totalCell, accent && { backgroundColor: accent.soft }],
                      line.kind === 'balance' && styles.balanceLabelCell,
                    ]}
                  >
                    {line.kind === 'section' && (
                      <View style={styles.sectionLabelRow}>
                        <View style={[styles.sectionDot, accent && { backgroundColor: accent.solid }]} />
                        <Text style={[styles.sectionText, accent && { color: accent.solid }]}>{line.label.toUpperCase()}</Text>
                      </View>
                    )}
                    {line.kind === 'row' && (
                      <Text style={styles.rowLabel} numberOfLines={1}>
                        {line.row.label}
                      </Text>
                    )}
                    {line.kind === 'plan' && (
                      <TouchableOpacity testID={`planning-plan-toggle-${line.row.financialPlanId}`} style={styles.planLabelRow} onPress={() => togglePlan(line.row.financialPlanId)}>
                        <Ionicons name={expandedPlans.has(line.row.financialPlanId) ? 'remove-circle-outline' : 'add-circle-outline'} size={15} color={webColors.textPrimary} />
                        <Text style={styles.rowLabelPlan} numberOfLines={1}>
                          {line.row.label}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {line.kind === 'child' && (
                      <Text style={styles.rowLabelChild} numberOfLines={1}>
                        {line.row.label}
                      </Text>
                    )}
                    {line.kind === 'total' && (
                      <Text style={[styles.totalLabel, accent && { color: accent.solid }]} numberOfLines={1}>
                        {line.label}
                      </Text>
                    )}
                    {line.kind === 'balance' && <Text style={styles.balanceLabel}>{line.label}</Text>}
                  </View>
                );
              })}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator testID="planning-months-scroll">
              <View>
                <View style={styles.rowLine}>
                  {data.months.map((m) => (
                    <View key={m.month} style={[styles.cell, styles.monthHeaderCell, { width: MONTH_COL_WIDTH }, isCurrentMonth(m.month) && styles.currentMonthHeader]}>
                      <Text style={[styles.monthHeaderText, isCurrentMonth(m.month) && styles.currentMonthHeaderText]} numberOfLines={1}>
                        {m.label}
                      </Text>
                    </View>
                  ))}
                </View>

                {lines.map((line, idx) => {
                  const accent = line.kind === 'section' || line.kind === 'total' ? SECTION_ACCENT[line.section] : null;
                  return (
                    <View key={idx} style={styles.rowLine}>
                      {data.months.map((m) => {
                        const current = isCurrentMonth(m.month);
                        if (line.kind === 'section') {
                          return (
                            <View
                              key={m.month}
                              style={[styles.cell, styles.sectionCell, accent && { backgroundColor: accent.soft }, { width: MONTH_COL_WIDTH }, current && styles.currentMonthCol]}
                            />
                          );
                        }
                        if (line.kind === 'total') {
                          const value = line.valuesByMonth[m.month];
                          return (
                            <View
                              key={m.month}
                              style={[styles.cell, styles.totalCell, accent && { backgroundColor: accent.soft }, { width: MONTH_COL_WIDTH }, current && styles.currentMonthCol]}
                            >
                              <Text style={[styles.totalValueText, accent && { color: accent.solid }]}>{formatDh(value)}</Text>
                            </View>
                          );
                        }
                        if (line.kind === 'balance') {
                          const value = line.valuesByMonth[m.month];
                          return (
                            <View key={m.month} style={[styles.cell, styles.balanceCell, { width: MONTH_COL_WIDTH }, current && styles.balanceCurrentCol]}>
                              <Text style={[styles.balanceValueText, { color: value < 0 ? webColors.redOnDark : webColors.tealOnDark }]}>{formatDh(value)}</Text>
                            </View>
                          );
                        }
                        const value = line.row.valuesByMonth[m.month];
                        return (
                          <View key={m.month} style={[styles.cell, { width: MONTH_COL_WIDTH }, current && styles.currentMonthCol]}>
                            <Text style={styles.valueText}>{value != null ? formatDh(value) : '—'}</Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  inner: { flex: 1, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center', padding: webSpacing.xl },
  header: { marginBottom: webSpacing.md },
  title: { fontSize: 20, fontWeight: '800', color: webColors.textPrimary },
  subtitle: { fontSize: 12, color: webColors.textSecondary, flexShrink: 1, textAlign: 'center' },
  windowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 14, marginTop: 6 },
  windowButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  windowButtonText: { fontSize: 11, fontWeight: '700', color: webColors.textPrimary },
  gridRow: { flexDirection: 'row' },
  rowLine: { flexDirection: 'row' },
  cell: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: webSpacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: webColors.tableRowBorder,
    backgroundColor: webColors.surface,
  },
  cornerCell: { backgroundColor: webColors.tableHeaderBg },
  sectionCell: { backgroundColor: webColors.tableHeaderBg },
  sectionLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: webColors.textSecondary },
  sectionText: { fontSize: 10, fontWeight: '800', color: webColors.textSecondary, letterSpacing: 0.4 },
  rowLabel: { fontSize: 12, color: webColors.textPrimary, fontWeight: '600' },
  planLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowLabelPlan: { fontSize: 12, color: webColors.textPrimary, fontWeight: '700', flexShrink: 1 },
  rowLabelChild: { fontSize: 11, color: webColors.textSecondary, fontWeight: '500', paddingLeft: 20 },
  totalCell: { backgroundColor: webColors.tableHeaderBg, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  totalLabel: { fontSize: 11, fontWeight: '800', color: webColors.textPrimary },
  totalValueText: { fontSize: 12, fontWeight: '800', textAlign: 'right', color: webColors.textPrimary },
  balanceLabelCell: { backgroundColor: webColors.navy },
  balanceLabel: { fontSize: 12, fontWeight: '800', color: '#fff' },
  balanceCell: { backgroundColor: webColors.navy },
  balanceCurrentCol: { backgroundColor: '#1E4363' },
  balanceValueText: { fontSize: 12, fontWeight: '800', textAlign: 'right' },
  monthHeaderCell: { backgroundColor: webColors.tableHeaderBg, alignItems: 'center' },
  monthHeaderText: { fontSize: 11, fontWeight: '800', color: webColors.textSecondary },
  currentMonthHeader: { backgroundColor: webColors.blueSoft },
  currentMonthHeaderText: { color: webColors.blue },
  currentMonthCol: { backgroundColor: '#F6FAFF' },
  valueText: { fontSize: 12, color: webColors.textPrimary, textAlign: 'right', fontWeight: '600' },
});
