import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FormField } from '../../ui/FormField';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface Account {
  id: string;
  name: string;
  type: string;
  status: 'actif' | 'archive';
  soldeCourant: number;
  isFavorite: boolean;
  includeInOperationalTreasury: boolean;
}

type AccountType = 'courant' | 'especes' | 'epargne' | 'autre';

const TYPE_LABEL: Record<AccountType, string> = {
  courant: 'Banque',
  especes: 'Espèces',
  epargne: 'Épargne',
  autre: 'Autre',
};

/** Comptes (Lot 1, docs/03 §I.11) — écran secondaire, jamais en navigation principale (§23). */
export function AccountsScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('courant');
  const [initialBalance, setInitialBalance] = useState('');
  const [includeInPilotage, setIncludeInPilotage] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // R5 clôture §2 — les comptes archivés restent visibles ici (pour être
      // réactivés depuis leur détail), jamais dans les sélecteurs de nouvelle
      // transaction (ceux-ci continuent d'utiliser listAccounts()).
      setAccounts(await api.listAllAccounts());
    } finally {
      setLoading(false);
    }
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
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={accounts}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>
              Commencez par ajouter votre compte principal pour connaître votre trésorerie.
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            testID={`account-row-${item.id}`}
            style={[styles.row, item.status === 'archive' && styles.rowArchived]}
            onPress={() => navigation.navigate('AccountDetail', { id: item.id })}
          >
            <View>
              <Text style={styles.rowName}>
                {item.isFavorite ? '★ ' : ''}
                {item.name}
              </Text>
              <Text style={styles.rowType}>
                {TYPE_LABEL[item.type as AccountType] ?? item.type}
                {item.status === 'archive' ? ' · Archivé' : ''}
              </Text>
              {/* R6.1 §10 — badge discret, jamais un masquage : un compte hors pilotage
                  reste visible avec son solde, seulement exclu des calculs. */}
              {!item.includeInOperationalTreasury && <Text style={styles.offPilotBadge}>Hors pilotage</Text>}
            </View>
            <Text style={styles.rowBalance}>{item.soldeCourant.toLocaleString('fr-FR')} DH</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: 8 }}
      />

      <View style={[styles.createBox, { paddingBottom: bottomInset }]}>
        <Text style={styles.sectionLabel}>Nouveau compte</Text>
        <View style={styles.typeRow}>
          {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
            <TouchableOpacity key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
              <Text style={[styles.typeChipText, type === t && styles.typeChipTextActive]}>{TYPE_LABEL[t]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FormField placeholder="Nom (ex. Compte principal)" value={name} onChangeText={setName} />
        <View style={styles.createRow}>
          <FormField
            containerStyle={styles.balanceField}
            placeholder="Solde initial (DH, facultatif)"
            keyboardType="decimal-pad"
            value={initialBalance}
            onChangeText={setInitialBalance}
          />
          <TouchableOpacity style={styles.addButton} onPress={onCreate} disabled={creating}>
            {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.addButtonText}>+</Text>}
          </TouchableOpacity>
        </View>
        {/* R6.1 §8 — bascule à la création, Oui par défaut. */}
        <View style={styles.pilotageRow}>
          <View style={{ flex: 1, marginRight: spacing.sm }}>
            <Text style={styles.pilotageLabel}>Inclure ce compte dans ma situation financière</Text>
            <Text style={styles.pilotageHelp}>
              Si désactivé, ce compte reste visible mais n'est pas pris en compte dans les calculs de trésorerie et de projection.
            </Text>
          </View>
          <Switch testID="account-create-pilotage-switch" value={includeInPilotage} onValueChange={setIncludeInPilotage} />
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xxl, fontSize: 13, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowArchived: { opacity: 0.55 },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowType: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  offPilotBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  rowBalance: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  createBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  typeChip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { fontSize: 12, color: colors.textPrimary },
  typeChipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  createRow: { flexDirection: 'row', alignItems: 'center' },
  balanceField: { flex: 1, marginRight: spacing.sm },
  addButton: { backgroundColor: colors.primary, width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: colors.textOnPrimary, fontSize: 20, fontWeight: '700' },
  pilotageRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  pilotageLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  pilotageHelp: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13 },
});
