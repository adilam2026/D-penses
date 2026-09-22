import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as api from '../../api/client';
import { colors, spacing } from '../../ui/theme';
import { useTopInset } from '../../ui/useTopInset';
import { useBottomInset } from '../../ui/useBottomInset';
import { useResponsiveLayout, DeviceClass, Orientation } from '../../ui/useResponsiveLayout';
import { formatDh } from '../../ui/formatMoney';
import { buildPlanningRows, rowsBySection, isCurrentMonth, SECTION_LABEL, PlanningRow, PlanningProvision } from './planningLogic';

const LABEL_COL_WIDTH = 152;
const MONTH_COL_WIDTH = 110;
const ROW_HEIGHT = 40;

type GridLine = { kind: 'section'; label: string } | { kind: 'row'; row: PlanningRow };

/**
 * Refonte maquette V6B §5/§17/§20 — horizon (nombre de mois RÉCUPÉRÉS, pas
 * seulement affichés) croissant avec la largeur disponible : 3 en portrait
 * mobile, 6 en paysage mobile/tablette, 12 en desktop — sur un écran large,
 * aller chercher plus de mois profite réellement de l'espace plutôt que de
 * laisser du vide à droite d'un horizon toujours fixé à 6. Valeur toujours
 * choisie dans l'enum accepté par GET /projection/monthly (3/6/12/24/36/60) —
 * une valeur hors enum (ex. 7) fait échouer l'appel en 400.
 */
function horizonMonthsFor(deviceClass: DeviceClass, orientation: Orientation): number {
  if (deviceClass === 'desktop') return 12;
  if (deviceClass === 'tablet') return 6;
  return orientation === 'landscape' ? 6 : 3;
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
  const { deviceClass, orientation } = useResponsiveLayout();
  const horizonMonths = horizonMonthsFor(deviceClass, orientation);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<api.MonthlyProjectionApi | null>(null);
  const [provisions, setProvisions] = useState<PlanningProvision[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, provisionList] = await Promise.all([api.getMonthlyProjection({ horizonMonths }), api.listProvisions()]);
      setData(res);
      const withCalendar = await Promise.all(
        provisionList.map(async (p: any) => {
          const sufficiency = await api.getProvisionSufficiency(p.id);
          return { id: p.id, name: p.name, monthlyCalendar: sufficiency.monthlyCalendar ?? [] };
        }),
      );
      setProvisions(withCalendar);
    } finally {
      setLoading(false);
    }
  }, [horizonMonths]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const groups = useMemo(() => (data ? rowsBySection(buildPlanningRows(data.months, provisions)) : []), [data, provisions]);

  const lines: GridLine[] = useMemo(() => {
    const out: GridLine[] = [];
    for (const group of groups) {
      out.push({ kind: 'section', label: SECTION_LABEL[group.section] });
      for (const row of group.rows) out.push({ kind: 'row', row });
    }
    return out;
  }, [groups]);

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
        <Text style={styles.subtitle}>Revenus, charges et enveloppes sur {data.months.length} mois.</Text>
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
  subtitle: { fontSize: 12, color: colors.v6Muted, marginTop: 3 },
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
  monthHeaderCell: { backgroundColor: colors.v6SurfaceSoft, alignItems: 'center' },
  monthHeaderText: { fontSize: 11, fontWeight: '800', color: colors.v6Muted },
  currentMonthHeader: { backgroundColor: colors.v6BlueSoft },
  currentMonthHeaderText: { color: colors.v6Blue },
  currentMonthCol: { backgroundColor: '#F6FAFF' },
  valueText: { fontSize: 12, color: colors.v6Text, textAlign: 'right', fontWeight: '600' },
});
