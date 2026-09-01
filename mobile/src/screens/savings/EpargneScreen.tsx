import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Pocket {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  isProtected: boolean;
  currentAmount: number;
  targetAmount: number | null;
}

interface Provision {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  currentAmount: number;
}

/**
 * Épargne / Provisions (§27) — poches et provisions dans une même vue, jamais
 * confondues avec un solde de compte bancaire (§2). Le badge « protégée » (RG-047)
 * n'a aucune action associée : rien ne la mobilise automatiquement (§22).
 */
export function EpargneScreen() {
  const navigation = useNavigation<any>();
  const [pockets, setPockets] = useState<Pocket[]>([]);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, pr] = await Promise.all([api.listPockets(), api.listProvisions()]);
      setPockets(p);
      setProvisions(pr);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Épargne</Text>
        <TouchableOpacity style={styles.goalsButton} onPress={() => navigation.getParent()?.navigate('Goals')}>
          <Text style={styles.goalsButtonText}>Objectifs</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Provisions</Text>
        <TouchableOpacity onPress={() => navigation.getParent()?.navigate('CreatePocket', { kind: 'provision' })}>
          <Text style={styles.addLink}>+ Provision</Text>
        </TouchableOpacity>
      </View>
      {provisions.length === 0 && !loading ? (
        <Text style={styles.empty}>Aucune provision pour l'instant.</Text>
      ) : (
        provisions.map((p) => (
          <TouchableOpacity key={p.id} style={styles.card} onPress={() => navigation.getParent()?.navigate('PocketDetail', { kind: 'provision', id: p.id })}>
            <Text style={styles.cardTitle}>{p.name}</Text>
            <Text style={styles.cardAmount}>{p.currentAmount.toLocaleString('fr-FR')} DH</Text>
            <Text style={styles.cardMeta}>{p.allocationMode === 'backed_by_account' ? 'Compte dédié' : 'Réservation virtuelle'}</Text>
          </TouchableOpacity>
        ))
      )}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Poches d'épargne</Text>
        <TouchableOpacity onPress={() => navigation.getParent()?.navigate('CreatePocket', { kind: 'pocket' })}>
          <Text style={styles.addLink}>+ Poche</Text>
        </TouchableOpacity>
      </View>
      {pockets.length === 0 && !loading ? (
        <Text style={styles.empty}>Aucune poche pour l'instant.</Text>
      ) : (
        pockets.map((p) => (
          <TouchableOpacity key={p.id} style={styles.card} onPress={() => navigation.getParent()?.navigate('PocketDetail', { kind: 'pocket', id: p.id })}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{p.name}</Text>
              {p.isProtected && <Text style={styles.protectedBadge}>Protégée</Text>}
            </View>
            <Text style={styles.cardAmount}>
              {p.currentAmount.toLocaleString('fr-FR')} DH
              {p.targetAmount ? ` / ${p.targetAmount.toLocaleString('fr-FR')} DH` : ''}
            </Text>
            <Text style={styles.cardMeta}>{p.allocationMode === 'backed_by_account' ? 'Compte dédié' : 'Réservation virtuelle'}</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 56 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436' },
  goalsButton: { backgroundColor: '#172436', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  goalsButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  addLink: { color: '#2E7D5B', fontSize: 13, fontWeight: '600' },
  empty: { color: '#6B747C', fontSize: 13, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  protectedBadge: { fontSize: 10, fontWeight: '700', color: '#2E7D5B', backgroundColor: '#E6F2EC', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  cardAmount: { fontSize: 18, fontWeight: '800', color: '#172436', marginTop: 6 },
  cardMeta: { fontSize: 11, color: '#6B747C', marginTop: 4 },
});
