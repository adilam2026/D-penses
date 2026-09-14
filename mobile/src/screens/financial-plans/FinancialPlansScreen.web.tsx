import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { formatDate } from '../transactions/transactionsLogic';
import { COMPLETUDE_LABEL, FinancialPlan, PLAN_TYPE_ICON, upcomingDeadlines } from './financialPlansLogic';

/**
 * Portail Web v4 §1/§3/§6 (WEB-V4.2 révisé) — Plans financiers desktop :
 * blocs riches (montants + jusqu'à 5 "Prochaines échéances" non soldées,
 * retard d'abord) en colonne principale ; colonne d'action limitée aux 2
 * actions déjà réelles (École/Voyage) — aucun formulaire générique de plan,
 * aucun nouveau type. `deadlinesCertain` provient déjà de GET /financial-plans
 * (aucun appel/endpoint supplémentaire).
 */
export function FinancialPlansScreen() {
  const navigation = useNavigation<any>();
  const [plans, setPlans] = useState<FinancialPlan[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await api.listFinancialPlans());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const mainContent =
    loading && plans.length === 0 ? (
      <ActivityIndicator style={{ marginTop: 24 }} />
    ) : plans.length === 0 ? (
      <Text style={styles.empty}>Aucun plan financier pour l'instant.</Text>
    ) : (
      <View style={styles.blockList}>
        {plans.map((item) => {
          const cost = item.knownPlanCost;
          const paidPct = cost > 0 ? Math.max(0, Math.min(100, (item.paidAmount / cost) * 100)) : 0;
          const provPct = cost > 0 ? Math.max(0, Math.min(100 - paidPct, (item.provisionCoverage / cost) * 100)) : 0;
          const deadlines = upcomingDeadlines(item);
          const now = Date.now();
          return (
            <View key={item.id} style={styles.block}>
              <View style={styles.blockHeader}>
                <Text style={styles.planIcon}>{PLAN_TYPE_ICON[item.planType]}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.blockTitle} numberOfLines={1}>
                    {item.label}
                    {item.destination ? ` · ${item.destination}` : ''}
                  </Text>
                  <Text style={styles.blockMeta}>{COMPLETUDE_LABEL[item.completude]}</Text>
                </View>
                <Text style={styles.blockAmount}>{cost.toLocaleString('fr-FR')} DH</Text>
              </View>

              <View style={styles.figuresRow}>
                <Text style={styles.figureText}>Payé {item.paidAmount.toLocaleString('fr-FR')} DH</Text>
                <Text style={styles.figureText}>Provisionné {item.provisionCoverage.toLocaleString('fr-FR')} DH</Text>
                {item.remainingDue > 0 && <Text style={styles.figureRemaining}>Reste à financer {item.remainingDue.toLocaleString('fr-FR')} DH</Text>}
              </View>

              {cost > 0 && (paidPct > 0 || provPct > 0) && (
                <View style={styles.planTrack}>
                  <View style={[styles.planTrackPaid, { width: `${paidPct}%` }]} />
                  <View style={[styles.planTrackProv, { width: `${provPct}%` }]} />
                </View>
              )}

              <View style={styles.deadlinesSection}>
                <Text style={styles.deadlinesTitle}>Prochaines échéances</Text>
                {deadlines.length === 0 ? (
                  <Text style={styles.activityEmpty}>Aucune échéance non soldée.</Text>
                ) : (
                  deadlines.map((d) => {
                    const overdue = new Date(d.dueDate).getTime() < now;
                    return (
                      <TouchableOpacity key={d.id} style={styles.deadlineRow} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
                        <Text style={[styles.deadlineDate, overdue && styles.deadlineOverdueText]}>
                          {formatDate(d.dueDate)}
                          {overdue ? ' · En retard' : ''}
                        </Text>
                        <Text style={styles.deadlineLabel} numberOfLines={1}>
                          {d.chargePlanLabel}
                        </Text>
                        <Text style={styles.deadlineAmount}>{d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH` : 'Montant inconnu'}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              <TouchableOpacity testID={`web-plan-card-${item.id}`} style={styles.viewPlanLink} onPress={() => navigation.navigate('FinancialPlanDetail', { id: item.id })}>
                <Text style={styles.viewPlanLinkText}>Voir le plan →</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );

  const panel = (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Nouveau plan</Text>
      <TouchableOpacity testID="web-plan-new-school" style={styles.actionButton} onPress={() => navigation.navigate('SchoolWizard')}>
        <Text style={styles.actionButtonText}>🎓 Frais scolaires</Text>
      </TouchableOpacity>
      <TouchableOpacity testID="web-plan-new-travel" style={styles.actionButton} onPress={() => navigation.navigate('TravelWizard')}>
        <Text style={styles.actionButtonText}>✈️ Voyage</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Plans financiers" />
      <TwoColumnLayout main={mainContent} panel={panel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  empty: { color: webColors.textSecondary, fontSize: 13, lineHeight: 20 },

  blockList: { gap: webSpacing.md },
  block: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, padding: webSpacing.md, borderWidth: 1, borderColor: webColors.borderStrong },
  blockHeader: { flexDirection: 'row', alignItems: 'center' },
  planIcon: { fontSize: 22, marginRight: webSpacing.sm },
  blockTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  blockMeta: { fontSize: 11, color: webColors.warning, marginTop: 2 },
  blockAmount: { fontSize: 18, fontWeight: '800', color: webColors.textPrimary, marginLeft: webSpacing.sm },

  figuresRow: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.md, marginTop: webSpacing.sm },
  figureText: { fontSize: 11, color: webColors.textSecondary },
  figureRemaining: { fontSize: 11, color: webColors.textPrimary, fontWeight: '700' },

  planTrack: { height: 7, borderRadius: 4, backgroundColor: webColors.surfaceMuted, overflow: 'hidden', flexDirection: 'row', marginTop: webSpacing.sm },
  planTrackPaid: { height: '100%', backgroundColor: webColors.success },
  planTrackProv: { height: '100%', backgroundColor: '#7089DF' },

  deadlinesSection: { marginTop: webSpacing.md, borderTopWidth: 1, borderTopColor: webColors.border, paddingTop: webSpacing.sm },
  deadlinesTitle: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: 4 },
  activityEmpty: { fontSize: 12, color: webColors.textSecondary, paddingVertical: 4 },
  deadlineRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  deadlineDate: { fontSize: 11, color: webColors.textSecondary, width: 130 },
  deadlineOverdueText: { color: webColors.danger, fontWeight: '700' },
  deadlineLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, paddingRight: webSpacing.sm },
  deadlineAmount: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary, width: 110, textAlign: 'right' },

  viewPlanLink: { marginTop: webSpacing.sm, alignSelf: 'flex-start' },
  viewPlanLinkText: { fontSize: 12, fontWeight: '700', color: webColors.primary },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  actionButton: { backgroundColor: webColors.primary, borderRadius: webRadius.pill, paddingVertical: 10, alignItems: 'center', marginBottom: webSpacing.sm },
  actionButtonText: { color: webColors.textOnPrimary, fontSize: 13, fontWeight: '700' },
});
