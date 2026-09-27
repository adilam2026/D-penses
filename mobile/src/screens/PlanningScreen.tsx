import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import * as api from '../api/client';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { useBottomInset } from '../ui/useBottomInset';

const HORIZON_OPTIONS = [3, 6, 9, 12] as const;
const LABEL_WIDTH = 130;
const MONTH_WIDTH = 108;
const ROW_HEIGHT = 46;
const SECTION_HEIGHT = 30;
const HEADER_HEIGHT = 40;

interface BlockDef {
  title: string;
  rows: api.PlanningRowApi[];
  totalLabel: string;
  totalKey: 'totalRevenus' | 'totalDepenses' | 'totalEpargne';
  emptyText: string;
}

function accountLabel(accounts: api.AccountApi[], accountId: string | null, subaccountId: string | null): string {
  if (!accountId) return '';
  const account = accounts.find((a) => a.id === accountId);
  if (!account) return '';
  if (subaccountId) {
    const sub = account.subaccounts.find((s) => s.id === subaccountId);
    if (sub) return sub.name;
  }
  return account.name;
}

function relevantAccount(item: { sourceAccountId: string | null; sourceSubaccountId: string | null; destinationAccountId: string | null; destinationSubaccountId: string | null }) {
  if (item.sourceAccountId) return { accountId: item.sourceAccountId, subaccountId: item.sourceSubaccountId, preposition: 'depuis' as const };
  return { accountId: item.destinationAccountId, subaccountId: item.destinationSubaccountId, preposition: 'vers' as const };
}

/**
 * Planning multi-mois (Checkpoint 3) — pilotage budgétaire complet : 4 blocs
 * (Revenus/Dépenses/Épargne/Synthèse), horizon 3-12 mois, prembattre colonne
 * figée + défilement horizontal des mois, tap = réaliser, appui long = ajuster
 * ou annuler, détail catégorie sur case agrégée.
 */
