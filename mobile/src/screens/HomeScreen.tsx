import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';

interface DashboardSummary {
  operational_treasury: number;
  free_available: number;
  reserved_amount: number;
  committed_amount: number;
  safety_buffer: number;
  patrimoine_liquide_total: number;
  is_complete: boolean;
  contains_estimates: boolean;
  unknown_commitments_count: number;
  optionsEnvisagees: { total: number; hasUnknown: boolean };
  prochaineEcheance: { chargePlanLabel: string; dueDate: string; amountStatus: string; resteAPayer: number | null } | null;
  actionsATraiter: Array<{ message: string }>;
  budgetsResume: Array<{ id: string; categoryName: string; referenceAmount: number; referencePeriod: string; status: { budgetContractuelRestant: number } }>;
  financialPlansResume: Array<{ id: string; label: string; knownPlanCost: number; remainingDue: number; completude: string }>;
  provisionsResume: Array<{ id: string; name: string; currentAmount: number; totalResteAPayer: number; totalUncovered: number }>;
  next_30_days: {
    closing_physical_treasury: number;
    physical_low_point: number;
    physical_low_point_date: string;
    free_capacity_low_point: number;
    free_capacity_low_point_date: string;
    first_negative_date: string | null;
    deficit_at_first_negative: number | null;
    status: 'OK' | 'TENSION' | 'DEFICIT_PHYSIQUE' | 'INCOMPLETE';
    is_complete: boolean;
  };
}

const PROJECTION_STATUS_LABEL: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: 'Stable',
  TENSION: 'Tension',
  DEFICIT_PHYSIQUE: 'Déficit prévu',
  INCOMPLETE: 'Projection incomplète',
};

