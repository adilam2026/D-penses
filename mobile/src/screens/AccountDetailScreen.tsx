import React, { useCallback, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { OPERATION_KIND_LABELS, localAmount } from '../ui/operationKindLabel';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { RenameModal } from '../ui/RenameModal';
import { ColorPickerModal } from '../ui/ColorPickerModal';
import { HelpButton } from '../ui/HelpButton';
import { testIdSlug } from '../ui/testIdSlug';
import { gradientForAccount } from '../ui/accountPalette';

/**
 * Détail compte (Lot ciblé §3) — carte de synthèse en relief (couleur du
 * compte, solde très visible) puis "Historique des transactions" dans sa
 * propre section visuelle. Menu ⋯ : Modifier / Couleur de la carte / Ajouter
 * une transaction / Désactiver.
 */
export function AccountDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ AccountDetail: { id: string } }, 'AccountDetail'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [account, setAccount] = useState<api.AccountApi | null>(null);
  const [operations, setOperations] = useState<api.FinancialOperationApi[] | null>(null);
  const [goals, setGoals] = useState<api.GoalApi[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);

  const load = useCallback(async () => {
    const [acc, ops, goalList] = await Promise.all([api.getAccount(id), api.listFinancialOperations({ accountId: id }), api.listGoals()]);
    setAccount(acc);
    setOperations(ops);
    setGoals(goalList);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!account) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const [gradientFrom, gradientTo] = gradientForAccount(account.colorKey, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backRow} onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
            <Text style={styles.backLabel}>Accueil</Text>
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <HelpButton
              title={account.name}
              text="Le solde correspond au montant réellement présent sur ce compte. L'historique liste toutes les opérations qui l'ont affecté, y compris celles financées depuis un sous-compte."
            />
            <TouchableOpacity testID="account-detail-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <LinearGradient colors={[gradientFrom, gradientTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.balanceCard}>
          <Text style={styles.heroName}>{account.name}</Text>
          <Text style={styles.heroSubtitle}>Compte bancaire{account.active ? '' : ' · Désactivé'}</Text>
          <Text style={styles.balanceLabel}>Solde</Text>
          <Text style={styles.balanceAmount}>{formatDh(account.balance)}</Text>
        </LinearGradient>

        {account.subaccounts.length > 0 && (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionLabel}>SOUS-COMPTES</Text>
              <TouchableOpacity onPress={() => navigation.navigate('CreateSubaccount', { accountId: account.id })} testID="account-detail-add-subaccount">
                <Text style={styles.addLink}>+ Ajouter</Text>
              </TouchableOpacity>
            </View>
            {account.subaccounts.map((sub) => {
              const goal = goals.find((g) => g.subaccountId === sub.id) ?? null;
              return (
                <TouchableOpacity
                  key={sub.id}
                  style={styles.subaccountCard}
                  onPress={() => navigation.navigate('SubaccountDetail', { id: sub.id })}
                  testID={`account-detail-subaccount-${sub.id}`}
                >
                  <View style={styles.subaccountTopRow}>
                    <Text style={styles.subaccountName} numberOfLines={1}>{sub.name}</Text>
                    <Text style={styles.subaccountBalance}>{formatDh(sub.balance)}</Text>
                  </View>
                  {goal ? (
                    <>
                      <View style={styles.subaccountBarTrack}>
                        <View style={[styles.subaccountBarFill, { width: `${Math.min(100, Math.round(goal.percent))}%` }]} />
                      </View>
                      <Text style={styles.subaccountMeta}>
                        {Math.round(goal.percent)}% de l'objectif de {formatDh(goal.targetAmount)}
                      </Text>
                    </>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </>
        )}

        <View style={styles.historyCard}>
          <Text style={styles.sectionLabel}>HISTORIQUE DES TRANSACTIONS</Text>
          {(operations ?? []).length === 0 ? (
            <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
          ) : (
            (operations ?? []).map((op) => {
              const amount = localAmount(op.ledgerEntries, { accountId: id });
              return (
                <TouchableOpacity
                  key={op.id}
                  style={styles.opRow}
                  onPress={() => navigation.navigate('TransactionDetail', { id: op.id, accountId: id })}
                  testID={`transaction-row-${testIdSlug(op.label)}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.opLabel}>{op.label}</Text>
                    <Text style={styles.opMeta}>
                      {formatShortDate(op.date)} · {OPERATION_KIND_LABELS[op.kind]}
                    </Text>
                  </View>
                  <Text style={[styles.opAmount, amount > 0 ? styles.opAmountPlus : amount < 0 ? styles.opAmountMinus : null]}>
                    {amount > 0 ? '+' : ''}
                    {formatDh(amount)}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </ScrollView>

      <ChoiceSheet
        visible={menuOpen}
        title={account.name}
        onClose={() => setMenuOpen(false)}
        testID="account-detail-choice-sheet"
        options={[
          { key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setRenameOpen(true) },
          { key: 'color', label: 'Couleur de la carte', icon: 'color-palette-outline', onPress: () => setColorOpen(true) },
          {
            key: 'add-transaction',
            label: 'Ajouter une transaction',
            icon: 'add-circle-outline',
            disabled: !account.active,
            onPress: () => navigation.navigate('Tabs', { screen: 'Ajouter', params: { prefill: { sourceAccountId: account.id } } }),
          },
          account.active
            ? {
                key: 'deactivate',
                label: 'Désactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateAccount(account.id, { active: false });
                  await load();
                },
              }
            : {
                key: 'reactivate',
                label: 'Réactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateAccount(account.id, { active: true });
                  await load();
                },
              },
        ]}
      />

      <RenameModal
        visible={renameOpen}
        title="Modifier le nom du compte"
        initialValue={account.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={async (name) => {
          await api.renameAccount(account.id, name);
          await load();
        }}
      />

      <ColorPickerModal
        visible={colorOpen}
        title="Couleur de la carte"
        initialColorKey={account.colorKey}
        onClose={() => setColorOpen(false)}
        onSubmit={async (colorKey) => {
          await api.updateAccount(account.id, { colorKey });
          await load();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  backRow: { flexDirection: 'row', alignItems: 'center' },
  backLabel: { fontSize: 14, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary, marginLeft: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginBottom: spacing.lg },
  // Carte de synthèse en relief, dégradé par compte (maquette « Foyer »
  // 02-DétailCompte validée) — remplace l'ancien fond plat.
  balanceCard: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...elevation.raised,
  },
  heroName: { fontSize: 18, fontFamily: fontFamily.displayBold, color: colors.textOnPrimary },
  heroSubtitle: { fontSize: 12, fontFamily: fontFamily.sansMedium, color: 'rgba(255,255,255,0.85)', marginTop: 2, marginBottom: spacing.md },
  balanceLabel: { fontSize: 11, fontFamily: fontFamily.sansBold, color: 'rgba(255,255,255,0.8)', marginBottom: 2 },
  balanceAmount: { fontSize: 32, fontFamily: fontFamily.displayBold, color: colors.textOnPrimary },
  // Sous-comptes (maquette « Foyer » 02-DétailCompte validée) — entre le hero
  // et l'historique : nom/solde + barre de progression quand un objectif
  // existe, exactement comme le compte parent.
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  addLink: { fontSize: 12, fontFamily: fontFamily.sansBold, color: colors.primary },
  subaccountCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    ...elevation.card,
  },
  subaccountTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  subaccountName: { fontSize: 13.5, fontFamily: fontFamily.sansBold, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  subaccountBalance: { fontSize: 13.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  subaccountBarTrack: { height: 7, borderRadius: 4, backgroundColor: colors.surfaceSecondary, marginTop: spacing.sm, overflow: 'hidden' },
  subaccountBarFill: { height: 7, borderRadius: 4, backgroundColor: colors.secondary },
  subaccountMeta: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: colors.textSecondary, marginTop: 4 },
  // "Historique des transactions" dans sa propre section visuelle (Lot ciblé §3).
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    marginHorizontal: spacing.lg,
    ...elevation.card,
  },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  emptyText: { ...typography.bodySecondary },
  opRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  opLabel: { fontSize: 13, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  opMeta: { ...typography.caption, marginTop: 2 },
  opAmount: { fontSize: 13, fontFamily: fontFamily.sansBold },
  opAmountPlus: { color: colors.success },
  opAmountMinus: { color: colors.danger },
});
