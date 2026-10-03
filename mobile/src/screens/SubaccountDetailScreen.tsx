import React, { useCallback, useEffect, useState } from 'react';
import { RouteProp, useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, elevation, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatShortDate } from '../ui/formatMoney';
import { OPERATION_KIND_LABELS, localAmount } from '../ui/operationKindLabel';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { RenameModal } from '../ui/RenameModal';
import { HelpButton } from '../ui/HelpButton';
import { isSanteSubaccount } from '../ui/santeDetection';
import { testIdSlug } from '../ui/testIdSlug';
import { paletteForAccount } from '../ui/accountPalette';
import { ProgressRing } from '../ui/ProgressRing';
import { GoalModal } from './EpargneScreen';

/**
 * Détail sous-compte (Lot ciblé §3) — carte de synthèse en relief (couleur du
 * compte parent, compte parent nommé, disponible très visible) puis
 * "Historique des transactions" dans sa propre section. "Ajouter de l'argent"
 * en item de menu supplémentaire. Le sous-compte Santé n'utilise jamais cet
 * écran (redirection vers Health).
 */
export function SubaccountDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ SubaccountDetail: { id: string } }, 'SubaccountDetail'>>();
  const { id } = route.params;
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const [account, setAccount] = useState<api.AccountApi | null>(null);
  const [subaccount, setSubaccount] = useState<api.SubaccountApi | null>(null);
  const [operations, setOperations] = useState<api.FinancialOperationApi[] | null>(null);
  const [goal, setGoal] = useState<api.GoalApi | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);

  const load = useCallback(async () => {
    const [accounts, goals] = await Promise.all([api.listAccounts(), api.listGoals()]);
    const parent = accounts.find((a) => a.subaccounts.some((s) => s.id === id));
    const sub = parent?.subaccounts.find((s) => s.id === id) ?? null;
    setAccount(parent ?? null);
    setSubaccount(sub);
    setGoal(goals.find((g) => g.subaccountId === id) ?? null);
    if (sub) setOperations(await api.listFinancialOperations({ subaccountId: id }));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    if (subaccount && isSanteSubaccount(subaccount.name)) {
      navigation.replace('Health', { id });
    }
  }, [subaccount, id, navigation]);

  if (!account || !subaccount) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const palette = paletteForAccount(account.colorKey, 0);

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
              title={subaccount.name}
              text="Le disponible est la part de ce compte déjà réservée pour cette enveloppe. L'historique liste les opérations qui l'ont affectée."
            />
            <TouchableOpacity testID="subaccount-detail-menu" onPress={() => setMenuOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        {goal ? (
          <View style={[styles.goalCard, { backgroundColor: palette.bg }]} testID="subaccount-goal-card">
            <Text style={[styles.title, { color: palette.text }]}>{subaccount.name}</Text>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>Rattaché à {account.name}{subaccount.active ? '' : ' · Désactivé'}</Text>
            <View style={styles.ringWrap}>
              <ProgressRing
                percent={goal.percent}
                color={palette.text}
                trackColor="rgba(255,255,255,0.3)"
                labelColor={palette.text}
                subLabelColor={palette.textSecondary}
                subLabel={`${formatDh(goal.current)} / ${formatDh(goal.targetAmount)}`}
              />
            </View>
            {goal.targetDate ? (
              <Text style={[styles.goalDeadline, { color: palette.textSecondary }]}>Objectif pour {formatShortDate(goal.targetDate)}</Text>
            ) : null}
            <View style={styles.ctaRow}>
              <TouchableOpacity
                style={styles.ctaPrimary}
                disabled={!subaccount.active}
                onPress={() =>
                  navigation.navigate('Tabs', { screen: 'Ajouter', params: { prefill: { kind: 'SAVINGS_CONTRIBUTION', destinationAccountId: account.id, destinationSubaccountId: subaccount.id } } })
                }
                testID="subaccount-goal-contribute"
              >
                <Text style={styles.ctaPrimaryText}>+ Faire un versement</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ctaSecondary} onPress={() => setGoalOpen(true)} testID="subaccount-goal-edit">
                <Text style={styles.ctaSecondaryText}>Modifier l'objectif</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.balanceCard, { backgroundColor: palette.bg }]}>
            <Text style={[styles.title, { color: palette.text }]}>{subaccount.name}</Text>
            <Text style={[styles.subtitle, { color: palette.textSecondary }]}>Rattaché à {account.name}{subaccount.active ? '' : ' · Désactivé'}</Text>
            <Text style={[styles.balanceLabel, { color: palette.textSecondary }]}>Disponible</Text>
            <Text style={[styles.balanceAmount, { color: palette.text }]}>{formatDh(subaccount.balance)}</Text>
          </View>
        )}

        <View style={styles.historyCard}>
          <Text style={styles.sectionLabel}>HISTORIQUE DES TRANSACTIONS</Text>
          {(operations ?? []).length === 0 ? (
            <Text style={styles.emptyText}>Aucune transaction pour l'instant.</Text>
          ) : (
            (operations ?? []).map((op) => {
              const amount = localAmount(op.ledgerEntries, { subaccountId: id });
              return (
                <TouchableOpacity
                  key={op.id}
                  style={styles.opRow}
                  onPress={() => navigation.navigate('TransactionDetail', { id: op.id, subaccountId: id })}
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
        title={subaccount.name}
        onClose={() => setMenuOpen(false)}
        testID="subaccount-detail-choice-sheet"
        options={[
          { key: 'edit', label: 'Modifier', icon: 'create-outline', onPress: () => setRenameOpen(true) },
          {
            key: 'add-transaction',
            label: 'Ajouter une transaction',
            icon: 'add-circle-outline',
            disabled: !subaccount.active,
            onPress: () =>
              navigation.navigate('Tabs', {
                screen: 'Ajouter',
                params: { prefill: { sourceAccountId: account.id, sourceSubaccountId: subaccount.id } },
              }),
          },
          {
            key: 'add-money',
            label: "Ajouter de l'argent",
            icon: 'wallet-outline',
            disabled: !subaccount.active,
            onPress: () =>
              navigation.navigate('Tabs', {
                screen: 'Ajouter',
                params: { prefill: { kind: 'SAVINGS_CONTRIBUTION', destinationAccountId: account.id, destinationSubaccountId: subaccount.id } },
              }),
          },
          subaccount.active
            ? {
                key: 'deactivate',
                label: 'Désactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateSubaccount(subaccount.id, { active: false });
                  await load();
                },
              }
            : {
                key: 'reactivate',
                label: 'Réactiver',
                icon: 'power-outline',
                onPress: async () => {
                  await api.updateSubaccount(subaccount.id, { active: true });
                  await load();
                },
              },
        ]}
      />

      <RenameModal
        visible={renameOpen}
        title="Modifier le nom du sous-compte"
        initialValue={subaccount.name}
        onClose={() => setRenameOpen(false)}
        onSubmit={async (name) => {
          await api.renameSubaccount(subaccount.id, name);
          await load();
        }}
      />

      <GoalModal
        target={goalOpen ? { subaccountId: subaccount.id, name: subaccount.name, goal } : null}
        onClose={() => setGoalOpen(false)}
        onSaved={async () => {
          setGoalOpen(false);
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
  backLabel: { ...typography.body, fontWeight: '600', marginLeft: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginBottom: spacing.lg },
  balanceCard: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    ...elevation.raised,
  },
  balanceLabel: { ...typography.bodySecondary, marginBottom: spacing.xs },
  balanceAmount: { ...typography.amountPrimary },
  // Carte objectif (maquette « Foyer » validée — Détail Épargne/sous-compte) :
  // jauge circulaire centrée, échéance, puis les deux CTA (verser/modifier).
  goalCard: {
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
    ...elevation.raised,
  },
  ringWrap: { marginTop: spacing.md, marginBottom: spacing.sm },
  goalDeadline: { ...typography.caption, marginBottom: spacing.lg },
  ctaRow: { width: '100%', gap: spacing.sm },
  ctaPrimary: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  ctaPrimaryText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  ctaSecondary: { alignItems: 'center', paddingVertical: spacing.sm },
  ctaSecondaryText: { ...typography.bodySecondary, fontWeight: '700', color: colors.textOnPrimary, textDecorationLine: 'underline' },
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
  opLabel: { ...typography.body, fontWeight: '600' },
  opMeta: { ...typography.caption, marginTop: 2 },
  opAmount: { ...typography.body, fontWeight: '700' },
  opAmountPlus: { color: colors.success },
  opAmountMinus: { color: colors.danger },
});