const PROJECTION_STATUS_COLOR: Record<DashboardSummary['next_30_days']['status'], string> = {
  OK: '#2E7D5B',
  TENSION: '#B8860B',
  DEFICIT_PHYSIQUE: '#B3261E',
  INCOMPLETE: '#6B747C',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Dashboard V1 (§12) — ordre : Trésorerie opérationnelle / Disponible libre en
 * premier, puis Montants réservés/engagés/coussin, puis Prochaine échéance,
 * Actions à traiter, résumé Budgets/Plans. Patrimoine liquide total reste
 * accessible mais secondaire. Jamais un tableau comptable.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<string | null>(null);
  const [invitingLoading, setInvitingLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await api.getDashboardSummary());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onInvite() {
    setInvitingLoading(true);
    try {
      const res = await api.createInvite();
      setInvite(res.code);
    } finally {
      setInvitingLoading(false);
    }
  }

  if (loading && !summary) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!summary) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Accueil</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Trésorerie opérationnelle</Text>
        <Text style={styles.heroValue}>{summary.operational_treasury.toLocaleString('fr-FR')} DH</Text>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Disponible libre</Text>
        <Text style={[styles.heroValue, summary.free_available < 0 && styles.negative]}>{summary.free_available.toLocaleString('fr-FR')} DH</Text>
        <Text style={styles.heroHelp}>Ce qui reste après vos engagements, réserves et votre coussin de sécurité.</Text>
        {!summary.is_complete && (
          <Text style={styles.warning}>⚠ Calcul incomplet — {summary.unknown_commitments_count} montant(s) encore inconnu(s) dans l'horizon.</Text>
        )}
        {summary.contains_estimates && summary.is_complete && <Text style={styles.info}>Inclut des montants estimés.</Text>}
      </View>

      <TouchableOpacity style={styles.heroCard} onPress={() => navigation.getParent()?.navigate('Projection')}>
        <Text style={styles.heroLabel}>30 prochains jours</Text>
        <Text style={styles.heroValue}>{summary.next_30_days.closing_physical_treasury.toLocaleString('fr-FR')} DH</Text>
        <Text style={styles.heroHelp}>
          Point bas : {summary.next_30_days.physical_low_point.toLocaleString('fr-FR')} DH · Disponible libre minimum :{' '}
          {summary.next_30_days.free_capacity_low_point.toLocaleString('fr-FR')} DH
        </Text>
        <Text style={[styles.projectionStatus, { color: PROJECTION_STATUS_COLOR[summary.next_30_days.status] }]}>
          {PROJECTION_STATUS_LABEL[summary.next_30_days.status]}
        </Text>
        {summary.next_30_days.status === 'DEFICIT_PHYSIQUE' && summary.next_30_days.first_negative_date && (
          <Text style={styles.warning}>
            Risque de {summary.next_30_days.deficit_at_first_negative?.toLocaleString('fr-FR')} DH le{' '}
            {new Date(summary.next_30_days.first_negative_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })}
          </Text>
        )}
      </TouchableOpacity>

      <View style={styles.figuresRow}>
        <Figure label="Montants réservés" value={summary.reserved_amount} />
        <Figure label="Montants engagés" value={summary.committed_amount} />
        <Figure label="Coussin de sécurité" value={summary.safety_buffer} />
      </View>
      <Text style={styles.secondaryLine}>Patrimoine liquide total : {summary.patrimoine_liquide_total.toLocaleString('fr-FR')} DH</Text>

      <Text style={styles.sectionTitle}>Prochaine échéance</Text>
      {summary.prochaineEcheance ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{summary.prochaineEcheance.chargePlanLabel}</Text>
          <Text style={styles.cardMeta}>{formatDate(summary.prochaineEcheance.dueDate)}</Text>
          <Text style={styles.cardAmount}>
            {summary.prochaineEcheance.amountStatus === 'inconnu' || summary.prochaineEcheance.resteAPayer === null
              ? 'Montant à confirmer'
              : `${summary.prochaineEcheance.resteAPayer.toLocaleString('fr-FR')} DH restants`}
          </Text>
        </View>
      ) : (
        <Text style={styles.empty}>Aucune échéance à venir.</Text>
      )}

      {summary.optionsEnvisagees.total > 0 && (
        <Text style={styles.secondaryLine}>
          Options envisagées : {summary.optionsEnvisagees.total.toLocaleString('fr-FR')} DH{summary.optionsEnvisagees.hasUnknown ? ' (+ montants inconnus)' : ''}
        </Text>
      )}

      <Text style={styles.sectionTitle}>Actions à traiter</Text>
      {summary.actionsATraiter.length === 0 ? (
        <Text style={styles.empty}>Rien à traiter pour l'instant.</Text>
      ) : (
        summary.actionsATraiter.slice(0, 5).map((a, i) => (
          <View key={i} style={styles.actionRow}>
            <Text style={styles.actionText}>{a.message}</Text>
          </View>
        ))
      )}

      {summary.budgetsResume.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Budgets variables</Text>
          {summary.budgetsResume.map((b) => (
            <TouchableOpacity key={b.id} style={styles.card} onPress={() => navigation.getParent()?.navigate('BudgetDetail', { id: b.id })}>
              <Text style={styles.cardTitle}>
                {b.categoryName} — {b.referenceAmount.toLocaleString('fr-FR')} DH/{b.referencePeriod}
              </Text>
              <Text style={styles.cardMeta}>{b.status.budgetContractuelRestant.toLocaleString('fr-FR')} DH restants</Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {summary.financialPlansResume.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Plans financiers</Text>
          {summary.financialPlansResume.map((p) => (
            <TouchableOpacity key={p.id} style={styles.card} onPress={() => navigation.getParent()?.navigate('FinancialPlanDetail', { id: p.id })}>
              <Text style={styles.cardTitle}>{p.label}</Text>
              <Text style={styles.cardMeta}>
                Connu {p.knownPlanCost.toLocaleString('fr-FR')} DH · Reste {p.remainingDue.toLocaleString('fr-FR')} DH
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      {summary.provisionsResume.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Provisions</Text>
          {summary.provisionsResume.map((p) => (
            <TouchableOpacity key={p.id} style={styles.card} onPress={() => navigation.getParent()?.navigate('PocketDetail', { kind: 'provision', id: p.id })}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              <Text style={styles.cardMeta}>
                {p.currentAmount.toLocaleString('fr-FR')} DH provisionnés · {p.totalResteAPayer.toLocaleString('fr-FR')} DH à payer
                {p.totalUncovered > 0 ? ` · ${p.totalUncovered.toLocaleString('fr-FR')} DH encore à couvrir` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </>
      )}

      <TouchableOpacity style={styles.inviteButton} onPress={onInvite} disabled={invitingLoading}>
        {invitingLoading ? <ActivityIndicator /> : <Text style={styles.inviteButtonText}>Inviter un second adulte</Text>}
      </TouchableOpacity>
      {invite ? <Text style={styles.inviteCode}>Code d'invitation : {invite}</Text> : null}
    </ScrollView>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 56 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436' },
  addButton: { backgroundColor: '#172436', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  heroCard: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 12 },
  heroLabel: { fontSize: 13, color: '#6B747C', fontWeight: '600' },
  heroValue: { fontSize: 28, fontWeight: '800', color: '#172436', marginTop: 4 },
  negative: { color: '#B3261E' },
  heroHelp: { fontSize: 11, color: '#6B747C', marginTop: 6, fontStyle: 'italic' },
  warning: { fontSize: 12, color: '#B8860B', marginTop: 8, fontWeight: '600' },
  info: { fontSize: 12, color: '#6B747C', marginTop: 8 },
  projectionStatus: { fontSize: 12, fontWeight: '800', marginTop: 8 },
  figuresRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  figure: { flex: 1, backgroundColor: '#fff', borderRadius: 10, padding: 12, marginRight: 8 },
  figureLabel: { fontSize: 10, color: '#6B747C' },
  figureValue: { fontSize: 13, fontWeight: '700', color: '#172436', marginTop: 4 },
  secondaryLine: { fontSize: 11, color: '#6B747C', marginTop: 8, marginBottom: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 20, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  cardAmount: { fontSize: 13, fontWeight: '700', color: '#172436', marginTop: 4 },
  actionRow: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  actionText: { fontSize: 12, color: '#172436' },
  inviteButton: { marginTop: 24, alignItems: 'center' },
  inviteButtonText: { color: '#172436', fontSize: 13, fontWeight: '600' },
  inviteCode: { marginTop: 8, fontSize: 16, fontWeight: '700', color: '#172436', letterSpacing: 1, textAlign: 'center' },
});
