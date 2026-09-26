import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';
import { cached } from '../state/cache';
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

/** Nouvelle direction visuelle (reset design D-Penses+) — Accueil = comptes
 * d'abord (jamais de dashboard global, jamais de total revenus/dépenses ici,
 * décision produit conservée), puis "À faire". Seul ce qui est VISIBLE change :
 * couleur appliquée réellement (badges pleins, accents de carte, urgence
 * colorée) plutôt que confinée à de minuscules pastilles, sur un fond moins
 * blanc/administratif. Chargement : `cached()` évite de refetcher comptes/
 * échéances/provisions à chaque focus (30s), et le calcul de "à verser" par
 * provision est parallélisé (Promise.all) au lieu d'un aller-retour réseau
 * séquentiel par provision.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
  const { columns } = useResponsiveLayout();
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [accountList, deadlines, provisions] = await Promise.all([
        cached('accounts', () => api.listAccounts(), undefined, force),
        cached('openDeadlines', () => api.listOpenDeadlines(), undefined, force),
        cached('provisions', () => api.listProvisions(), undefined, force),
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

      // Perf — auparavant : une requête réseau par provision, l'une après
      // l'autre (await dans une boucle for). Désormais parallélisé.
      const sufficiencies = await Promise.all(
        provisions.map((p: any) => cached(`provisionSufficiency:${p.id}`, () => api.getProvisionSufficiency(p.id), undefined, force)),
      );
      const provisionAmounts: Array<{ p: any; amount: number }> = provisions.map((p: any, i: number) => ({
        p,
        amount: toNum(sufficiencies[i].versementMensuelRecommande),
      }));
      const envelopeTodos: TodoEnvelope[] = provisionAmounts
        .filter((x) => x.amount > 0)
        .map((x) => ({ kind: 'envelope' as const, provisionId: x.p.id, label: x.p.name, amount: x.amount }));

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
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.pageTitle}>Comptes</Text>
          <Text style={styles.pageSubtitle}>Où est l'argent et à quoi il est affecté.</Text>
        </View>
        <TouchableOpacity style={styles.headerActionButton} onPress={() => navigation.getParent()?.navigate('QuickAdd', { mode: 'depense' })}>
          <Text style={styles.headerActionButtonText}>＋ Ajouter</Text>
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
        <View style={styles.sectionDot} />
        <Text style={styles.sectionTitle}>À faire</Text>
      </View>

      {todos.length === 0 && !loading ? (
        <Text style={styles.empty}>Rien à faire pour le moment.</Text>
      ) : (
        <View style={styles.todoCard}>
          {todos.map((item, idx) => {
            const urgency = todoUrgency(item);
            return (
              <View key={item.kind === 'charge' ? item.deadlineId : item.provisionId} style={[styles.todoRow, idx > 0 && styles.todoRowBorder]}>
                <View style={[styles.todoIcon, { backgroundColor: urgency.soft }]}>
                  <Text style={[styles.todoIconText, { color: urgency.solid }]}>{String(idx + 1).padStart(2, '0')}</Text>
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
                    style={[styles.primaryButton, { backgroundColor: urgency.solid }]}
                    onPress={() => navigation.getParent()?.navigate('DeadlineDetail', { id: item.deadlineId })}
                  >
                    <Text style={styles.primaryButtonText}>Payer</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    testID={`home-todo-verser-${item.provisionId}`}
                    style={[styles.softButton, { backgroundColor: urgency.soft }]}
                    onPress={() => navigation.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })}
                  >
                    <Text style={[styles.softButtonText, { color: urgency.solid }]}>Verser</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}

/** Code couleur d'urgence — échéance proche/passée = ambre, réserve à
 * compléter = teal (épargne), jamais rouge hors retard réel (le rouge reste
 * réservé aux vraies anomalies ailleurs dans l'app). */
