import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';
import { useBottomInset } from '../ui/useBottomInset';
import { useTopInset } from '../ui/useTopInset';
import { useResponsiveLayout } from '../ui/useResponsiveLayout';
import { accountCardPalette, colors, elevation, radius, spacing } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { toNum } from './envelopes/envelopesLogic';

interface TodoCharge {
  kind: 'charge';
  deadlineId: string;
  label: string;
  amount: number;
  dueDate: string;
  accountName: string | null;
}
interface TodoEnvelope {
  kind: 'envelope';
  provisionId: string;
  label: string;
  amount: number;
}
type TodoItem = TodoCharge | TodoEnvelope;

/**
 * Refonte maquette V6B §3 — Accueil = comptes d'abord (jamais de dashboard
 * global, jamais de total revenus/dépenses ici). 2 blocs : "Comptes" (avec
 * enveloppes affectées, jamais additives au solde — §2B) puis "À faire"
 * (charges à payer proches + enveloppes à compléter ce mois).
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
  const { columns } = useResponsiveLayout();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountList, deadlines, provisions] = await Promise.all([
        api.listAccounts(),
        api.listOpenDeadlines(),
        api.listProvisions(),
      ]);
      setAccounts(accountList);
      const accountNameById = Object.fromEntries(accountList.map((a: api.AccountApi) => [a.id, a.name]));

      const now = Date.now();
      const horizon = now + 14 * 86400000;
      const charges: TodoCharge[] = deadlines
        .filter((d: any) => d.amountStatus !== 'inconnu' && d.resteAPayer !== null && new Date(d.dueDate).getTime() <= horizon)
        .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        .slice(0, 5)
        .map((d: any) => ({
          kind: 'charge' as const,
          deadlineId: d.id,
          label: d.chargePlan?.label ?? 'Échéance',
          amount: toNum(d.resteAPayer),
          dueDate: d.dueDate,
          accountName: d.chargePlan?.defaultAccountId ? accountNameById[d.chargePlan.defaultAccountId] ?? null : null,
        }));

      const envelopeTodos: TodoEnvelope[] = [];
      for (const p of provisions) {
        const sufficiency = await api.getProvisionSufficiency(p.id);
        const amount = toNum(sufficiency.versementMensuelRecommande);
        if (amount > 0) {
          envelopeTodos.push({ kind: 'envelope', provisionId: p.id, label: p.name, amount });
        }
      }

      setTodos([...charges, ...envelopeTodos]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const cardWidthStyle = columns > 1 ? { width: `${100 / columns - 2}%` as const } : { width: '100%' as const };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom, paddingHorizontal: spacing.lg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.pageTitle}>Comptes</Text>
          <Text style={styles.pageSubtitle}>Où est l'argent et à quoi il est affecté.</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.getParent()?.navigate('QuickAdd', { mode: 'depense' })}>
          <Text style={styles.headerAction}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {accounts
          .filter((a) => a.showOnHome !== false)
          .map((account, index) => (
            <AccountCard
              key={account.id}
              account={account}
              color={accountCardPalette[index % accountCardPalette.length]}
              style={cardWidthStyle}
              onPress={() => navigation.navigate('AccountDetail', { id: account.id })}
            />
          ))}
      </View>

      {!loading && accounts.length === 0 && <Text style={styles.empty}>Aucun compte pour l'instant.</Text>}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>À faire</Text>
      </View>

      {todos.length === 0 && !loading ? (
        <Text style={styles.empty}>Rien à faire pour le moment.</Text>
      ) : (
        <View style={styles.todoCard}>
          {todos.map((item, idx) => (
            <View key={item.kind === 'charge' ? item.deadlineId : item.provisionId} style={[styles.todoRow, idx > 0 && styles.todoRowBorder]}>
              <View style={styles.todoIcon}>
                <Text style={styles.todoIconText}>{String(idx + 1).padStart(2, '0')}</Text>
              </View>
              <View style={styles.todoMain}>
                <Text style={styles.todoTitle}>{item.label}</Text>
                {item.kind === 'charge' ? (
                  <Text style={styles.todoSub}>
                    {formatShortDate(item.dueDate)}
                    {item.accountName ? ` • ${item.accountName}` : ''}
                  </Text>
                ) : (
                  <Text style={styles.todoSub}>Compléter la provision du mois</Text>
                )}
              </View>
              <Text style={styles.todoAmount}>{formatDh(item.amount)}</Text>
              {item.kind === 'charge' ? (
                <TouchableOpacity
                  testID={`home-todo-pay-${item.deadlineId}`}
                  style={styles.primaryButton}
                  onPress={() => navigation.getParent()?.navigate('DeadlineDetail', { id: item.deadlineId })}
                >
                  <Text style={styles.primaryButtonText}>Payer</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  testID={`home-todo-verser-${item.provisionId}`}
                  style={styles.softButton}
                  onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })}
                >
                  <Text style={styles.softButtonText}>Verser</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function AccountCard({
  account,
  color,
  style,
  onPress,
}: {
  account: api.AccountApi;
  color: string;
  style: any;
  onPress: () => void;
}) {
  const total = account.soldeCourant || 1;
  const badge = account.isDedicated
    ? 'Dédié'
    : account.envelopes.length > 0
      ? `${account.envelopes.length} enveloppe${account.envelopes.length > 1 ? 's' : ''}`
      : account.type === 'courant'
        ? 'Courant'
        : account.type === 'epargne'
          ? 'Épargne'
          : 'Compte';

  return (
    <TouchableOpacity testID={`home-account-card-${account.id}`} style={[styles.accountCard, style]} onPress={onPress}>
      <View style={styles.accountHead}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.accountBank}>{(account.bankName ?? '').toUpperCase()}</Text>
          <Text style={styles.accountName}>{account.name}</Text>
          <Text style={styles.accountBalance}>{formatDh(account.soldeCourant)}</Text>
        </View>
        <Text style={styles.accountBadge}>{badge}</Text>
      </View>

      {account.envelopes.length > 1 && (
        <View style={styles.miniTrack}>
          {account.envelopes.map((e, i) => (
            <View
              key={e.id}
              style={{
                width: `${Math.max(0, Math.min(100, (e.amount / total) * 100))}%`,
                height: '100%',
                backgroundColor: [colors.v6Blue, colors.v6Teal, colors.v6Purple, colors.v6Gold][i % 4],
              }}
            />
          ))}
        </View>
      )}

      {account.envelopes.length > 0 && (
        <View style={styles.accountBody}>
          {account.envelopes.map((e, i) => (
            <View key={e.id} style={styles.allocRow}>
              <View style={styles.allocLeft}>
                <View style={[styles.swatch, { backgroundColor: [colors.v6Blue, colors.v6Teal, colors.v6Purple, colors.v6Gold][i % 4] }]} />
                <View>
                  <Text style={styles.allocName}>{e.name}</Text>
                  <Text style={styles.allocSub}>{e.subtitle === 'plan_financier' ? 'Plan financier' : 'Réserve'}</Text>
                </View>
              </View>
              <Text style={styles.allocAmount}>{formatDh(e.amount)}</Text>
            </View>
          ))}
        </View>
      )}

      {account.isDedicated && (
        <View style={styles.sourceNote}>
          <Text style={styles.sourceNoteText}>
            {account.dedicatedFeed
              ? `Alimenté depuis ${account.dedicatedFeed.fromAccountName} • ${formatDh(account.dedicatedFeed.amount)} / mois`
              : "Compte dédié — aucun virement récurrent d'alimentation configuré."}
          </Text>
        </View>
      )}

      {!account.isDedicated && account.envelopes.length === 0 && (
        <View style={styles.sourceNote}>
          <Text style={styles.sourceNoteText}>Aucune enveloppe associée.</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.7, color: colors.v6Text },
  pageSubtitle: { marginTop: 5, fontSize: 13, color: colors.v6Muted },
  headerAction: { color: colors.v6Blue, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  accountCard: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    padding: spacing.md + 2,
    marginBottom: spacing.md,
    ...elevation.card,
  },
  accountHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' },
  accountBank: { fontSize: 12, color: colors.v6Muted, fontWeight: '700' },
  accountName: { fontSize: 14, fontWeight: '800', marginTop: 2, color: colors.v6Text },
  accountBalance: { fontSize: 28, fontWeight: '900', letterSpacing: -0.8, marginTop: 8, color: colors.v6Text },
  accountBadge: { fontSize: 10, fontWeight: '800', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.v6BlueSoft, color: colors.v6Blue },
  miniTrack: { marginTop: spacing.md, height: 6, borderRadius: 999, backgroundColor: '#EDF0F4', overflow: 'hidden', flexDirection: 'row' },
  accountBody: { marginTop: spacing.md, paddingTop: spacing.sm + 2, borderTopWidth: 1, borderTopColor: colors.v6Line },
  allocRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 7 },
  allocLeft: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  allocName: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  allocSub: { fontSize: 10, color: colors.v6Muted, marginTop: 2 },
  allocAmount: { fontSize: 13, fontWeight: '850' as any, color: colors.v6Text },
  sourceNote: { marginTop: spacing.sm + 2, padding: spacing.sm + 1, borderRadius: radius.md, backgroundColor: colors.v6SurfaceSoft },
  sourceNoteText: { color: '#59677A', fontSize: 11 },
  empty: { textAlign: 'center', color: colors.v6Muted, marginTop: spacing.lg, fontSize: 13 },
  sectionHead: { marginTop: spacing.xl, marginBottom: spacing.sm + 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.v6Text },
  todoCard: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md + 2,
    ...elevation.card,
  },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
  todoRowBorder: { borderTopWidth: 1, borderTopColor: colors.v6Line },
  todoIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.v6SurfaceSoft, alignItems: 'center', justifyContent: 'center' },
  todoIconText: { color: colors.v6Navy, fontWeight: '800', fontSize: 12 },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  todoSub: { fontSize: 10, color: colors.v6Muted, marginTop: 3 },
  todoAmount: { fontSize: 13, fontWeight: '850' as any, color: colors.v6Text, marginRight: spacing.sm },
  primaryButton: { backgroundColor: colors.v6Navy, borderRadius: radius.md, paddingHorizontal: spacing.sm + 3, paddingVertical: spacing.sm },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  softButton: { backgroundColor: colors.v6BlueSoft, borderRadius: radius.md, paddingHorizontal: spacing.sm + 3, paddingVertical: spacing.sm },
  softButtonText: { color: colors.v6Blue, fontWeight: '800', fontSize: 12 },
});
