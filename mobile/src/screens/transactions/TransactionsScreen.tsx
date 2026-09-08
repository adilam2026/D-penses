import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface LedgerEntry {
  kind: string;
  displayKind: string;
  id: string;
  occurredAt: string;
  amount: number;
  accountName: string;
  // Vague 2 §20 : quand un Type est renseigné (Courses, Carburant...), le backend
  // construit déjà `label` en "Type · Sous-type" (ex. "Courses · Viande") — jamais
  // recalculé côté mobile, la catégorie parente reste affichée séparément ci-dessous.
  label: string | null;
  categoryName: string | null;
  categoryTypeName: string | null;
  categorySubtypeName: string | null;
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
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Aucune transaction pour l'instant.</Text>
              <Text style={styles.emptyText}>Vos dépenses et revenus confirmés apparaîtront ici.</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
                <Text style={styles.emptyButtonText}>+ Ajouter une transaction</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const positive = item.amount >= 0;
          return (
            <TouchableOpacity
              testID={`transaction-row-${item.kind}-${item.id}`}
              style={styles.row}
              onPress={() => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id })}
            >
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
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 56, paddingHorizontal: spacing.xl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.lg },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  addButton: { backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: colors.textOnPrimary, fontSize: 18, fontWeight: '700' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl },
  emptyState: { alignItems: 'center', marginTop: 48, paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary, textAlign: 'center' },
  emptyText: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
  emptyButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, marginTop: spacing.xl },
  emptyButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowLeft: { flexShrink: 1, paddingRight: spacing.sm },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 14, fontWeight: '700' },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  rowKind: { fontSize: 11, color: colors.textSecondary, marginTop: 2, textTransform: 'uppercase' },
});
