import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { FormField } from '../../ui/FormField';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { KIND_LABEL, LedgerEntry, formatDate } from '../transactions/transactionsLogic';
import { AccountType, TYPE_LABEL } from './accountsLogic';

interface Account {
  id: string;
  name: string;
  type: string;
  status: 'actif' | 'archive';
  soldeCourant: number;
  isFavorite: boolean;
  includeInOperationalTreasury: boolean;
}

const ACTIVITY_LIMIT = 5;

/**
 * Portail Web v4 §1/§2/§4 (WEB-V4.2 révisé) — Comptes desktop : blocs riches
 * (solde + 5 dernières opérations par compte, GET /transactions?accountId=...
 * &limit=5, déjà disponible) en colonne principale, panneau "Ajouter un
 * compte" FIXE (sticky) en colonne d'action — mêmes champs/endpoint que le
 * formulaire mobile (api.createAccount), jamais un tiroir qui se referme.
 *
 * Garde-fou §1 — chargement en 2 temps : la liste des comptes d'abord, puis
 * l'activité récente ensuite (en parallèle, Promise.allSettled) ; un échec
 * sur l'historique d'un compte n'affecte que ce compte (le compte reste
 * affiché, simplement sans historique).
 *
 * "Voir toutes les transactions du compte" volontairement absent ce lot : le
 * passage d'un filtre accountId par navigation vers TransactionsScreen.web
 * n'existe pas encore (TransactionsScreen.web ne lit aucun route.params) —
 * ne pas inventer ce comportement, traité dans un mini-lot dédié.
 */