export function PlanningScreen() {
  const navigation = useNavigation<any>();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<api.PlanningTableApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [plans, setPlans] = useState<api.FinancialPlanApi[]>([]);
  const [loading, setLoading] = useState(true);

  const [confirmTarget, setConfirmTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string; month: string } | null>(null);
  const [realizedMenuTarget, setRealizedMenuTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  const [viewOperationId, setViewOperationId] = useState<string | null>(null);

  const load = useCallback(async (h: number) => {
    const [planning, accountList, planList] = await Promise.all([api.getPlanning(h), api.listAccounts(), api.listFinancialPlans()]);
    setData(planning);
    setAccounts(accountList);
    setPlans(planList);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(months).finally(() => setLoading(false));
    }, [load, months]),
  );

  async function refresh() {
    await load(months);
  }

  function onCellPress(cell: api.PlanningCellApi, rowLabel: string) {
    if (cell.status === 'EMPTY') return;
    if (cell.singleOccurrence && cell.singleOccurrence.status === 'PENDING') {
      setConfirmTarget({ cell, rowLabel });
      return;
    }
    setDetailTarget({ cell, rowLabel, month: '' });
  }

  function onCellLongPress(cell: api.PlanningCellApi, rowLabel: string) {
    if (cell.status === 'EMPTY') return;
    if (cell.singleOccurrence?.status === 'PENDING') {
      setAdjustTarget({ cell, rowLabel });
      return;
    }
    if (cell.singleOccurrence?.status === 'REALIZED') {
      setRealizedMenuTarget({ cell, rowLabel });
      return;
    }
    setDetailTarget({ cell, rowLabel, month: '' });
  }

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (!data) return null;

  const blocks: BlockDef[] = [
    { title: 'REVENUS', rows: data.revenus, totalLabel: 'TOTAL REVENUS', totalKey: 'totalRevenus', emptyText: 'Aucun revenu prévu.' },
    { title: 'DÉPENSES', rows: data.depenses, totalLabel: 'TOTAL DÉPENSES', totalKey: 'totalDepenses', emptyText: 'Aucune dépense prévue.' },
    { title: 'ÉPARGNE / VERSEMENTS', rows: data.epargne, totalLabel: 'TOTAL ÉPARGNE', totalKey: 'totalEpargne', emptyText: 'Aucun versement prévu.' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Planning</Text>
          <Text style={styles.subtitle}>Pilotez vos revenus, dépenses et épargne mois par mois.</Text>
        </View>
        <HelpButton
          title="Planning"
          text="Une case grise = prévu, appuyez dessus pour la régler. Une case verte = déjà réalisée. Appui long pour ajuster le montant avant paiement ou annuler un paiement déjà fait."
        />
      </View>

      <View style={styles.horizonBar}>
        {HORIZON_OPTIONS.map((h) => (
          <TouchableOpacity key={h} style={[styles.horizonPill, months === h && styles.horizonPillActive]} onPress={() => setMonths(h)} testID={`planning-horizon-${h}`}>
            <Text style={[styles.horizonPillText, months === h && styles.horizonPillTextActive]}>{h} mois</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={styles.tableRow}>
          <View style={{ width: LABEL_WIDTH }}>
            <View style={[styles.labelCell, { height: HEADER_HEIGHT }]} />
            {blocks.map((block) => (
              <React.Fragment key={block.title}>
                <View style={[styles.sectionLabelCell, { height: SECTION_HEIGHT }]}>
                  <Text style={styles.sectionLabelText}>{block.title}</Text>
                </View>
                {block.rows.length === 0 ? (
                  <View style={[styles.labelCell, { height: ROW_HEIGHT }]}>
                    <Text style={styles.emptyRowText} numberOfLines={2}>
                      {block.emptyText}
                    </Text>
                  </View>
                ) : (
                  block.rows.map((row) => (
                    <View key={row.key} style={[styles.labelCell, { height: ROW_HEIGHT }]}>
                      <Text style={styles.rowLabelText} numberOfLines={2}>
                        {row.label}
                      </Text>
                    </View>
                  ))
                )}
                <View style={[styles.totalLabelCell, { height: ROW_HEIGHT }]}>
                  <Text style={styles.totalLabelText}>{block.totalLabel}</Text>
                </View>
              </React.Fragment>
            ))}
            <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, backgroundColor: colors.surfaceActive }]}>
              <Text style={styles.totalLabelText}>BALANCE MENSUELLE</Text>
            </View>
            <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, backgroundColor: colors.surfaceActive }]}>
              <Text style={styles.totalLabelText}>BALANCE CUMULÉE</Text>
            </View>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View>
              <View style={{ flexDirection: 'row', height: HEADER_HEIGHT }}>
                {data.months.map((m) => (
                  <View key={m} style={[styles.monthHeaderCell, { width: MONTH_WIDTH }]}>
                    <Text style={styles.monthHeaderText}>{formatMonthLabel(m)}</Text>
                  </View>
                ))}
              </View>

              {blocks.map((block) => (
                <React.Fragment key={block.title}>
                  <View style={{ flexDirection: 'row', height: SECTION_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.sectionSpacerCell, { width: MONTH_WIDTH }]} />
                    ))}
                  </View>
                  {block.rows.length === 0
                    ? [
                        <View key="empty" style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                          {data.months.map((m) => (
                            <View key={m} style={[styles.cell, { width: MONTH_WIDTH }]} />
                          ))}
                        </View>,
                      ]
                    : block.rows.map((row) => (
                        <View key={row.key} style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                          {data.months.map((m) => (
                            <PlanningCellView
                              key={m}
                              cell={row.cells[m]}
                              onPress={() => onCellPress(row.cells[m], row.label)}
                              onLongPress={() => onCellLongPress(row.cells[m], row.label)}
                            />
                          ))}
                        </View>
                      ))}
                  <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.totalCell, { width: MONTH_WIDTH }]}>
                        <Text style={styles.totalCellText}>{formatDh(data.synthese[m][block.totalKey])}</Text>
                      </View>
                    ))}
                  </View>
                </React.Fragment>
              ))}

              <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                {data.months.map((m) => (
                  <View key={m} style={[styles.totalCell, styles.syntheseCell, { width: MONTH_WIDTH }]}>
                    <Text style={[styles.totalCellText, data.synthese[m].balanceMensuelle < 0 && styles.negativeText]}>{formatDh(data.synthese[m].balanceMensuelle)}</Text>
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                {data.months.map((m) => (
                  <View key={m} style={[styles.totalCell, styles.syntheseCell, { width: MONTH_WIDTH }]}>
                    <Text style={[styles.totalCellText, data.synthese[m].balanceCumulee < 0 && styles.negativeText]}>{formatDh(data.synthese[m].balanceCumulee)}</Text>
                  </View>
                ))}
              </View>
            </View>
          </ScrollView>
        </View>

        <PlansSection plans={plans} onOpen={(id) => navigation.navigate('FinancialPlanDetail', { id })} />
      </ScrollView>

      <ConfirmPayModal
        target={confirmTarget}
        accounts={accounts}
        onClose={() => setConfirmTarget(null)}
        onDone={async () => {
          setConfirmTarget(null);
          await refresh();
        }}
      />

      <AdjustModal
        target={adjustTarget}
        accounts={accounts}
        onClose={() => setAdjustTarget(null)}
        onDone={async () => {
          setAdjustTarget(null);
          await refresh();
        }}
      />

      <CategoryDetailModal target={detailTarget} onClose={() => setDetailTarget(null)} />

      <ChoiceSheet
        visible={!!realizedMenuTarget}
        title={realizedMenuTarget?.rowLabel ?? ''}
        onClose={() => setRealizedMenuTarget(null)}
        testID="planning-realized-menu"
        options={[
          {
            key: 'view',
            label: 'Voir la transaction',
            icon: 'receipt-outline',
            onPress: () => setViewOperationId(realizedMenuTarget?.cell.singleOccurrence ? (realizedMenuTarget.cell.items[0]?.financialOperationId ?? null) : null),
          },
          {
            key: 'edit',
            label: 'Modifier',
            icon: 'create-outline',
            onPress: async () => {
              const occ = realizedMenuTarget?.cell.singleOccurrence;
              if (!occ) return;
              await api.unrealizePlannedOperation(occ.plannedOperationId);
              await refresh();
              setAdjustTarget({ cell: realizedMenuTarget!.cell, rowLabel: realizedMenuTarget!.rowLabel });
            },
          },
          {
            key: 'cancel',
            label: 'Annuler le paiement',
            icon: 'close-circle-outline',
            onPress: async () => {
              const occ = realizedMenuTarget?.cell.singleOccurrence;
              if (!occ) return;
              await api.unrealizePlannedOperation(occ.plannedOperationId);
              await refresh();
            },
          },
        ]}
      />

      <OperationViewModal operationId={viewOperationId} onClose={() => setViewOperationId(null)} />
    </View>
  );
}

function PlanningCellView({ cell, onPress, onLongPress }: { cell: api.PlanningCellApi; onPress: () => void; onLongPress: () => void }) {
  const isRealized = cell.status === 'REALIZED';
  const isMixed = cell.status === 'MIXED';
  return (
    <TouchableOpacity
      style={[styles.cell, { width: MONTH_WIDTH }, isRealized && styles.cellRealized, isMixed && styles.cellMixed]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={cell.status === 'EMPTY'}
      testID="planning-cell"
    >
      {cell.status === 'EMPTY' ? (
        <Text style={styles.cellEmpty}>—</Text>
      ) : (
        <Text style={[styles.cellAmount, isRealized && styles.cellAmountRealized]}>
          {formatDh(cell.displayAmount)}
          {isRealized ? ' ✓' : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function ConfirmPayModal({
  target,
  accounts,
  onClose,
  onDone,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (!target?.cell.singleOccurrence) return null;
  const occ = target.cell.singleOccurrence;
  const { accountId, subaccountId, preposition } = relevantAccount(occ);
  const label = accountLabel(accounts, accountId, subaccountId);

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      await api.realizePlannedOperation(occ.plannedOperationId, { actualAmount: String(occ.expectedAmount) });
      await onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.confirmBox}>
        <Text style={styles.confirmTitle}>{target.rowLabel}</Text>
        <Text style={styles.confirmText}>
          Payer {formatDh(occ.expectedAmount)}
          {label ? ` ${preposition} ${label}` : ''} ?
        </Text>
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="planning-confirm-cancel">
            <Text style={styles.confirmCancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmPay} onPress={confirm} testID="planning-confirm-pay">
            <Text style={styles.confirmPayText}>{saving ? '…' : 'Payer'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function AdjustModal({
  target,
  accounts,
  onClose,
  onDone,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const occ = target?.cell.singleOccurrence ?? null;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (occ) {
      setAmount(String(occ.expectedAmount));
      setDate(new Date().toISOString().slice(0, 10));
    }
  }, [occ?.plannedOperationId]);

  if (!target || !occ) return null;
  const { accountId, subaccountId } = relevantAccount(occ);
  const label = accountLabel(accounts, accountId, subaccountId);

  async function submit() {
    if (!amount.trim() || saving || !occ) return;
    setSaving(true);
    try {
      await api.realizePlannedOperation(occ.plannedOperationId, { actualAmount: amount, actualDate: date || undefined });
      await onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView style={styles.adjustSheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.confirmTitle}>{target.rowLabel}</Text>
        <Text style={styles.adjustPrevu}>Prévu {formatDh(occ.expectedAmount)}</Text>
        <FormField label="Montant réel" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" testID="planning-adjust-amount" />
        <DateField label="Date" value={date} onChange={setDate} />
        {label ? <Text style={styles.adjustAccount}>Compte : {label}</Text> : null}
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="planning-adjust-cancel">
            <Text style={styles.confirmCancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmPay} onPress={submit} testID="planning-adjust-submit">
            <Text style={styles.confirmPayText}>{saving ? '…' : `Payer ${amount ? formatDh(Number(amount)) : ''}`}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

function CategoryDetailModal({ target, onClose }: { target: { cell: api.PlanningCellApi; rowLabel: string; month: string } | null; onClose: () => void }) {
  const bottomInset = useBottomInset(spacing.lg);
  if (!target) return null;
  const { cell, rowLabel } = target;
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView style={styles.adjustSheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.confirmTitle}>{rowLabel}</Text>
        {cell.items.length === 0 ? (
          <Text style={styles.emptyRowText}>Aucune opération.</Text>
        ) : (
          cell.items.map((item, i) => (
            <View key={`${item.plannedOperationId ?? item.financialOperationId}-${i}`} style={styles.detailRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.detailLabel}>{item.label}</Text>
                <Text style={styles.detailMeta}>
                  {formatShortDate(item.date)} · {item.type === 'PLANNED_PENDING' ? 'Prévu' : item.type === 'PLANNED_REALIZED' ? 'Réalisé' : 'Non prévu'}
                </Text>
              </View>
              <Text style={styles.detailAmount}>{formatDh(item.amount)}</Text>
            </View>
          ))
        )}
        <View style={styles.detailTotalRow}>
          <Text style={styles.detailTotalLabel}>Total</Text>
          <Text style={styles.detailTotalAmount}>{formatDh(cell.displayAmount)}</Text>
        </View>
      </ScrollView>
    </Modal>
  );
}

function OperationViewModal({ operationId, onClose }: { operationId: string | null; onClose: () => void }) {
  const [operation, setOperation] = useState<api.FinancialOperationApi | null>(null);

  React.useEffect(() => {
    if (operationId) api.getFinancialOperation(operationId).then(setOperation);
    else setOperation(null);
  }, [operationId]);

  if (!operationId) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.confirmBox}>
        {operation ? (
          <>
            <Text style={styles.confirmTitle}>{operation.label}</Text>
            <Text style={styles.confirmText}>{formatShortDate(operation.date)}</Text>
            <Text style={styles.adjustPrevu}>{formatDh(operation.amount)}</Text>
          </>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        <TouchableOpacity style={styles.confirmPay} onPress={onClose}>
          <Text style={styles.confirmPayText}>Fermer</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

function PlansSection({ plans, onOpen }: { plans: api.FinancialPlanApi[]; onOpen: (id: string) => void }) {
  if (plans.length === 0) return null;
  return (
    <View style={styles.plansSection}>
      <Text style={styles.plansSectionTitle}>PLANS FINANCIERS</Text>
      {plans.map((plan) => (
        <TouchableOpacity key={plan.id} style={styles.planCard} onPress={() => onOpen(plan.id)} testID={`planning-plan-${plan.id}`}>
          <View style={styles.planHeader}>
            <Text style={styles.planLabel}>{plan.label}</Text>
            {plan.nextDeadline ? (
              <Text style={styles.planNextDeadline}>
                {plan.nextDeadline.label} : {formatDh(plan.nextDeadline.totalPrevu)}
              </Text>
            ) : null}
          </View>
          <Text style={styles.planViewLink}>Voir le plan ›</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 260 },
  horizonBar: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  horizonPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  horizonPillActive: { backgroundColor: colors.primary },
  horizonPillText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  horizonPillTextActive: { color: colors.textOnPrimary },
  tableRow: { flexDirection: 'row', paddingLeft: spacing.lg },
  labelCell: { justifyContent: 'center', paddingRight: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  sectionLabelCell: { justifyContent: 'flex-end', paddingBottom: 4 },
  sectionLabelText: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5 },
  rowLabelText: { ...typography.body, fontWeight: '600' },
  emptyRowText: { ...typography.caption, color: colors.textPlaceholder },
  totalLabelCell: { justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, paddingRight: spacing.sm },
  totalLabelText: { ...typography.caption, fontWeight: '800', color: colors.textPrimary },
  monthHeaderCell: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 4 },
  monthHeaderText: { ...typography.caption, fontWeight: '800', color: colors.textSecondary },
  sectionSpacerCell: {},
  cell: { alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, borderLeftWidth: 1, borderLeftColor: colors.divider },
  cellRealized: { backgroundColor: colors.successLight },
  cellMixed: { backgroundColor: colors.warningLight },
  cellEmpty: { color: colors.textPlaceholder },
  cellAmount: { ...typography.body, fontWeight: '700' },
  cellAmountRealized: { color: colors.success },
  totalCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderTopWidth: 1, borderTopColor: colors.borderStrong, borderLeftWidth: 1, borderLeftColor: colors.divider },
  totalCellText: { ...typography.body, fontWeight: '800' },
  syntheseCell: { backgroundColor: colors.surfaceActive },
  negativeText: { color: colors.danger },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  confirmBox: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    top: '35%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  confirmTitle: { ...typography.sectionTitle, marginBottom: spacing.sm },
  confirmText: { ...typography.body, marginBottom: spacing.lg },
  confirmActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  confirmCancel: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  confirmCancelText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  confirmPay: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary },
  confirmPayText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  adjustSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  adjustPrevu: { ...typography.bodySecondary, marginBottom: spacing.md },
  adjustAccount: { ...typography.bodySecondary, marginBottom: spacing.md },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  detailLabel: { ...typography.body, fontWeight: '600' },
  detailMeta: { ...typography.caption, marginTop: 2 },
  detailAmount: { ...typography.body, fontWeight: '700' },
  detailTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.md },
  detailTotalLabel: { ...typography.body, fontWeight: '800' },
  detailTotalAmount: { ...typography.body, fontWeight: '800' },
  plansSection: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  plansSectionTitle: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.sm },
  planCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planLabel: { ...typography.body, fontWeight: '700' },
  planNextDeadline: { ...typography.bodySecondary },
  planViewLink: { ...typography.caption, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
});
