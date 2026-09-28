import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { DateField } from '../ui/DateField';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { useBottomInset } from '../ui/useBottomInset';
import { testIdSlug } from '../ui/testIdSlug';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';

const HORIZON_OPTIONS = [3, 6, 9, 12] as const;
const LABEL_WIDTH = 130;
const MONTH_WIDTH = 108;
const ROW_HEIGHT = 46;
const ROW_EXPAND_HEIGHT = 30;
const SECTION_HEIGHT = 30;
const HEADER_HEIGHT = 40;

interface BlockDef {
  title: string;
  rows: api.PlanningRowApi[];
  totalLabel: string;
  totalKey: 'totalRevenus' | 'totalDepenses' | 'totalEpargne';
  emptyText: string;
  /** Teinte de section (§7, lisibilité visuelle uniquement — aucune logique) : distingue REVENUS/DÉPENSES/ÉPARGNE d'un coup d'œil. */
  accentColor: string;
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
  // Expand/collapse par ligne (§12) : alternative légère à la modale — un
  // chevron sur la ligne (colonne figée) déplie un bandeau pleine largeur
  // avec le cumul Réalisé/À venir de la ligne sur tout l'horizon affiché,
  // sans ouvrir de modale ni changer la hauteur des autres lignes.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

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

  function toggleRowExpand(key: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function rowRollup(row: api.PlanningRowApi, months: string[]) {
    let realized = 0;
    let pending = 0;
    for (const m of months) {
      realized += row.cells[m].realizedAmount;
      pending += row.cells[m].pendingAmount;
    }
    return { realized, pending };
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
    { title: 'REVENUS', rows: data.revenus, totalLabel: 'TOTAL REVENUS', totalKey: 'totalRevenus', emptyText: 'Aucun revenu prévu.', accentColor: colors.success },
    { title: 'DÉPENSES', rows: data.depenses, totalLabel: 'TOTAL DÉPENSES', totalKey: 'totalDepenses', emptyText: 'Aucune dépense prévue.', accentColor: colors.danger },
    { title: 'ÉPARGNE / VERSEMENTS', rows: data.epargne, totalLabel: 'TOTAL ÉPARGNE', totalKey: 'totalEpargne', emptyText: 'Aucun versement prévu.', accentColor: colors.primary },
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
                <View style={[styles.sectionLabelCell, { height: SECTION_HEIGHT, borderLeftColor: block.accentColor }]}>
                  <Text style={[styles.sectionLabelText, { color: block.accentColor }]}>{block.title}</Text>
                </View>
                {block.rows.length === 0 ? (
                  <View style={[styles.labelCell, { height: ROW_HEIGHT }]}>
                    <Text style={styles.emptyRowText} numberOfLines={2}>
                      {block.emptyText}
                    </Text>
                  </View>
                ) : (
                  block.rows.map((row) => {
                    const expanded = expandedRows.has(row.key);
                    const rollup = rowRollup(row, data.months);
                    return (
                      <React.Fragment key={row.key}>
                        <TouchableOpacity
                          style={[styles.labelCell, { height: ROW_HEIGHT }]}
                          onPress={() => toggleRowExpand(row.key)}
                          testID={`planning-row-toggle-${testIdSlug(row.label)}`}
                        >
                          <Text style={styles.rowLabelText} numberOfLines={2}>
                            {row.label}
                          </Text>
                          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textPlaceholder} />
                        </TouchableOpacity>
                        {expanded && (
                          <View style={[styles.rowExpandLabelCell, { height: ROW_EXPAND_HEIGHT }]}>
                            <Text style={styles.rowExpandText} numberOfLines={2} testID={`planning-row-rollup-${testIdSlug(row.label)}`}>
                              Réalisé {formatDh(rollup.realized)} · À venir {formatDh(rollup.pending)}
                            </Text>
                          </View>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
                <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: block.accentColor }]}>
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
                        <React.Fragment key={row.key}>
                          <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                            {data.months.map((m) => (
                              <PlanningCellView
                                key={m}
                                cell={row.cells[m]}
                                onPress={() => onCellPress(row.cells[m], row.label)}
                                onLongPress={() => onCellLongPress(row.cells[m], row.label)}
                                testID={`planning-cell-${testIdSlug(row.label)}-${m}`}
                              />
                            ))}
                          </View>
                          {expandedRows.has(row.key) && (
                            <View style={[styles.rowExpandMonthsCell, { height: ROW_EXPAND_HEIGHT, width: MONTH_WIDTH * data.months.length }]} />
                          )}
                        </React.Fragment>
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

      <CategoryDetailModal
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
        onRealized={async () => {
          setDetailTarget(null);
          await refresh();
        }}
        onViewOperation={(operationId) => navigation.navigate('TransactionDetail', { id: operationId })}
      />

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
            onPress: () => {
              const operationId = realizedMenuTarget?.cell.items[0]?.financialOperationId;
              if (operationId) navigation.navigate('TransactionDetail', { id: operationId });
            },
          },
          {
            key: 'edit',
            label: 'Modifier le paiement',
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
    </View>
  );
}

function PlanningCellView({
  cell,
  onPress,
  onLongPress,
  testID,
}: {
  cell: api.PlanningCellApi;
  onPress: () => void;
  onLongPress: () => void;
  testID: string;
}) {
  const isRealized = cell.status === 'REALIZED';
  const isPending = cell.status === 'PENDING';
  const isMixed = cell.status === 'MIXED';
  return (
    <TouchableOpacity
      style={[styles.cell, { width: MONTH_WIDTH }, isRealized && styles.cellRealized, isPending && styles.cellPending, isMixed && styles.cellMixed]}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={cell.status === 'EMPTY'}
      testID={testID}
    >
      {cell.status === 'EMPTY' ? (
        <Text style={styles.cellEmpty}>—</Text>
      ) : isMixed ? (
        // Case MIXTE : réalisé ET à venir dans la même case — jamais fondus en un seul
        // total ambigu (§9 : ex. 570 réalisé / 592 total ne doit jamais lire "réalisé").
        // Ligne 1 = réalisé/total (texte exact conservé pour compat tests), ligne 2 =
        // le restant explicite, pour qu'un coup d'œil ne suggère jamais "tout payé".
        <View style={styles.cellMixedWrap} testID={`${testID}-mixed`}>
          <Text style={styles.cellAmountMixed} numberOfLines={1} adjustsFontSizeToFit>
            {Math.round(cell.realizedAmount).toLocaleString('fr-FR')}/{Math.round(cell.displayAmount).toLocaleString('fr-FR')} DH
          </Text>
          <Text style={styles.cellRestantMixed} numberOfLines={1} adjustsFontSizeToFit>
            reste {Math.round(cell.pendingAmount).toLocaleString('fr-FR')} DH
          </Text>
        </View>
      ) : (
        <Text style={[styles.cellAmount, isRealized && styles.cellAmountRealized, isPending && styles.cellAmountPending]}>
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
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
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
      <ScrollView ref={scrollRef} style={styles.adjustSheet} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <Text style={styles.confirmTitle}>{target.rowLabel}</Text>
        <Text style={styles.adjustPrevu}>Prévu {formatDh(occ.expectedAmount)}</Text>
        <FormField label="Montant réel" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="planning-adjust-amount" />
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

function CategoryDetailModal({
  target,
  onClose,
  onRealized,
  onViewOperation,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string; month: string } | null;
  onClose: () => void;
  onRealized: () => Promise<void>;
  onViewOperation: (operationId: string) => void;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const [actingId, setActingId] = useState<string | null>(null);
  if (!target) return null;
  const { cell, rowLabel } = target;
  const realizedItems = cell.items.filter((i) => i.type !== 'PLANNED_PENDING');
  const pendingItems = cell.items.filter((i) => i.type === 'PLANNED_PENDING');

  async function markRealized(plannedOperationId: string, expectedAmount: number) {
    if (actingId) return;
    setActingId(plannedOperationId);
    try {
      await api.realizePlannedOperation(plannedOperationId, { actualAmount: String(expectedAmount) });
      await onRealized();
    } finally {
      setActingId(null);
    }
  }

  // §11 : revenir sur un paiement déjà confirmé, atteignable même quand la
  // case regroupe plusieurs opérations (pas seulement le cas singleOccurrence
  // du long-press) — réutilise le même mécanisme validé (unrealize).
  async function unrealize(plannedOperationId: string) {
    if (actingId) return;
    setActingId(plannedOperationId);
    try {
      await api.unrealizePlannedOperation(plannedOperationId);
      await onRealized();
    } finally {
      setActingId(null);
    }
  }

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
          <>
            {realizedItems.length > 0 && (
              <>
                <Text style={styles.detailSectionLabel}>RÉALISÉ</Text>
                {realizedItems.map((item, i) => (
                  <View key={`r-${item.plannedOperationId ?? item.financialOperationId}-${i}`} style={styles.detailRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailLabel}>{item.label}</Text>
                      <Text style={styles.detailMeta}>{formatShortDate(item.date)}</Text>
                    </View>
                    <Text style={[styles.detailAmount, styles.detailAmountRealized]}>{formatDh(item.amount)}</Text>
                    {item.plannedOperationId ? (
                      <TouchableOpacity
                        style={styles.unrealizeButton}
                        onPress={() => unrealize(item.plannedOperationId!)}
                        disabled={actingId === item.plannedOperationId}
                        testID={`planning-detail-unrealize-${item.plannedOperationId}`}
                      >
                        <Text style={styles.unrealizeButtonText}>{actingId === item.plannedOperationId ? '…' : 'Annuler le paiement'}</Text>
                      </TouchableOpacity>
                    ) : item.financialOperationId ? (
                      <TouchableOpacity
                        style={styles.viewOperationButton}
                        onPress={() => onViewOperation(item.financialOperationId!)}
                        testID={`planning-detail-view-${item.financialOperationId}`}
                      >
                        <Text style={styles.viewOperationButtonText}>Voir</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                ))}
              </>
            )}
            {pendingItems.length > 0 && (
              <>
                <Text style={[styles.detailSectionLabel, { marginTop: realizedItems.length > 0 ? spacing.md : 0 }]}>À VENIR</Text>
                {pendingItems.map((item, i) => (
                  <View key={`p-${item.plannedOperationId}-${i}`} style={styles.detailRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.detailLabel}>{item.label}</Text>
                      <Text style={styles.detailMeta}>{formatShortDate(item.date)}</Text>
                    </View>
                    <Text style={[styles.detailAmount, styles.detailAmountPending]}>{formatDh(item.amount)}</Text>
                    {item.plannedOperationId && (
                      <TouchableOpacity
                        style={styles.markRealizedButton}
                        onPress={() => markRealized(item.plannedOperationId!, item.amount)}
                        disabled={actingId === item.plannedOperationId}
                        testID={`planning-detail-mark-realized-${item.plannedOperationId}`}
                      >
                        <Text style={styles.markRealizedButtonText}>{actingId === item.plannedOperationId ? '…' : 'Marquer réalisé'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </>
            )}
          </>
        )}
        <View style={styles.detailTotalRow}>
          <Text style={styles.detailTotalLabel}>Total</Text>
          <Text style={styles.detailTotalAmount}>{formatDh(cell.displayAmount)}</Text>
        </View>
        <View style={styles.detailTotalRow}>
          <Text style={styles.detailSynthLabel}>Réalisé</Text>
          <Text style={[styles.detailSynthAmount, styles.detailAmountRealized]}>{formatDh(cell.realizedAmount)}</Text>
        </View>
        <View style={styles.detailTotalRow}>
          <Text style={styles.detailSynthLabel}>Restant</Text>
          <Text style={[styles.detailSynthAmount, styles.detailAmountPending]}>{formatDh(cell.pendingAmount)}</Text>
        </View>
      </ScrollView>
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
  sectionLabelCell: { justifyContent: 'flex-end', paddingBottom: 4, paddingLeft: spacing.xs, borderLeftWidth: 3 },
  sectionLabelText: { ...typography.caption, fontWeight: '800', letterSpacing: 0.5 },
  rowLabelText: { ...typography.body, fontWeight: '600' },
  emptyRowText: { ...typography.caption, color: colors.textPlaceholder },
  totalLabelCell: { justifyContent: 'center', borderTopWidth: 2, borderTopColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, paddingRight: spacing.sm, paddingLeft: spacing.xs, borderLeftWidth: 3 },
  // Expand/collapse par ligne (§12) : bandeau compact, même teinte que
  // surfaceSecondary pour rester subordonné à la ligne qu'il détaille.
  rowExpandLabelCell: { justifyContent: 'center', paddingRight: spacing.sm, backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowExpandText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  rowExpandMonthsCell: { backgroundColor: colors.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: colors.divider },
  totalLabelText: { ...typography.caption, fontWeight: '800', color: colors.textPrimary },
  monthHeaderCell: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 4 },
  monthHeaderText: { ...typography.caption, fontWeight: '800', color: colors.textSecondary },
  sectionSpacerCell: {},
  cell: { alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, borderLeftWidth: 1, borderLeftColor: colors.divider },
  cellRealized: { backgroundColor: colors.successLight },
  cellPending: { backgroundColor: colors.warningLight },
  // MIXTE : même teinte que "prévu" (jamais confondu avec 100% réalisé, vert) mais un
  // liseré vert à gauche signale la part déjà réalisée dans la case — sobre, sans
  // ajouter de nouvelle couleur au design system (§7, purement visuel).
  cellMixed: { backgroundColor: colors.warningLight, borderLeftWidth: 3, borderLeftColor: colors.success },
  cellEmpty: { color: colors.textPlaceholder },
  cellAmount: { ...typography.body, fontWeight: '700' },
  cellAmountRealized: { color: colors.success },
  cellAmountPending: { color: colors.warning },
  cellMixedWrap: { alignItems: 'center' },
  cellAmountMixed: { ...typography.caption, fontWeight: '800', color: colors.warning, paddingHorizontal: 2 },
  cellRestantMixed: { fontSize: 9, fontWeight: '700', color: colors.danger, paddingHorizontal: 2, marginTop: 1 },
  totalCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderTopWidth: 2, borderTopColor: colors.borderStrong, borderLeftWidth: 1, borderLeftColor: colors.divider },
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
  detailSectionLabel: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.xs },
  detailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: spacing.sm },
  detailLabel: { ...typography.body, fontWeight: '600' },
  detailMeta: { ...typography.caption, marginTop: 2 },
  detailAmount: { ...typography.body, fontWeight: '700' },
  detailAmountRealized: { color: colors.success },
  detailAmountPending: { color: colors.warning },
  markRealizedButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.successLight },
  markRealizedButtonText: { ...typography.caption, fontWeight: '700', color: colors.success },
  unrealizeButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.dangerLight },
  unrealizeButtonText: { ...typography.caption, fontWeight: '700', color: colors.danger },
  viewOperationButton: { paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  viewOperationButtonText: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  detailTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  detailTotalLabel: { ...typography.body, fontWeight: '800', marginTop: spacing.sm },
  detailTotalAmount: { ...typography.body, fontWeight: '800', marginTop: spacing.sm },
  detailSynthLabel: { ...typography.bodySecondary, fontWeight: '600' },
  detailSynthAmount: { ...typography.bodySecondary, fontWeight: '700' },
  plansSection: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  plansSectionTitle: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.sm },
  planCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planLabel: { ...typography.body, fontWeight: '700' },
  planNextDeadline: { ...typography.bodySecondary },
  planViewLink: { ...typography.caption, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
});
