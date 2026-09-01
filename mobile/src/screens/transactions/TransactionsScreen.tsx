import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface LedgerEntry {
  kind: string;
  displayKind: string;
  id: string;
  occurredAt: string;
  amount: number;
  accountName: string;
  label: string | null;
  categoryName: string | null;
}

const KIND_LABEL: Record<string, string> = {
  revenu: 'Revenu',
  paiement: 'Paiement',
  depense: 'Dépense',
  transfert: 'Transfert',
  ajustement: 'Ajustement',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Écran Transactions (§13) — affiche LedgerEntry (docs/04 §P.2), purement dérivée
 * en lecture seule : aucune table "Transaction" source de vérité n'est créée ici.
 */
export function TransactionsScreen() {
  const navigation = useNavigation<any>();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.listTransactions());
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
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Transactions</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
          <Text style={styles.addButtonText}>+</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={!loading ? <Text style={styles.empty}>Aucune opération pour l'instant.</Text> : null}
        renderItem={({ item }) => {
          const positive = item.amount >= 0;
          return (
            <View style={styles.row}>
              <View style={styles.rowLeft}>
                <Text style={styles.rowLabel}>{item.label ?? KIND_LABEL[item.displayKind] ?? item.kind}</Text>
                <Text style={styles.rowMeta}>
                  {formatDate(item.occurredAt)} · {item.accountName}
                  {item.categoryName ? ` · ${item.categoryName}` : ''}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={[styles.rowAmount, positive ? styles.amountPositive : styles.amountNegative]}>
                  {positive ? '+' : ''}
                  {item.amount.toLocaleString('fr-FR')} DH
                </Text>
                <Text style={styles.rowKind}>{KIND_LABEL[item.displayKind] ?? item.displayKind}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 56, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436' },
  addButton: { backgroundColor: '#172436', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  empty: { color: '#6B747C', textAlign: 'center', marginTop: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowLeft: { flexShrink: 1, paddingRight: 8 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  amountPositive: { color: '#2E7D5B' },
  amountNegative: { color: '#B3261E' },
  rowKind: { fontSize: 11, color: '#6B747C', marginTop: 2, textTransform: 'uppercase' },
});
