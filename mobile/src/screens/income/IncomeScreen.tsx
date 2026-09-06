import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FREQUENCY_LABEL } from '../../ui/frequency';

interface NextOccurrence {
  id: string;
  usualDate: string;
}

interface IncomeSource {
  id: string;
  label: string;
  usualAmount: number;
  recurrenceRule: string | null;
  status: 'actif' | 'inactif';
  occurrences: NextOccurrence[];
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Revenus (recette post-Vague 3 §6/§7) — liste compacte des sources de revenu
 * (une ligne = une source + sa prochaine occurrence prévue), séparée de la
 * création (§7 : bouton dédié → CreateIncomeScreen). Le cycle prévu → reçu
 * reste sur IncomeSourceDetailScreen (inchangé), qui gère aussi désormais
 * modifier/désactiver/supprimer la source elle-même (§5).
 */
export function IncomeScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [sources, setSources] = useState<IncomeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSources(await api.listIncomeSources());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const active = sources.filter((s) => s.status === 'actif');
  const inactive = sources.filter((s) => s.status === 'inactif');

  function renderRow(item: IncomeSource) {
    const next = item.occurrences[0];
    return (
      <TouchableOpacity
        key={item.id}
        testID={`income-row-${item.id}`}
        style={styles.row}
        onPress={() => navigation.navigate('IncomeSourceDetail', { id: item.id, label: item.label })}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowName} numberOfLines={1}>
            {item.label}
          </Text>
          <Text style={styles.rowMeta}>
            {item.recurrenceRule ? FREQUENCY_LABEL[item.recurrenceRule] : 'Ponctuel'}
            {next ? ` · ${formatShortDate(next.usualDate)}` : ''}
          </Text>
        </View>
        <Text style={styles.rowAmount}>{item.usualAmount.toLocaleString('fr-FR')} DH</Text>
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.intro}>Vos revenus reçus régulièrement — anticipés automatiquement.</Text>

      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>REVENUS</Text>
        <TouchableOpacity testID="add-income-button" onPress={() => navigation.navigate('CreateIncome')}>
          <Text style={styles.addLink}>+ Ajouter un revenu</Text>
        </TouchableOpacity>
      </View>

      {loading && sources.length === 0 ? (
        <ActivityIndicator />
      ) : active.length === 0 ? (
        <Text style={styles.empty}>Ajoutez votre salaire ou une autre source de revenu pour suivre vos rentrées d'argent.</Text>
      ) : (
        active.map(renderRow)
      )}

      {inactive.length > 0 && (
        <>
          <TouchableOpacity testID="toggle-inactive-income" style={styles.inactiveToggle} onPress={() => setShowInactive((v) => !v)}>
            <Text style={styles.inactiveToggleText}>
              {showInactive ? 'Masquer' : 'Voir'} les revenus arrêtés ({inactive.length})
            </Text>
          </TouchableOpacity>
          {showInactive && inactive.map(renderRow)}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#6B747C', letterSpacing: 0.5 },
  addLink: { color: '#2E7D5B', fontSize: 13, fontWeight: '700' },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24, fontSize: 13, lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 8 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436', marginLeft: 8 },
  inactiveToggle: { marginTop: 8, marginBottom: 4 },
  inactiveToggleText: { fontSize: 12, fontWeight: '600', color: '#6B747C' },
});
