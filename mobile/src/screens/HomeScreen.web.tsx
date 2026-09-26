import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { accountCardPalette } from '../ui/theme';
import { useResponsiveLayout } from '../ui/useResponsiveLayout';
import { webColors, webElevation, webRadius, webSpacing } from '../web/webTheme';
import { toNum } from './envelopes/envelopesLogic';
import { DashboardSummary, essentialPrerequisitesMet, formatShortDate, isFullyEmpty, isPartiallyConfigured } from './homeLogic';

// Largeur maximale du contenu de l'Accueil (au-delà, marge neutre des deux
// côtés) — en dessous de ce plafond, le contenu occupe TOUJOURS toute la
// largeur disponible (jamais de zone vide à droite en dessous de 1360px).
const HOME_MAX_WIDTH = 1360;

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
 * Équivalent Web de HomeScreen.tsx (mêmes deux blocs, même métier, mêmes
 * appels réseau) — reset visuel : la palette v6 (teal/ambre/rouge/bleu, déjà
 * disponible côté mobile) est désormais utilisée ici aussi (badges pleins,
 * accents de carte, urgence "À faire" colorée), sur un fond légèrement plus
 * soutenu. `cached()` évite de refetcher à chaque focus ; le calcul "à
 * verser" par provision est parallélisé (Promise.all) au lieu d'un
 * aller-retour séquentiel par provision (ancien bug de perf identique à la
 * version mobile).
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const { columns } = useResponsiveLayout();

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

      // Perf — parallélisé (auparavant : une requête réseau par provision,
      // séquentielle, exactement le même bug que la version mobile).
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

      {/* Comptes — où est l'argent et à quoi il est affecté (jamais un total consolidé ici). */}
      {homeAccounts.length > 0 && (
        <View style={styles.sec}>
          <View style={styles.sectionHead}>
            <View style={styles.sectionHeadLeft}>
              <View style={[styles.sectionDot, { backgroundColor: webColors.blue }]} />
              <Text style={styles.sectionTitle}>Mes comptes</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Accounts')}>
              <Text style={styles.sectionLink}>Gérer</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.accountsGrid}>
            {homeAccounts.map((a, i) => {
              const masked = !a.includeInOperationalTreasury && !revealedAccountIds[a.id];
              const total = a.soldeCourant || 1;
              const accent = accountCardPalette[i % accountCardPalette.length];
              const initial = (a.bankName || a.name || '?').trim().charAt(0).toUpperCase();
              const badge = a.isDedicated
                ? 'Dédié'
                : a.envelopes.length > 0
                  ? `${a.envelopes.length} enveloppe${a.envelopes.length > 1 ? 's' : ''}`
                  : a.type === 'courant'
                    ? 'Courant'
                    : a.type === 'epargne'
                      ? 'Épargne'
                      : 'Compte';
              return (
                <View key={a.id} style={[styles.accountCardCell, { flexBasis: `${100 / columns}%`, maxWidth: `${100 / columns}%` }]}>
                  <TouchableOpacity
                    testID={`home-account-card-${a.id}`}
                    style={styles.accountCard}
                    onPress={() => navigation.getParent()?.navigate('AccountDetail', { id: a.id })}
                  >
                    <View style={[styles.accountCardAccent, { backgroundColor: accent }]} />
                    <View style={styles.accountCardTopRow}>
                      <View style={styles.accountCardTopLeft}>
                        <View style={[styles.accountCardInitial, { backgroundColor: accent }]}>
                          <Text style={styles.accountCardInitialText}>{initial}</Text>
                        </View>
                        <View style={{ flexShrink: 1 }}>
                          {(a.bankName || a.ownerLabel) && (
                            <Text style={styles.accountCardOwner} numberOfLines={1}>
                              {(a.bankName ?? '').toUpperCase()}
                              {a.bankName && a.ownerLabel ? ' • ' : ''}
                              {a.ownerLabel ?? ''}
                            </Text>
                          )}
                          <Text style={styles.accountCardName} numberOfLines={1}>
                            {a.name}
                          </Text>
                        </View>
                      </View>
                      <View style={styles.accountCardTopRight}>
                        {!a.includeInOperationalTreasury && (
                          <TouchableOpacity
                            testID={`account-reveal-${a.id}`}
                            onPress={() => setRevealedAccountIds((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                          >
                            <Ionicons name={masked ? 'eye-outline' : 'eye-off-outline'} size={15} color={webColors.textSecondary} />
                          </TouchableOpacity>
                        )}
                        <Text style={[styles.accountCardBadge, a.isDedicated && styles.accountCardBadgeAccent]}>{badge}</Text>
                      </View>
                    </View>

                    <Text style={styles.accountCardAmount}>{masked ? '•••••• DH' : `${a.soldeCourant.toLocaleString('fr-FR')} DH`}</Text>

                    {a.envelopes.length > 1 && (
                      <View style={styles.accountCardTrack}>
                        {a.envelopes.map((e, ei) => (
                          <View
                            key={e.id}
                            style={{ width: `${Math.max(0, Math.min(100, (e.amount / total) * 100))}%`, height: '100%', backgroundColor: accountCardPalette[ei % accountCardPalette.length] }}
                          />
                        ))}
                      </View>
                    )}

                    {a.envelopes.length > 0 && (
                      <View style={styles.accountCardEnvelopes}>
                        {a.envelopes.map((e, ei) => (
                          <View key={e.id} style={styles.accountCardEnvelopeRow}>
                            <View style={styles.accountCardEnvelopeLeft}>
                              <View style={[styles.accountCardSwatch, { backgroundColor: accountCardPalette[ei % accountCardPalette.length] }]} />
                              <Text style={styles.accountCardEnvelopeName} numberOfLines={1}>
                                {e.name}
                              </Text>
                            </View>
                            <Text style={styles.accountCardEnvelopeAmount}>{e.amount.toLocaleString('fr-FR')} DH</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    {a.isDedicated && (
                      <Text style={styles.accountCardNote} numberOfLines={2}>
                        {a.dedicatedFeed
                          ? `Alimenté depuis ${a.dedicatedFeed.fromAccountName} • ${a.dedicatedFeed.amount.toLocaleString('fr-FR')} DH / mois`
                          : "Compte dédié — aucun virement récurrent configuré."}
                      </Text>
                    )}
                    {!a.isDedicated && a.envelopes.length === 0 && <Text style={styles.accountCardNote}>Aucune enveloppe associée.</Text>}
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        </View>
      )}
      {homeAccounts.length === 0 && <Text style={styles.empty}>Aucun compte pour l'instant.</Text>}

      {/* À faire — prochaines actions (charges proches à payer, enveloppes à compléter ce mois). */}
      <View style={styles.sec}>
        <View style={styles.sectionHead}>
          <View style={styles.sectionHeadLeft}>
            <View style={[styles.sectionDot, { backgroundColor: webColors.amber }]} />
            <Text style={styles.sectionTitle}>À faire</Text>
          </View>
        </View>
        {todos.length === 0 ? (
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
                  <Text style={styles.todoAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>
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
                      onPress={() => navigation.getParent()?.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })}
                    >
                      <Text style={[styles.softButtonText, { color: urgency.solid }]}>Verser</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: HOME_MAX_WIDTH, width: '100%', alignSelf: 'center' },
  scrollEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: webSpacing.xxl },

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
    maxWidth: '100%',
  },
  configBannerText: { color: webColors.amber, fontSize: 12, fontWeight: '700' },
  configBannerClose: { paddingLeft: webSpacing.sm, paddingVertical: webSpacing.xs },

  sec: { marginBottom: webSpacing.xl },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm },
  sectionHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  sectionLink: { fontSize: 12, fontWeight: '600', color: webColors.success },
  empty: { fontSize: 13, color: webColors.textSecondary },

  // Grille responsive des cartes compte : le nombre de colonnes vient de
  // useResponsiveLayout() (source unique, partagée avec le reste de l'app —
  // jamais un seuil dupliqué ici).
  accountsGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', marginHorizontal: -(webSpacing.sm / 2) },
  accountCardCell: { paddingHorizontal: webSpacing.sm / 2, marginBottom: webSpacing.md },
  accountCard: {
    width: '100%',
    backgroundColor: webColors.surface,
    borderWidth: 1,
    borderColor: webColors.border,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    paddingTop: webSpacing.md + 3,
    overflow: 'hidden',
    ...webElevation.card,
  },
  accountCardAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  accountCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  accountCardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm, flexShrink: 1 },
  accountCardInitial: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  accountCardInitialText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  accountCardTopRight: { alignItems: 'flex-end', gap: 6 },
  accountCardOwner: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary },
  accountCardName: { fontSize: 13, color: webColors.textPrimary, fontWeight: '800', marginTop: 2 },
  accountCardBadge: {
    fontSize: 9,
    fontWeight: '800',
    color: webColors.textSecondary,
    backgroundColor: webColors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  accountCardBadgeAccent: { color: webColors.navy, backgroundColor: 'rgba(23,36,54,0.08)' },
  accountCardAmount: { fontSize: 22, fontWeight: '900', color: webColors.textPrimary, marginTop: webSpacing.sm },
  accountCardTrack: { marginTop: webSpacing.sm, height: 5, borderRadius: 999, backgroundColor: webColors.surfaceMuted, overflow: 'hidden', flexDirection: 'row' },
  accountCardEnvelopes: { marginTop: webSpacing.sm, paddingTop: webSpacing.sm, borderTopWidth: 1, borderTopColor: webColors.border },
  accountCardEnvelopeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  accountCardEnvelopeLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginRight: webSpacing.xs, gap: 7 },
  accountCardSwatch: { width: 7, height: 7, borderRadius: 4 },
  accountCardEnvelopeName: { fontSize: 11, color: webColors.textPrimary, fontWeight: '600', flexShrink: 1 },
  accountCardEnvelopeAmount: { fontSize: 11, color: webColors.textPrimary, fontWeight: '700' },
  accountCardNote: { fontSize: 10, color: webColors.textSecondary, marginTop: webSpacing.sm },

  todoCard: { width: '100%', backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.borderStrong, paddingHorizontal: webSpacing.md },
  todoRow: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.md, paddingVertical: 13 },
  todoRowBorder: { borderTopWidth: 1, borderTopColor: webColors.border },
  todoIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  todoIconText: { fontWeight: '800', fontSize: 11 },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  todoSub: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  todoAmount: { fontSize: 13, fontWeight: '800', color: webColors.textPrimary, marginRight: webSpacing.sm },
  primaryButton: { borderRadius: webRadius.md, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  primaryButtonText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  softButton: { borderRadius: webRadius.md, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  softButtonText: { fontWeight: '800', fontSize: 12 },
});
