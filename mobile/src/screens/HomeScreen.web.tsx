import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
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

/**
 * Refonte maquette V6B §3 — équivalent Web de HomeScreen.tsx (mêmes deux
 * blocs, même métier, mêmes appels réseau : GET /accounts, GET /deadlines,
 * GET /provisions + sufficiency) : Comptes d'abord (banque/propriétaire,
 * solde réel, enveloppes affectées jamais additives au solde, "alimenté
 * depuis…" pour un compte dédié), puis "À faire". JAMAIS de dashboard
 * financier consolidé ici (plus de bande "Situation pilotée", plus de KPI,
 * plus de grilles Budgets/Plans financiers) — ces écrans restent accessibles
 * depuis la sidebar/le menu "Plus", pas dupliqués sur l'Accueil.
 * getDashboardSummary() reste appelé UNIQUEMENT pour les signaux d'état
 * (foyer vide / partiellement configuré, bandeau onboarding) — jamais un
 * de ses champs n'est affiché.
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, accountList, deadlines, provisions, incomeSources, household] = await Promise.all([
        api.getDashboardSummary(),
        api.listAccounts(),
        api.listOpenDeadlines(),
        api.listProvisions(),
        api.listIncomeSources(),
        api.getMyHousehold(),
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
            <Text style={styles.sectionTitle}>Mes comptes</Text>
            <TouchableOpacity onPress={() => navigation.getParent()?.navigate('Accounts')}>
              <Text style={styles.sectionLink}>Gérer</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.accountsGrid}>
            {homeAccounts.map((a, i) => {
              const masked = !a.includeInOperationalTreasury && !revealedAccountIds[a.id];
              const total = a.soldeCourant || 1;
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
                  <View style={styles.accountCardTopRow}>
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
          <Text style={styles.sectionTitle}>À faire</Text>
        </View>
        {todos.length === 0 ? (
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
                <Text style={styles.todoAmount}>{item.amount.toLocaleString('fr-FR')} DH</Text>
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
                    onPress={() => navigation.getParent()?.navigate('EnvelopeDetail', { kind: 'provision', id: item.provisionId })}
                  >
                    <Text style={styles.softButtonText}>Verser</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
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

  welcomeCard: { backgroundColor: webColors.primary, borderRadius: webRadius.xl, padding: webSpacing.xxl, alignItems: 'center', maxWidth: 480, width: '100%' },
  welcomeTitle: { color: webColors.textOnPrimary, fontSize: 20, fontWeight: '700' },
  welcomeText: { color: '#C9D2E0', fontSize: 14, marginTop: 6, textAlign: 'center' },
  welcomeButton: { backgroundColor: webColors.surface, borderRadius: webRadius.pill, paddingHorizontal: webSpacing.xxl, paddingVertical: webSpacing.md, marginTop: webSpacing.lg },
  welcomeButtonText: { color: webColors.textPrimary, fontWeight: '700', fontSize: 14 },

  configBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: webColors.surfaceActive,
    borderRadius: webRadius.pill,
    paddingHorizontal: webSpacing.md,
    paddingVertical: 8,
    marginBottom: webSpacing.md,
    maxWidth: '100%',
  },
  configBannerText: { color: webColors.textSecondary, fontSize: 12, fontWeight: '700' },
  configBannerClose: { paddingLeft: webSpacing.sm, paddingVertical: webSpacing.xs },

  sec: { marginBottom: webSpacing.xl },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  sectionLink: { fontSize: 12, fontWeight: '600', color: webColors.success },
  empty: { fontSize: 13, color: webColors.textSecondary },

  // Grille responsive des cartes compte : le nombre de colonnes vient de
  // useResponsiveLayout() (source unique, partagée avec le reste de l'app —
  // jamais un seuil dupliqué ici). Technique padding+marge négative (au lieu
  // d'un `gap` CSS combiné à des largeurs en %, qui déborderait) : la cellule
  // porte la largeur en % de colonne, la carte à l'intérieur reste à 100% de
  // sa cellule — jamais une largeur fixe en pixels qui laisserait un vide.
  accountsGrid: { flexDirection: 'row', flexWrap: 'wrap', width: '100%', marginHorizontal: -(webSpacing.sm / 2) },
  accountCardCell: { paddingHorizontal: webSpacing.sm / 2, marginBottom: webSpacing.md },
  accountCard: {
    width: '100%',
    backgroundColor: webColors.surface,
    borderWidth: 1,
    borderColor: webColors.border,
    borderRadius: webRadius.lg,
    padding: webSpacing.md,
    ...webElevation.card,
  },
  accountCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
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
  accountCardBadgeAccent: { color: webColors.primary, backgroundColor: 'rgba(23,36,54,0.08)' },
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
  todoIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: webColors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  todoIconText: { color: webColors.textPrimary, fontWeight: '800', fontSize: 11 },
  todoMain: { flex: 1, minWidth: 0 },
  todoTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  todoSub: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  todoAmount: { fontSize: 13, fontWeight: '800', color: webColors.textPrimary, marginRight: webSpacing.sm },
  primaryButton: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  primaryButtonText: { color: webColors.textOnPrimary, fontWeight: '800', fontSize: 12 },
  softButton: { backgroundColor: webColors.surfaceActive, borderRadius: webRadius.md, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  softButtonText: { color: webColors.primary, fontWeight: '800', fontSize: 12 },
});
