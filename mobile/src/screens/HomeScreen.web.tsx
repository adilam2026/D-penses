import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { accountCardPalette } from '../ui/theme';
import { webColors, webElevation, webRadius, webSpacing } from '../web/webTheme';
import { toNum } from './envelopes/envelopesLogic';
import { DashboardSummary, essentialPrerequisitesMet, formatShortDate, isFullyEmpty, isPartiallyConfigured } from './homeLogic';

const MAX_WIDTH = 1360;

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

function todoUrgency(item: TodoItem): { solid: string; soft: string } {
  if (item.kind === 'envelope') return { solid: webColors.teal, soft: webColors.tealSoft };
  const days = (new Date(item.dueDate).getTime() - Date.now()) / 86400000;
  if (days < 3) return { solid: webColors.red, soft: webColors.redSoft };
  if (days < 7) return { solid: webColors.amber, soft: webColors.amberSoft };
  return { solid: webColors.blue, soft: webColors.blueSoft };
}

/**
 * Reset design (§2/§3) Web — composition PROPRE au desktop, pas un simple
 * agrandissement du mobile ni l'ancienne grille de cartes carrées : 2
 * colonnes réelles ("Où est mon argent" large à gauche, "Que dois-je faire"
 * en colonne fine à droite, visibles simultanément sans scroller), jamais
 * une "petite carte en haut à gauche d'une grande page vide". Même moteur/
 * mêmes appels que la version mobile.
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [incomeSourcesCount, setIncomeSourcesCount] = useState(0);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dismissChoiceOpen, setDismissChoiceOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revealedAccountIds, setRevealedAccountIds] = useState<Record<string, boolean>>({});

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const [s, accountList, deadlines, provisions, incomeSources, household] = await Promise.all([
        cached('dashboardSummary', () => api.getDashboardSummary(), undefined, force),
        cached('accounts', () => api.listAccounts(), undefined, force),
        cached('openDeadlines', () => api.listOpenDeadlines(), undefined, force),
        cached('provisions', () => api.listProvisions(), undefined, force),
        cached('incomeSources', () => api.listIncomeSources(), undefined, force),
        cached('myHousehold', () => api.getMyHousehold(), undefined, force),
      ]);
      setSummary(s);
      setAccounts(accountList);
      setIncomeSourcesCount(incomeSources.length);
      setBannerDismissed(!!household?.settings?.homeBannerDismissed);

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
          accountName: d.chargePlan?.defaultAccountId ? (accountNameById[d.chargePlan.defaultAccountId] ?? null) : null,
        }));

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

  async function onDismissBanner(permanent: boolean) {
    setDismissChoiceOpen(false);
    if (!permanent) return;
    setBannerDismissed(true);
    await api.updateHouseholdSettings({ homeBannerDismissed: true });
  }

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading && !summary) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!summary) return null;

  const fullyEmpty = isFullyEmpty(summary, accounts);
  const partiallyConfigured = isPartiallyConfigured(summary, accounts);
  const showConfigBanner = partiallyConfigured && !essentialPrerequisitesMet(accounts, incomeSourcesCount) && !bannerDismissed;
  const homeAccounts = accounts.filter((a) => a.showOnHome !== false);

  if (fullyEmpty) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.scrollEmpty}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeTitle}>Bienvenue dans D-Penses+</Text>
          <Text style={styles.welcomeText}>Commençons par configurer vos finances.</Text>
          <TouchableOpacity style={styles.welcomeButton} onPress={() => navigation.getParent()?.navigate('Onboarding')}>
            <Text style={styles.welcomeButtonText}>Commencer</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <View style={styles.topBar}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>D+</Text>
          </View>
          <Text style={styles.brandGreeting}>Bonjour</Text>
        </View>
        <TouchableOpacity testID="home-add-button" style={styles.addButton} onPress={() => navigation.getParent()?.navigate('QuickAdd', { mode: 'depense' })}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addButtonText}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      {showConfigBanner && (
        <View style={styles.configBanner}>
          <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Onboarding')} testID="config-banner">
            <Text style={styles.configBannerText}>Terminer ma configuration →</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="config-banner-close" style={styles.configBannerClose} onPress={() => setDismissChoiceOpen(true)}>
            <Ionicons name="close" size={16} color={webColors.textSecondary} />
          </TouchableOpacity>
        </View>
      )}
      <ChoiceSheet
        visible={dismissChoiceOpen}
        title="Masquer ce rappel ?"
        testID="dismiss-banner-choice"
        onClose={() => setDismissChoiceOpen(false)}
        options={[
          { key: 'later', label: 'Pas maintenant', onPress: () => onDismissBanner(false) },
          { key: 'forever', label: 'Ne plus afficher', onPress: () => onDismissBanner(true) },
        ]}
      />

      <View style={styles.columns}>
        <View style={styles.colMain}>
          <Text style={styles.eyebrow}>Où est mon argent</Text>
          <View style={styles.accountStack}>
            {homeAccounts.map((a, i) => {
              const masked = !a.includeInOperationalTreasury && !revealedAccountIds[a.id];
              const total = a.soldeCourant || 1;
              const accent = accountCardPalette[i % accountCardPalette.length];
              const initial = (a.bankName || a.name || '?').trim().charAt(0).toUpperCase();
              return (
                <TouchableOpacity
                  key={a.id}
                  testID={`home-account-card-${a.id}`}
                  style={styles.accountRow}
                  onPress={() => navigation.getParent()?.navigate('AccountDetail', { id: a.id })}
                >
                  <View style={styles.accountRowTop}>
                    <View style={[styles.accountAvatar, { backgroundColor: accent }]}>
                      <Text style={styles.accountAvatarText}>{initial}</Text>
                    </View>
                    <View style={styles.accountIdentity}>
                      <Text style={styles.accountCaption} numberOfLines={1}>
                        {(a.bankName ?? '').toUpperCase()}
                        {a.bankName && a.ownerLabel ? ' · ' : ''}
                        {a.ownerLabel ?? ''}
                      </Text>
                      <Text style={styles.accountName} numberOfLines={1}>
                        {a.name}
                      </Text>
                    </View>
                    {!a.includeInOperationalTreasury && (
                      <TouchableOpacity
                        testID={`account-reveal-${a.id}`}
                        onPress={() => setRevealedAccountIds((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                      >
                        <Ionicons name={masked ? 'eye-outline' : 'eye-off-outline'} size={15} color={webColors.textSecondary} />
                      </TouchableOpacity>
                    )}
                    <Text style={styles.accountBalance}>{masked ? '•••••• DH' : `${a.soldeCourant.toLocaleString('fr-FR')} DH`}</Text>
                  </View>

                  {a.envelopes.length > 0 && (
                    <>
                      <View style={styles.repartitionTrack}>
                        {a.envelopes.map((e, ei) => (
                          <View
                            key={e.id}
                            style={[
                              styles.repartitionSeg,
                              { width: `${Math.max(0, Math.min(100, (e.amount / total) * 100))}%`, backgroundColor: accountCardPalette[ei % accountCardPalette.length] },
                            ]}
                          />
                        ))}
                      </View>
                      <View style={styles.chipRow}>
                        {a.envelopes.map((e, ei) => (
                          <View key={e.id} style={styles.chip}>
                            <View style={[styles.chipDot, { backgroundColor: accountCardPalette[ei % accountCardPalette.length] }]} />
                            <Text style={styles.chipText} numberOfLines={1}>
                              {e.name} · {e.amount.toLocaleString('fr-FR')} DH
                            </Text>
                          </View>
                        ))}
                      </View>
                    </>
                  )}

                  {a.isDedicated && (
                    <Text style={styles.dedicatedNote} numberOfLines={2}>
                      {a.dedicatedFeed
                        ? `Alimenté depuis ${a.dedicatedFeed.fromAccountName} · ${a.dedicatedFeed.amount.toLocaleString('fr-FR')} DH/mois`
                        : "Compte dédié — pas d'alimentation récurrente configurée."}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            })}
            {homeAccounts.length === 0 && <Text style={styles.empty}>Aucun compte pour l'instant.</Text>}
          </View>
        </View>

        <View style={styles.colSide}>
          <Text style={styles.eyebrow}>Que dois-je faire</Text>
          {todos.length === 0 ? (
            <Text style={styles.empty}>Rien à faire pour le moment.</Text>
          ) : (
            <View style={styles.todoStack}>
              {todos.map((item) => {
                const urgency = todoUrgency(item);
                return (
                  <View key={item.kind === 'charge' ? item.deadlineId : item.provisionId} style={styles.todoRow}>
                    <View style={[styles.todoIcon, { backgroundColor: urgency.soft }]}>
                      <Ionicons name={item.kind === 'charge' ? 'card-outline' : 'wallet-outline'} size={15} color={urgency.solid} />
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
                      <Text style={styles.todoAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>
                    </View>
                    <TouchableOpacity
                      testID={item.kind === 'charge' ? `home-todo-pay-${item.deadlineId}` : `home-todo-verser-${item.provisionId}`}
                      style={[styles.todoAction, { backgroundColor: urgency.solid }]}
                      onPress={() =>
                        item.kind === 'charge'
                          ? navigation.getParent()?.navigate('DeadlineDetail', { id: item.deadlineId })
                          : navigation.getParent()?.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })
                      }
                    >
                      <Ionicons name="arrow-forward" size={13} color="#fff" />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_WIDTH, width: '100%', alignSelf: 'center' },
  scrollEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: webSpacing.xxl },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: webSpacing.lg },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 30, height: 30, borderRadius: 9, backgroundColor: webColors.navy, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#fff', fontWeight: '800', fontSize: 11 },
  brandGreeting: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: webColors.navy, borderRadius: webRadius.pill, paddingHorizontal: 16, paddingVertical: 10 },
  addButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },

  welcomeCard: { backgroundColor: webColors.navy, borderRadius: webRadius.xl, padding: webSpacing.xxl, alignItems: 'center', maxWidth: 480, width: '100%' },
  welcomeTitle: { color: webColors.textOnPrimary, fontSize: 20, fontWeight: '700' },
  welcomeText: { color: '#C9D2E0', fontSize: 14, marginTop: 6, textAlign: 'center' },
  welcomeButton: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.xxl, paddingVertical: webSpacing.md, marginTop: webSpacing.lg },
  welcomeButtonText: { color: webColors.textPrimary, fontWeight: '700', fontSize: 14 },

  configBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: webColors.amberSoft,
    borderRadius: webRadius.pill,
    paddingHorizontal: webSpacing.md,
    paddingVertical: 8,
    marginBottom: webSpacing.md,
  },
  configBannerText: { color: webColors.amber, fontSize: 12, fontWeight: '700' },
  configBannerClose: { paddingLeft: webSpacing.sm, paddingVertical: webSpacing.xs },

  // Composition à 2 colonnes RÉELLES (pas un empilement recadré) — colonne
  // principale large (comptes) + colonne latérale fine (actions), visibles
  // simultanément dès 900px sans scroller l'une pour voir l'autre.
  columns: { flexDirection: 'row', gap: webSpacing.xl, alignItems: 'flex-start' },
  colMain: { flex: 2, minWidth: 0 },
  colSide: { flex: 1, minWidth: 280 },

  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1, color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: webSpacing.sm + 2 },
  empty: { fontSize: 13, color: webColors.textSecondary },

  accountStack: { gap: webSpacing.sm + 2 },
  accountRow: { backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.lg, padding: webSpacing.md, ...webElevation.card },
  accountRowTop: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm + 2 },
  accountAvatar: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  accountAvatarText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  accountIdentity: { flex: 1, minWidth: 0 },
  accountCaption: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary },
  accountName: { fontSize: 13, fontWeight: '800', color: webColors.textPrimary, marginTop: 1 },
  accountBalance: { fontSize: 19, fontWeight: '900', color: webColors.textPrimary },

  repartitionTrack: { flexDirection: 'row', height: 6, borderRadius: 999, backgroundColor: webColors.surfaceMuted, overflow: 'hidden', marginTop: webSpacing.sm, gap: 1 },
  repartitionSeg: { height: '100%' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: webSpacing.sm - 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: webColors.surfaceMuted, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  chipDot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { fontSize: 11, fontWeight: '700', color: webColors.textPrimary },
  dedicatedNote: { fontSize: 10, color: webColors.textSecondary, marginTop: webSpacing.sm },

  todoStack: { gap: 8 },
  todoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: webSpacing.sm, backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.md, padding: webSpacing.sm + 2 },
  todoIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary },
  todoSub: { fontSize: 10, color: webColors.textSecondary, marginTop: 2 },
  todoAmount: { fontSize: 13, fontWeight: '800', color: webColors.textPrimary, marginTop: 4 },
  todoAction: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
