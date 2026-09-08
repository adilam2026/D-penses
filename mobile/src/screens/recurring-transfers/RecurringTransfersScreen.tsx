import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FREQUENCY_LABEL } from '../../ui/frequency';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface RecurringTransfer {
  id: string;
  label: string;
  fromAccountId: string | null;
  toAccountId: string | null;
  amount: string | number;
  recurrenceRule: string;
  status: 'actif' | 'inactif';
}

interface AccountTransfer {
  id: string;
  recurringTransferId: string | null;
  status: 'prevu' | 'confirme' | 'annule';
  plannedDate: string;
}

interface Account {
  id: string;
  name: string;
}

function n(v: string | number): number {
  return typeof v === 'number' ? v : Number(v);
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * R6.2 corrections finales §4 — "Transferts récurrents" : le backend
 * (RecurringTransfersService) existait déjà, mais aucun écran ne le rendait
 * consultable/gérable — création uniquement via QuickAdd (Ajouter > Transfert
 * > Récurrent). Réutilise le MÊME patron liste que ChargesScreen (une ligne
 * compacte, tap → détail), jamais un nouveau moteur : GET /recurring-transfers
 * + GET /accounts/transfers (filtré côté client par recurringTransferId, même
 * patron que les tests e2e generatedTransfers()) pour le "Prochain transfert".
 */
export function RecurringTransfersScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [transfers, setTransfers] = useState<RecurringTransfer[]>([]);
  const [occurrences, setOccurrences] = useState<AccountTransfer[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rt, tr, acc] = await Promise.all([api.listRecurringTransfers(), api.listTransfers(), api.listAccounts()]);
      setTransfers(rt as RecurringTransfer[]);
      setOccurrences(tr as AccountTransfer[]);
      setAccounts(acc as Account[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? '—';

  function nextOccurrence(recurringTransferId: string): AccountTransfer | null {
    const upcoming = occurrences
      .filter((o) => o.recurringTransferId === recurringTransferId && o.status === 'prevu')
      .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
    return upcoming[0] ?? null;
  }

  const active = transfers.filter((t) => t.status === 'actif');
  const inactive = transfers.filter((t) => t.status === 'inactif');

  function renderRow(t: RecurringTransfer) {
    const next = nextOccurrence(t.id);
    return (
      <TouchableOpacity
        key={t.id}
        testID={`recurring-transfer-row-${t.id}`}
        style={styles.row}
        onPress={() => navigation.navigate('RecurringTransferDetail', { id: t.id })}
      >
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t.label}
        </Text>
        <Text style={styles.rowMeta}>
          {n(t.amount).toLocaleString('fr-FR')} DH · {FREQUENCY_LABEL[t.recurrenceRule] ?? t.recurrenceRule}
        </Text>
        <Text style={styles.rowMeta}>
          {accountName(t.fromAccountId)} → {accountName(t.toAccountId)}
        </Text>
        {t.status === 'inactif' ? (
          <Text style={styles.rowStopped}>Récurrence arrêtée</Text>
        ) : (
          <Text style={styles.rowNext}>{next ? `Prochain transfert : ${formatShortDate(next.plannedDate)}` : 'Aucune occurrence prévue'}</Text>
        )}
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.intro}>Virements automatiques entre vos comptes (épargne, provisions...), générés à leur échéance.</Text>

      <Text style={styles.sectionTitle}>TRANSFERTS RÉCURRENTS</Text>

      {loading && transfers.length === 0 ? (
        <ActivityIndicator />
      ) : active.length === 0 ? (
        <Text style={styles.empty}>Aucun transfert récurrent. Créez-en un depuis Ajouter &gt; Transfert &gt; Récurrent.</Text>
      ) : (
        active.map(renderRow)
      )}

      {inactive.length > 0 && (
        <>
          <TouchableOpacity testID="toggle-inactive-recurring-transfers" style={styles.inactiveToggle} onPress={() => setShowInactive((v) => !v)}>
            <Text style={styles.inactiveToggleText}>
              {showInactive ? 'Masquer' : 'Voir'} les récurrences arrêtées ({inactive.length})
            </Text>
          </TouchableOpacity>
          {showInactive && inactive.map(renderRow)}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: 10 },
  empty: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rowNext: { fontSize: 11, color: colors.primary, fontWeight: '600', marginTop: 4 },
  rowStopped: { fontSize: 11, color: colors.danger, fontWeight: '600', marginTop: 4 },
  inactiveToggle: { marginTop: 8, marginBottom: 4 },
  inactiveToggleText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
});
