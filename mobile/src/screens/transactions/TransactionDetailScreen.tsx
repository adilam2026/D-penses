import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { colors } from '../../ui/theme';

interface TransactionDetail {
  kind: string;
  displayKind: string;
  id: string;
  origin: string;
  label: string;
  amount: number;
  date: string;
  accountId: string;
  accountName: string;
  note: string | null;
  deadline: { id: string; dueDate: string; chargePlanLabel: string } | null;
  financialPlan: { id: string; label: string } | null;
  provisionId: string | null;
  transferCounterpart?: { accountId: string; accountName: string } | null;
}

interface Provision {
  id: string;
  name: string;
}

const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * §5 (recette téléphone réel) — écran détail d'une ligne de transaction, ouvert
 * en tapant une carte de l'écran Transactions. Lecture enrichie uniquement :
 * aucun second calcul, tout vient de GET /transactions/:kind/:id.
 */
export function TransactionDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const kind = route.params?.kind as string;
  const id = route.params?.id as string;

  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [provision, setProvision] = useState<Provision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d: TransactionDetail = await api.getTransactionDetail(kind, id);
      setDetail(d);
      setProvision(d.provisionId ? await api.getProvision(d.provisionId) : null);
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Transaction introuvable');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !detail) {
    return (
      <View style={styles.center} testID="transaction-detail-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error ?? 'Transaction introuvable'}</Text>
      </View>
    );
  }

  const positive = detail.amount >= 0;

  return (
    <ScrollView testID="transaction-detail-scroll" contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <View style={styles.heroCard}>
        <Text style={styles.heroKind}>{KIND_LABEL[detail.displayKind] ?? detail.displayKind}</Text>
        <Text style={styles.heroLabel}>{detail.label}</Text>
        <Text style={[styles.heroAmount, positive ? styles.amountPositive : styles.amountNegative]}>
          {positive ? '+' : ''}
          {detail.amount.toLocaleString('fr-FR')} DH
        </Text>
        <Text style={styles.heroDate}>{formatDate(detail.date)}</Text>
      </View>

      <View style={styles.fieldsCard}>
        <Row label="Compte" value={detail.accountName} />
        {detail.transferCounterpart && <Row label="Compte contrepartie" value={detail.transferCounterpart.accountName} />}
        {provision && <Row label="Enveloppe" value={provision.name} />}
        {detail.note && <Row label="Note" value={detail.note} />}
        <Row label="Origine" value={detail.origin} />
      </View>

      {detail.deadline && (
        <TouchableOpacity
          testID="transaction-detail-deadline-link"
          style={styles.linkCard}
          onPress={() => navigation.navigate('DeadlineDetail', { id: detail.deadline!.id })}
        >
          <Text style={styles.linkTitle}>Échéance liée</Text>
          <Text style={styles.linkValue}>
            {detail.deadline.chargePlanLabel} — {formatDate(detail.deadline.dueDate)}
          </Text>
        </TouchableOpacity>
      )}

      {detail.financialPlan && (
        <TouchableOpacity
          testID="transaction-detail-plan-link"
          style={styles.linkCard}
          onPress={() => navigation.navigate('FinancialPlanDetail', { id: detail.financialPlan!.id })}
        >
          <Text style={styles.linkTitle}>Plan financier lié</Text>
          <Text style={styles.linkValue}>{detail.financialPlan.label}</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: 24 },
  scroll: { padding: 20, backgroundColor: colors.background, flexGrow: 1 },
  heroCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 18, marginBottom: 16 },
  heroKind: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
  heroLabel: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 4 },
  heroAmount: { fontSize: 26, fontWeight: '800', marginTop: 10 },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  heroDate: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  fieldsCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 4, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { fontSize: 13, color: colors.textSecondary },
  rowValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  linkCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  linkTitle: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', fontWeight: '700' },
  linkValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginTop: 4 },
});
