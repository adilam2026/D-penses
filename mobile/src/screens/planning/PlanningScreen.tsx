import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { colors, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { formatDh } from '../../ui/formatMoney';
import {
  buildPlanningRows,
  rowsBySection,
  groupRowsByPlan,
  isCurrentMonth,
  SECTION_LABEL,
  PlanningRow,
  PlanningPlanTotalRow,
  PlanningProvision,
  FinancialPlanRef,
} from './planningLogic';

const LABEL_COL_WIDTH = 152;
const MONTH_COL_WIDTH = 110;
const ROW_HEIGHT = 40;

type GridLine =
  | { kind: 'section'; label: string }
  | { kind: 'plan'; row: PlanningPlanTotalRow }
  | { kind: 'child'; row: PlanningRow }
  | { kind: 'row'; row: PlanningRow };

// Convergence V6 §6 — VISIBLE MONTH COUNT != DATA HORIZON. "2 à 3 mois visibles
// sur téléphone" décrivait le rendu (colonnes de largeur fixe + défilement
// horizontal, déjà géré par la ScrollView ci-dessous), jamais le nombre de
// mois RÉCUPÉRÉS : l'horizon de données reste au minimum 12 mois glissants
// sur toutes les tailles d'écran. Un utilisateur qui veut voir plus loin
// avance/recule par fenêtre de 12 mois (boutons ci-dessous, via le paramètre
// `at`) plutôt que de charger une infinité de colonnes d'un coup.
const DATA_HORIZON_MONTHS = 12;

function shiftMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Refonte maquette V6B §5 — Planning : véritable tableau façon Excel, 1re
 * colonne figée (libellés de série), défilement HORIZONTAL pour les mois
 * (largeur de colonne fixe : ~2-3 visibles en portrait mobile, davantage en
 * paysage/tablette/web par simple effet de largeur d'écran disponible —
 * jamais un carrousel mono-mois). Les montants proviennent exclusivement de
 * GET /projection/monthly (déjà calculé côté backend), jamais recalculés ici,
 * plus le calendrier mensuel réel de chaque plan financier (GET
 * /provisions/:id/sufficiency → monthlyCalendar, section ENVELOPPES). Les 2
 * colonnes (libellés figés / mois défilants) sont construites à partir de la
 * MÊME liste `lines`, ligne par ligne, pour garantir leur alignement vertical
 * sans dépendre d'un ajustement de marge fragile.
 */
export function PlanningScreen() {
  const top = useTopInset();
  const bottom = useBottomInset();
  const [windowStart, setWindowStart] = useState<string>(todayIso());
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<api.MonthlyProjectionApi | null>(null);
  const [provisions, setProvisions] = useState<PlanningProvision[]>([]);
  const [financialPlans, setFinancialPlans] = useState<FinancialPlanRef[]>([]);
  // Convergence V6 §8 — plans financiers repliés par défaut ([+] Scolarité
  // 27 145 DH ... seul le total est visible tant que non déplié).
  const [expandedPlans, setExpandedPlans] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, provisionList, plans] = await Promise.all([
        api.getMonthlyProjection({ at: windowStart, horizonMonths: DATA_HORIZON_MONTHS }),
        api.listProvisions(),
        api.listFinancialPlans(),
      ]);
      setData(res);
      const withCalendar = await Promise.all(
        provisionList.map(async (p: any) => {
          const sufficiency = await api.getProvisionSufficiency(p.id);
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

  const lines: GridLine[] = useMemo(() => {
    const out: GridLine[] = [];
    for (const group of groups) {
      out.push({ kind: 'section', label: SECTION_LABEL[group.section] });
      for (const item of group.items) {
        if (item.kind === 'plan') {
          out.push({ kind: 'plan', row: item.row });
          if (expandedPlans.has(item.row.financialPlanId)) {
            for (const child of item.row.children) out.push({ kind: 'child', row: child });
          }
        } else {
          out.push({ kind: 'row', row: item.row });
        }
      }
    }
    return out;
  }, [groups, expandedPlans]);

  if (loading && !data) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.v6Navy} />
      </View>
    );
  }
  if (!data) return null;

  return (
    <View style={[styles.container, { paddingTop: top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Planning</Text>
        <View style={styles.windowRow}>
          {/* Convergence V6 §7 — wording explicite (jamais "‹ 12 mois"/"12 mois
              ›", qui ne communiquait pas la navigation précédente/suivante) :
              "Précédent"/"Suivant" + la période affichée au centre, compact
              pour ne jamais surcharger l'écran mobile. */}
          <TouchableOpacity
            testID="planning-window-prev"
            style={styles.windowButton}
            onPress={() => setWindowStart((w) => shiftMonths(w, -DATA_HORIZON_MONTHS))}
          >
            <Ionicons name="chevron-back" size={16} color={colors.v6Text} />
            <Text style={styles.windowButtonText}>Précédent</Text>
          </TouchableOpacity>
          <Text style={styles.subtitle} numberOfLines={1}>
            {data.months[0]?.label} — {data.months[data.months.length - 1]?.label}
          </Text>
          <TouchableOpacity
            testID="planning-window-next"
            style={styles.windowButton}
            onPress={() => setWindowStart((w) => shiftMonths(w, DATA_HORIZON_MONTHS))}
          >
            <Text style={styles.windowButtonText}>Suivant</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.v6Text} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: bottom }}>
        <View style={styles.gridRow}>
          <View style={{ width: LABEL_COL_WIDTH }}>
            <View style={[styles.cell, styles.cornerCell]} />
            {lines.map((line, idx) => (
              <View key={idx} style={[styles.cell, line.kind === 'section' && styles.sectionCell]}>
                {line.kind === 'section' && <Text style={styles.sectionText}>{line.label.toUpperCase()}</Text>}
                {line.kind === 'row' && (
                  <Text style={styles.rowLabel} numberOfLines={1}>
                    {line.row.label}
                  </Text>
                )}
                {line.kind === 'plan' && (
                  <TouchableOpacity
                    testID={`planning-plan-toggle-${line.row.financialPlanId}`}
                    style={styles.planLabelRow}
                    onPress={() => togglePlan(line.row.financialPlanId)}
                  >
                    <Ionicons
                      name={expandedPlans.has(line.row.financialPlanId) ? 'remove-circle-outline' : 'add-circle-outline'}
                      size={16}
                      color={colors.v6Text}
                    />
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
              </View>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator testID="planning-months-scroll">
            <View>
              <View style={styles.rowLine}>
                {data.months.map((m) => (
                  <View
                    key={m.month}
                    style={[styles.cell, styles.monthHeaderCell, { width: MONTH_COL_WIDTH }, isCurrentMonth(m.month) && styles.currentMonthHeader]}
                  >
                    <Text style={[styles.monthHeaderText, isCurrentMonth(m.month) && styles.currentMonthHeaderText]} numberOfLines={1}>
                      {m.label}
                    </Text>
                  </View>
                ))}
              </View>

              {lines.map((line, idx) => (
                <View key={idx} style={styles.rowLine}>
                  {data.months.map((m) => {
                    if (line.kind === 'section') {
                      return (
                        <View
                          key={m.month}
                          style={[styles.cell, styles.sectionCell, { width: MONTH_COL_WIDTH }, isCurrentMonth(m.month) && styles.currentMonthCol]}
                        />
                      );
                    }
                    const value = line.row.valuesByMonth[m.month];
                    return (
                      <View key={m.month} style={[styles.cell, { width: MONTH_COL_WIDTH }, isCurrentMonth(m.month) && styles.currentMonthCol]}>
                        <Text style={styles.valueText}>{value != null ? formatDh(value) : '—'}</Text>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  title: { fontSize: 22, fontWeight: '800', color: colors.v6Text },
  subtitle: { fontSize: 12, color: colors.v6Muted, flexShrink: 1, textAlign: 'center' },
  windowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 6 },
  windowButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  windowButtonText: { fontSize: 11, fontWeight: '700', color: colors.v6Text },
  gridRow: { flexDirection: 'row' },
  rowLine: { flexDirection: 'row' },
  cell: {
    height: ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.v6Line,
    backgroundColor: colors.v6Surface,
  },
  cornerCell: { backgroundColor: colors.v6SurfaceSoft },
  sectionCell: { backgroundColor: colors.v6SurfaceSoft },
  sectionText: { fontSize: 10, fontWeight: '850' as any, color: colors.v6Muted, letterSpacing: 0.4 },
  rowLabel: { fontSize: 12, color: colors.v6Text, fontWeight: '600' },
  planLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowLabelPlan: { fontSize: 12, color: colors.v6Text, fontWeight: '700', flexShrink: 1 },
  rowLabelChild: { fontSize: 11, color: colors.v6Muted, fontWeight: '500', paddingLeft: 20 },
  monthHeaderCell: { backgroundColor: colors.v6SurfaceSoft, alignItems: 'center' },
  monthHeaderText: { fontSize: 11, fontWeight: '800', color: colors.v6Muted },
  currentMonthHeader: { backgroundColor: colors.v6BlueSoft },
  currentMonthHeaderText: { color: colors.v6Blue },
  currentMonthCol: { backgroundColor: '#F6FAFF' },
  valueText: { fontSize: 12, color: colors.v6Text, textAlign: 'right', fontWeight: '600' },
});