export function AccountsScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<Record<string, LedgerEntry[]>>({});
  const [activityLoading, setActivityLoading] = useState(false);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('courant');
  const [initialBalance, setInitialBalance] = useState('');
  const [includeInPilotage, setIncludeInPilotage] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let list: Account[] = [];
    try {
      list = await api.listAllAccounts();
      setAccounts(list);
    } finally {
      setLoading(false);
    }

    setActivityLoading(true);
    const results = await Promise.allSettled(list.map((a) => api.listTransactions({ accountId: a.id, limit: ACTIVITY_LIMIT })));
    const next: Record<string, LedgerEntry[]> = {};
    results.forEach((r, i) => {
      next[list[i].id] = r.status === 'fulfilled' ? r.value : [];
    });
    setActivity(next);
    setActivityLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreate() {
    setError(null);
    if (!name.trim()) return;
    setCreating(true);
    try {
      const balance = initialBalance.trim() ? Number(initialBalance.replace(',', '.')) : 0;
      await api.createAccount({ name: name.trim(), type, initialBalance: balance, includeInOperationalTreasury: includeInPilotage });
      setName('');
      setInitialBalance('');
      setIncludeInPilotage(true);
      setType('courant');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  // Synthèse compacte — dérivée directement des comptes déjà chargés (simple
  // somme, jamais un second moteur de calcul de trésorerie), recalculée
  // automatiquement à chaque `load()`.
  const pilotedTotal = accounts.filter((a) => a.includeInOperationalTreasury).reduce((sum, a) => sum + a.soldeCourant, 0);
  const nonPilotedTotal = accounts.filter((a) => !a.includeInOperationalTreasury).reduce((sum, a) => sum + a.soldeCourant, 0);

  const mainContent =
    loading && accounts.length === 0 ? (
      <ActivityIndicator style={{ marginTop: 24 }} />
    ) : accounts.length === 0 ? (
      <Text style={styles.empty}>Commencez par ajouter votre compte principal pour connaître votre trésorerie.</Text>
    ) : (
      <View style={styles.blockList}>
        {accounts.map((a) => {
          const entries = activity[a.id];
          return (
            <View key={a.id} style={[styles.block, a.status === 'archive' && styles.blockArchived]}>
              <TouchableOpacity testID={`web-account-card-${a.id}`} style={styles.blockHeader} onPress={() => navigation.navigate('AccountDetail', { id: a.id })}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.blockName} numberOfLines={1}>
                    {a.isFavorite ? '★ ' : ''}
                    {a.name}
                  </Text>
                  <View style={styles.blockMetaRow}>
                    <Text style={styles.blockType}>
                      {TYPE_LABEL[a.type as AccountType] ?? a.type}
                      {a.status === 'archive' ? ' · Archivé' : ''}
                    </Text>
                    <Text style={styles.pilotageBadge}>{a.includeInOperationalTreasury ? 'Piloté' : 'Hors pilotage'}</Text>
                  </View>
                </View>
                <Text style={styles.blockBalance}>{a.soldeCourant.toLocaleString('fr-FR')} DH</Text>
              </TouchableOpacity>

              <View style={styles.activitySection}>
                <Text style={styles.activityTitle}>Activité récente</Text>
                {entries === undefined && activityLoading ? (
                  <ActivityIndicator style={{ marginTop: 8 }} />
                ) : !entries || entries.length === 0 ? (
                  <Text style={styles.activityEmpty}>Aucune opération récente.</Text>
                ) : (
                  entries.map((item) => {
                    const positive = item.amount >= 0;
                    return (
                      <TouchableOpacity
                        key={`${item.kind}-${item.id}`}
                        style={styles.activityRow}
                        onPress={() => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id })}
                      >
                        <Text style={styles.activityDate}>{formatDate(item.occurredAt)}</Text>
                        <Text style={styles.activityLabel} numberOfLines={1}>
                          {item.label ?? KIND_LABEL[item.displayKind] ?? item.kind}
                        </Text>
                        <Text style={[styles.activityAmount, positive ? styles.amountPositive : styles.amountNegative]}>
                          {positive ? '+' : ''}
                          {item.amount.toLocaleString('fr-FR')} DH
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          );
        })}
      </View>
    );

  const panel = (
    <View style={styles.panelCard}>
      <Text style={styles.panelTitle}>Ajouter un compte</Text>

      <View style={styles.typeRow}>
        {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
          <TouchableOpacity key={t} testID={`web-account-type-${t}`} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
            <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{TYPE_LABEL[t]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FormField testID="web-account-name" label="Nom" placeholder="ex. Compte principal" value={name} onChangeText={setName} />
      <FormField
        testID="web-account-balance"
        label="Solde initial (DH, facultatif)"
        keyboardType="decimal-pad"
        value={initialBalance}
        onChangeText={setInitialBalance}
      />

      <View style={styles.pilotageRow}>
        <View style={{ flex: 1, marginRight: webSpacing.sm }}>
          <Text style={styles.pilotageLabel}>Inclure ce compte dans ma situation financière</Text>
          <Text style={styles.pilotageHelp}>Si désactivé, ce compte reste visible mais n'est pas pris en compte dans les calculs de trésorerie et de projection.</Text>
        </View>
        <Switch testID="web-account-pilotage-switch" value={includeInPilotage} onValueChange={setIncludeInPilotage} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity testID="web-account-create-submit" style={styles.submitButton} onPress={onCreate} disabled={creating}>
        {creating ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.submitButtonText}>Ajouter</Text>}
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title="Comptes"
        subtitle={
          accounts.length > 0
            ? `${accounts.length} compte(s) · ${pilotedTotal.toLocaleString('fr-FR')} DH pilotés · ${nonPilotedTotal.toLocaleString('fr-FR')} DH hors pilotage`
            : undefined
        }
      />
      <TwoColumnLayout main={mainContent} panel={panel} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },
  empty: { color: webColors.textSecondary, fontSize: 13, lineHeight: 20 },

  blockList: { gap: webSpacing.md },
  block: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.borderStrong, overflow: 'hidden' },
  blockArchived: { opacity: 0.55 },
  blockHeader: { flexDirection: 'row', alignItems: 'center', padding: webSpacing.md },
  blockName: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary },
  blockMetaRow: { flexDirection: 'row', alignItems: 'center', gap: webSpacing.sm, marginTop: 4 },
  blockType: { fontSize: 11, color: webColors.textSecondary },
  pilotageBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: webColors.textSecondary,
    backgroundColor: webColors.surfaceMuted,
    borderRadius: webRadius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  blockBalance: { fontSize: 20, fontWeight: '800', color: webColors.textPrimary, marginLeft: webSpacing.md },

  activitySection: { borderTopWidth: 1, borderTopColor: webColors.border, backgroundColor: webColors.surfaceMuted, paddingHorizontal: webSpacing.md, paddingVertical: webSpacing.sm },
  activityTitle: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, textTransform: 'uppercase', marginBottom: 4 },
  activityEmpty: { fontSize: 12, color: webColors.textSecondary, paddingVertical: 4 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5 },
  activityDate: { fontSize: 11, color: webColors.textSecondary, width: 80 },
  activityLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, paddingRight: webSpacing.sm },
  activityAmount: { fontSize: 12, fontWeight: '700', width: 100, textAlign: 'right' },
  amountPositive: { color: webColors.success },
  amountNegative: { color: webColors.danger },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: webSpacing.sm, gap: webSpacing.xs },
  typeChip: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.pill, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: webColors.border },
  typeChipActive: { backgroundColor: webColors.primary, borderColor: webColors.primary },
  typeChipText: { fontSize: 12, color: webColors.textPrimary },
  typeChipTextActive: { color: webColors.textOnPrimary, fontWeight: '600' },
  pilotageRow: { flexDirection: 'row', alignItems: 'center', marginTop: webSpacing.xs, marginBottom: webSpacing.md },
  pilotageLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary },
  pilotageHelp: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  submitButton: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center', marginTop: webSpacing.sm },
  submitButtonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 14 },
  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
});
