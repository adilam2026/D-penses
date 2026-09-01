import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface DeadlineRow {
  id: string;
  chargePlanLabel: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  financialStatus: string;
}

interface UnknownItem {
  chargePlanId: string;
  label: string;
  deadlineId: string;
}

interface EnvisagedItem {
  chargePlanId: string;
  label: string;
  amountKnown: boolean;
}

interface FinancialPlanDetail {
  label: string;
  knownPlanCost: number;
  paidAmount: number;
  remainingDue: number;
  provisionCoverage: number;
  remainingToFund: number;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
  deadlinesCertain: DeadlineRow[];
  envisagedItems: EnvisagedItem[];
  envisagedTotal: number;
  unknownItems: UnknownItem[];
}

const COMPLETUDE_LABEL: Record<FinancialPlanDetail['completude'], string> = {
  complet: 'Budget total : complet',
  contient_estimations: 'Contient des estimations — total non définitif',
  contient_inconnues: 'Au moins ce montant identifié — budget incomplet',
};

/** Vue plan financier (§15) — jamais une grille de tableur, jamais un faux total définitif. */
export function FinancialPlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<FinancialPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await api.getFinancialPlan(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>{detail.label}</Text>
      <Text style={styles.completude}>{COMPLETUDE_LABEL[detail.completude]}</Text>

      <View style={styles.figuresGrid}>
        <Figure label="Budget connu" value={detail.knownPlanCost} />
        <Figure label="Payé" value={detail.paidAmount} />
        <Figure label="Reste à payer" value={detail.remainingDue} />
        <Figure label="Provisionné" value={detail.provisionCoverage} />
        <Figure label="Reste à financer" value={detail.remainingToFund} highlight />
      </View>

      <Text style={styles.sectionTitle}>Échéances</Text>
      {detail.deadlinesCertain.length === 0 ? (
        <Text style={styles.empty}>Aucune échéance certaine pour l'instant.</Text>
      ) : (
        detail.deadlinesCertain.map((d) => (
          <TouchableOpacity
            key={d.id}
            style={styles.row}
            onPress={() => d.amountStatus !== 'confirme' && navigation.getParent()?.navigate('ConfirmDeadline', { id: d.id })}
          >
            <View>
              <Text style={styles.rowLabel}>{d.chargePlanLabel}</Text>
              <Text style={styles.rowMeta}>
                {d.amountStatus === 'confirme' ? 'Confirmé' : d.amountStatus === 'estime' ? 'Estimé — appuyer pour confirmer' : 'Inconnu'}
              </Text>
            </View>
            <Text style={styles.rowAmount}>{d.resteAPayer !== null ? `${Number(d.resteAPayer).toLocaleString('fr-FR')} DH restants` : '—'}</Text>
          </TouchableOpacity>
        ))
      )}

      <Text style={styles.sectionTitle}>Options envisagées</Text>
      {detail.envisagedItems.length === 0 ? (
        <Text style={styles.empty}>Aucune option envisagée.</Text>
      ) : (
        <>
          {detail.envisagedItems.map((i) => (
            <View key={i.chargePlanId} style={styles.rowSimple}>
              <Text style={styles.rowLabel}>{i.label}</Text>
              <Text style={styles.rowMeta}>{i.amountKnown ? 'Montant connu' : 'À décider'}</Text>
            </View>
          ))}
          <Text style={styles.optionTotal}>Options envisagées : {detail.envisagedTotal.toLocaleString('fr-FR')} DH (jamais inclus ci-dessus)</Text>
        </>
      )}

      <Text style={styles.sectionTitle}>Éléments inconnus</Text>
      {detail.unknownItems.length === 0 ? (
        <Text style={styles.empty}>Aucun montant inconnu.</Text>
      ) : (
        detail.unknownItems.map((i) => (
          <TouchableOpacity key={i.deadlineId} style={styles.rowSimple} onPress={() => navigation.getParent()?.navigate('ConfirmDeadline', { id: i.deadlineId })}>
            <Text style={styles.rowLabel}>{i.label}</Text>
            <Text style={styles.rowMeta}>À confirmer</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

function Figure({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436' },
  completude: { fontSize: 12, color: '#B8860B', marginTop: 4, marginBottom: 16, fontStyle: 'italic' },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  figure: { width: '50%', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 16, fontWeight: '700', color: '#172436', marginTop: 4 },
  figureValueHighlight: { color: '#B3261E' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowSimple: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
  optionTotal: { fontSize: 11, color: '#6B747C', marginTop: 4, marginBottom: 4, fontStyle: 'italic' },
});