function todoUrgency(item: TodoItem): { solid: string; soft: string } {
  if (item.kind === 'envelope') return { solid: colors.v6Teal, soft: colors.v6TealSoft };
  const days = (new Date(item.dueDate).getTime() - Date.now()) / 86400000;
  if (days < 3) return { solid: colors.v6Red, soft: colors.v6RedSoft };
  if (days < 7) return { solid: colors.v6Amber, soft: colors.v6AmberSoft };
  return { solid: colors.v6Blue, soft: colors.v6BlueSoft };
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
  const initial = (account.bankName || account.name || '?').trim().charAt(0).toUpperCase();
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
      <View style={[styles.accountCardAccent, { backgroundColor: color }]} />
      <View style={styles.accountHead}>
        <View style={styles.accountHeadLeft}>
          <View style={[styles.accountInitial, { backgroundColor: color }]}>
            <Text style={styles.accountInitialText}>{initial}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.accountBank}>
              {(account.bankName ?? '').toUpperCase()}
              {account.bankName && account.ownerLabel ? ' • ' : ''}
              {account.ownerLabel ?? ''}
            </Text>
            <Text style={styles.accountName}>{account.name}</Text>
          </View>
        </View>
        <Text style={styles.accountBadge}>{badge}</Text>
      </View>

      <Text style={styles.accountBalance}>{formatDh(account.soldeCourant)}</Text>

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
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: spacing.md },
  pageTitle: { fontSize: 26, fontWeight: '800', letterSpacing: -0.7, color: colors.v6Text },
  pageSubtitle: { marginTop: 5, fontSize: 13, color: colors.v6Muted },
  headerActionButton: { backgroundColor: colors.v6Navy, borderRadius: radius.pill, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2 },
  headerActionButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  accountCard: {
    backgroundColor: colors.v6Surface,
    borderWidth: 1,
    borderColor: colors.v6Line,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
    paddingTop: spacing.sm + 4 + 3,
    marginBottom: spacing.sm + 2,
    overflow: 'hidden',
    ...elevation.card,
  },
  accountCardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  accountHead: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'flex-start' },
  accountHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  accountInitial: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  accountInitialText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  accountBank: { fontSize: 10, color: colors.v6Muted, fontWeight: '700' },
  accountName: { fontSize: 13, fontWeight: '800', marginTop: 1, color: colors.v6Text },
  accountBalance: { fontSize: 22, fontWeight: '900', letterSpacing: -0.6, marginTop: spacing.sm + 2, color: colors.v6Text },
  accountBadge: { fontSize: 10, fontWeight: '800', paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.v6BlueSoft, color: colors.v6Blue },
  miniTrack: { marginTop: spacing.sm, height: 5, borderRadius: 999, backgroundColor: '#EDF0F4', overflow: 'hidden', flexDirection: 'row' },
  accountBody: { marginTop: spacing.sm, paddingTop: spacing.xs + 2, borderTopWidth: 1, borderTopColor: colors.v6Line },
  allocRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 4 },
  allocLeft: { flexDirection: 'row', alignItems: 'center', gap: 9, flexShrink: 1 },
  swatch: { width: 8, height: 8, borderRadius: 4 },
  allocName: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  allocSub: { fontSize: 10, color: colors.v6Muted, marginTop: 2 },
  allocAmount: { fontSize: 13, fontWeight: '850' as any, color: colors.v6Text },
  sourceNote: { marginTop: spacing.sm + 2, padding: spacing.sm + 1, borderRadius: radius.md, backgroundColor: colors.v6SurfaceSoft },
  sourceNoteText: { color: '#59677A', fontSize: 11 },
  empty: { textAlign: 'center', color: colors.v6Muted, marginTop: spacing.lg, fontSize: 13 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: spacing.xl, marginBottom: spacing.sm + 2 },
  sectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.v6Amber },
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
  todoIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  todoIconText: { fontWeight: '800', fontSize: 12 },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  todoSub: { fontSize: 10, color: colors.v6Muted, marginTop: 3 },
  todoAmount: { fontSize: 13, fontWeight: '850' as any, color: colors.v6Text, marginRight: spacing.sm },
  primaryButton: { borderRadius: radius.md, paddingHorizontal: spacing.sm + 3, paddingVertical: spacing.sm },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  softButton: { borderRadius: radius.md, paddingHorizontal: spacing.sm + 3, paddingVertical: spacing.sm },
  softButtonText: { fontWeight: '800', fontSize: 12 },
});
