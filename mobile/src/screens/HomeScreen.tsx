import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { useBottomInset } from '../ui/useBottomInset';
import { useTopInset } from '../ui/useTopInset';
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
 * Reset design (§2/§3) — ceci N'EST PAS l'ancien HomeScreen recoloré : besoin
 * utilisateur -> nouvelle composition. Deux questions racontées littéralement
 * par les libellés de section ("Où est mon argent" / "Que dois-je faire"),
 * un compte = une RANGÉE pleine largeur (pastille initiale + solde en grand +
 * répartition en pilule segmentée + puces d'enveloppes), jamais une grille de
 * cartes carrées avec 4 cases de métriques. "À faire" = liste de rangées
 * fines avec icône ronde colorée par urgence et bouton flèche circulaire,
 * jamais un bouton texte rectangulaire "Payer"/"Verser" dans une grande carte
 * unique. Logique/hooks/appels réseau inchangés (mêmes 3 endpoints + cache +
 * Promise.all déjà en place).
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const top = useTopInset();
  const bottom = useBottomInset();
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

      // Perf — parallélisé (Promise.all), plus de boucle for séquentielle.
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

  const homeAccounts = accounts.filter((a) => a.showOnHome !== false);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingTop: top, paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={colors.v6Navy} />}
    >
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>D+</Text>
          </View>
          <Text style={styles.brandGreeting}>Bonjour</Text>
        </View>
        <TouchableOpacity
          testID="home-add-button"
          style={styles.addButton}
          onPress={() => navigation.getParent()?.navigate('QuickAdd', { mode: 'depense' })}
        >
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.eyebrow}>Où est mon argent</Text>

        <View style={styles.accountStack}>
          {homeAccounts.map((account, index) => (
            <AccountRow
              key={account.id}
              account={account}
              accent={accountCardPalette[index % accountCardPalette.length]}
              onPress={() => navigation.navigate('AccountDetail', { id: account.id })}
            />
          ))}
        </View>

        {!loading && homeAccounts.length === 0 && <Text style={styles.empty}>Aucun compte pour l'instant.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.eyebrow}>Que dois-je faire</Text>

        {todos.length === 0 && !loading ? (
          <Text style={styles.empty}>Rien à faire pour le moment.</Text>
        ) : (
          <View style={styles.todoStack}>
            {todos.map((item) => {
              const urgency = todoUrgency(item);
              return (
                <View key={item.kind === 'charge' ? item.deadlineId : item.provisionId} style={styles.todoRow}>
                  <View style={[styles.todoIcon, { backgroundColor: urgency.soft }]}>
                    <Ionicons name={item.kind === 'charge' ? 'card-outline' : 'wallet-outline'} size={17} color={urgency.solid} />
                  </View>
                  <View style={styles.todoMain}>
                    <Text style={styles.todoTitle} numberOfLines={1}>
                      {item.label}
                    </Text>
                    {item.kind === 'charge' ? (
                      <Text style={styles.todoSub}>
                        {formatShortDate(item.dueDate)}
                        {item.accountName ? ` · ${item.accountName}` : ''}
                      </Text>
                    ) : (
                      <Text style={styles.todoSub}>À compléter ce mois-ci</Text>
                    )}
                  </View>
                  <Text style={styles.todoAmount}>{formatDh(item.amount)}</Text>
                  <TouchableOpacity
                    testID={item.kind === 'charge' ? `home-todo-pay-${item.deadlineId}` : `home-todo-verser-${item.provisionId}`}
                    style={[styles.todoAction, { backgroundColor: urgency.solid }]}
                    onPress={() =>
                      item.kind === 'charge'
                        ? navigation.getParent()?.navigate('DeadlineDetail', { id: item.deadlineId })
                        : navigation.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })
                    }
                  >
                    <Ionicons name="arrow-forward" size={15} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function todoUrgency(item: TodoItem): { solid: string; soft: string } {
  if (item.kind === 'envelope') return { solid: colors.v6Teal, soft: colors.v6TealSoft };
  const days = (new Date(item.dueDate).getTime() - Date.now()) / 86400000;
  if (days < 3) return { solid: colors.v6Red, soft: colors.v6RedSoft };
  if (days < 7) return { solid: colors.v6Amber, soft: colors.v6AmberSoft };
  return { solid: colors.v6Blue, soft: colors.v6BlueSoft };
}

function AccountRow({ account, accent, onPress }: { account: api.AccountApi; accent: string; onPress: () => void }) {
  const total = account.soldeCourant || 1;
  const initial = (account.bankName || account.name || '?').trim().charAt(0).toUpperCase();
  const badge = account.isDedicated
    ? 'Dédié'
    : account.type === 'courant'
      ? 'Courant'
      : account.type === 'epargne'
        ? 'Épargne'
        : 'Compte';

  return (
    <TouchableOpacity testID={`home-account-card-${account.id}`} style={styles.accountRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.accountRowTop}>
        <View style={[styles.accountAvatar, { backgroundColor: accent }]}>
          <Text style={styles.accountAvatarText}>{initial}</Text>
        </View>
        <View style={styles.accountIdentity}>
          <Text style={styles.accountCaption} numberOfLines={1}>
            {(account.bankName ?? '').toUpperCase()}
            {account.bankName && account.ownerLabel ? ' · ' : ''}
            {account.ownerLabel ?? ''}
            {!account.bankName && !account.ownerLabel ? badge : ''}
          </Text>
          <Text style={styles.accountName} numberOfLines={1}>
            {account.name}
          </Text>
        </View>
        <Text style={styles.accountBalance}>{formatDh(account.soldeCourant)}</Text>
      </View>

      {account.envelopes.length > 0 && (
        <>
          <View style={styles.repartitionTrack}>
            {account.envelopes.map((e, i) => (
              <View
                key={e.id}
                style={[
                  styles.repartitionSeg,
                  {
                    width: `${Math.max(0, Math.min(100, (e.amount / total) * 100))}%`,
                    backgroundColor: [colors.v6Blue, colors.v6Teal, colors.v6Purple, colors.v6Gold][i % 4],
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.chipRow}>
            {account.envelopes.map((e, i) => (
              <View key={e.id} style={styles.chip}>
                <View style={[styles.chipDot, { backgroundColor: [colors.v6Blue, colors.v6Teal, colors.v6Purple, colors.v6Gold][i % 4] }]} />
                <Text style={styles.chipText} numberOfLines={1}>
                  {e.name} · {formatDh(e.amount)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {account.isDedicated && (
        <Text style={styles.dedicatedNote} numberOfLines={2}>
          {account.dedicatedFeed
            ? `Alimenté depuis ${account.dedicatedFeed.fromAccountName} · ${formatDh(account.dedicatedFeed.amount)}/mois`
            : "Compte dédié — pas d'alimentation récurrente configurée."}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.v6Bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.v6Navy, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  brandGreeting: { fontSize: 15, fontWeight: '700', color: colors.v6Text },
  addButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.v6Navy, alignItems: 'center', justifyContent: 'center', ...elevation.card },

  section: { paddingHorizontal: spacing.lg, marginTop: spacing.md },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, color: colors.v6Muted, textTransform: 'uppercase', marginBottom: spacing.sm + 2 },
  empty: { fontSize: 13, color: colors.v6Muted, paddingVertical: spacing.sm },

  accountStack: { gap: spacing.sm + 2 },
  accountRow: {
    backgroundColor: colors.v6Surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...elevation.card,
  },
  accountRowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2 },
  accountAvatar: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  accountAvatarText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountCaption: { fontSize: 10, fontWeight: '700', color: colors.v6Muted },
  accountName: { fontSize: 14, fontWeight: '800', color: colors.v6Text, marginTop: 1 },
  accountBalance: { fontSize: 21, fontWeight: '900', letterSpacing: -0.5, color: colors.v6Text },

  repartitionTrack: {
    flexDirection: 'row',
    height: 7,
    borderRadius: 999,
    backgroundColor: colors.v6SurfaceSoft,
    overflow: 'hidden',
    marginTop: spacing.sm + 2,
    gap: 1,
  },
  repartitionSeg: { height: '100%' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.v6SurfaceSoft, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, maxWidth: '100%' },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontWeight: '700', color: colors.v6Text, flexShrink: 1 },
  dedicatedNote: { fontSize: 10, color: colors.v6Muted, marginTop: spacing.sm },

  todoStack: { gap: 8 },
  todoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.v6Surface,
    borderRadius: radius.lg,
    padding: spacing.sm + 4,
    ...elevation.card,
  },
  todoIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: colors.v6Text },
  todoSub: { fontSize: 10, color: colors.v6Muted, marginTop: 2 },
  todoAmount: { fontSize: 13, fontWeight: '850' as any, color: colors.v6Text },
  todoAction: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
