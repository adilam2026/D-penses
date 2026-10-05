import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthShort, formatShortDate } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { FormField } from '../ui/FormField';
import { Select } from '../ui/Select';
import { DateField } from '../ui/DateField';
import { ChoiceSheet } from '../ui/ChoiceSheet';
import { Toast } from '../ui/Toast';
import { useBottomInset } from '../ui/useBottomInset';
import { testIdSlug } from '../ui/testIdSlug';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';
import { accountSelectOptions, decodeAccountOption, encodeAccountOption } from '../ui/accountOptions';
import { RECURRENCE_FREQUENCY_OPTIONS, RecurrenceOption } from '../ui/recurrenceLabels';

const HORIZON_OPTIONS = [3, 6, 9, 12] as const;
// Fenêtre multi-mois compacte (correctif Planning) — 3 colonnes visibles à la
// fois sur mobile, balayables horizontalement (swipe ou flèches ‹ ›) sur tout
// l'horizon sélectionné. Jamais plus de 3 colonnes en largeur disponible,
// jamais un seul mois à la fois (le moteur/les données restent inchangés).
const VISIBLE_COLUMNS = 3;
const FALLBACK_COLUMN_WIDTH = 90;
const LABEL_WIDTH = 108;
const ROW_HEIGHT = 46;
// Lot "couverture des dépenses restantes" — la ligne "DÉPENSES payé/prévu"
// gagne une 3e ligne compacte ("À provisionner"/"✓ Tout est couvert"),
// UNIQUEMENT visible dans la colonne du mois courant (les mois futurs
// gardent 2 lignes, faute de couverture fiable) : légèrement plus haute que
// ROW_HEIGHT pour l'accueillir sans écraser le texte existant.
const SYNTHESE_DEPENSES_ROW_HEIGHT = 60;
const SECTION_HEIGHT = 30;
const HEADER_HEIGHT = 40;
const CATEGORY_HEADER_HEIGHT = 24;
const TOAST_DURATION_MS = 1800;

interface BlockDef {
  title: string;
  rows: api.PlanningRowApi[];
  totalLabel: string;
  totalKey: 'totalRevenus' | 'totalDepenses' | 'totalEpargne';
  emptyText: string;
  /** Teinte de section (§7, lisibilité visuelle uniquement — aucune logique) : distingue REVENUS/DÉPENSES/ÉPARGNE d'un coup d'œil. */
  accentColor: string;
  /** Titre affiché pour les lignes sans catégorie QUAND le bloc contient aussi des lignes catégorisées (Lot ciblé §5). */
  uncategorizedLabel: string;
}

type BlockItem = { kind: 'header'; label: string } | { kind: 'row'; row: api.PlanningRowApi };

/**
 * Regroupe les lignes d'un bloc par catégorie (correction ciblée §4) — la
 * catégorie est un PUR TITRE VISUEL inséré entre les lignes, jamais une ligne
 * portant un montant. Le titre s'affiche TOUJOURS dès qu'une catégorie est
 * présente (même pour un seul libellé dessous — ex. "LOGEMENT" au-dessus du
 * seul "Loyer") : la catégorie reste le repère de l'utilisateur, jamais
 * masquée pour "redondance". Si AUCUNE ligne du bloc n'a de catégorie, aucun
 * titre n'est inséré (comportement plat inchangé). Les lignes arrivent déjà
 * groupées par catégorie (tri backend) : un seul passage suffit.
 */
function buildBlockItems(rows: api.PlanningRowApi[], uncategorizedLabel: string): BlockItem[] {
  if (!rows.some((r) => r.categoryLabel)) return rows.map((row) => ({ kind: 'row', row }));
  const items: BlockItem[] = [];
  let i = 0;
  while (i < rows.length) {
    const header = rows[i].categoryLabel;
    let j = i + 1;
    while (j < rows.length && rows[j].categoryLabel === header) j++;
    const group = rows.slice(i, j);
    items.push({ kind: 'header', label: header ?? uncategorizedLabel });
    for (const row of group) items.push({ kind: 'row', row });
    i = j;
  }
  return items;
}

function relevantAccount(item: { sourceAccountId: string | null; sourceSubaccountId: string | null; destinationAccountId: string | null; destinationSubaccountId: string | null }) {
  if (item.sourceAccountId) return { accountId: item.sourceAccountId, subaccountId: item.sourceSubaccountId, preposition: 'depuis' as const };
  return { accountId: item.destinationAccountId, subaccountId: item.destinationSubaccountId, preposition: 'vers' as const };
}

/**
 * Reconstruit une occurrence "Payer / Ajuster" directement depuis un item À
 * VENIR d'une case AMBIGUË (CategoryDetailModal, plusieurs échéances dans la
 * même case — singleOccurrence n'y est jamais renseigné). `item.amount`
 * porte déjà le RESTE à payer (jamais le prévu complet), et
 * `item.expectedAmount` le prévu d'origine — cf. planning.util.ts.
 */
function occurrenceFromItem(item: api.PlanningCellItemApi): api.PlanningSingleOccurrenceApi | null {
  if (item.type !== 'PLANNED_PENDING' || !item.plannedOperationId || item.expectedAmount === undefined) return null;
  const paid = item.expectedAmount - item.amount;
  return {
    plannedOperationId: item.plannedOperationId,
    status: 'PENDING',
    expectedAmount: item.expectedAmount,
    realizedAmount: paid > 0 ? paid : null,
    sourceAccountId: item.sourceAccountId,
    sourceSubaccountId: item.sourceSubaccountId,
    destinationAccountId: item.destinationAccountId,
    destinationSubaccountId: item.destinationSubaccountId,
    recurrenceRuleId: item.recurrenceRuleId ?? null,
    categoryId: item.categoryId ?? null,
    kind: item.kind!,
  };
}

/**
 * Planning multi-mois (Checkpoint 3, correctif fenêtre compacte) — 4 blocs
 * (Revenus/Dépenses/Épargne/Synthèse), horizon 3-12 mois, colonne de
 * libellés figée + 3 colonnes de mois visibles simultanément, balayables
 * horizontalement (swipe à snap ou flèches ‹ ›) sur tout l'horizon chargé.
 * Tap = réaliser, appui long = ajuster ou annuler, détail catégorie sur case
 * agrégée.
 */
export function PlanningScreen() {
  const navigation = useNavigation<any>();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<api.PlanningTableApi | null>(null);
  const [accounts, setAccounts] = useState<api.AccountApi[]>([]);
  const [categories, setCategories] = useState<api.CategoryApi[]>([]);
  const [plans, setPlans] = useState<api.FinancialPlanApi[]>([]);
  const [loading, setLoading] = useState(true);

  // Lot "paiements partiels successifs" : AdjustModal est découplé de la case
  // (une échéance partiellement payée peut être atteinte depuis une case dont
  // singleOccurrence est renseigné, OU reconstruite depuis un item précis
  // d'une case ambiguë via occurrenceFromItem — cf. CategoryDetailModal).
  const [adjustTarget, setAdjustTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string; month: string } | null>(null);
  const [realizedMenuTarget, setRealizedMenuTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  const [payPopupTarget, setPayPopupTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  // Menu "Modifier l'échéance" / "Annuler l'échéance" (lot Planning — édition
  // des échéances) — ouvert par l'appui long sur une case PENDING, en plus de
  // "Payer / Ajuster" qui conserve le comportement existant (AdjustModal).
  const [pendingMenuTarget, setPendingMenuTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string } | null>(null);
  // Choix "cette échéance uniquement / et les suivantes" — affiché uniquement
  // quand l'occurrence provient d'une récurrence (recurrenceRuleId non null).
  const [scopeChoiceTarget, setScopeChoiceTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string; intent: 'edit' | 'cancel' } | null>(null);
  const [editTarget, setEditTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string; scope: 'single' | 'series' } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fenêtre de 3 mois glissante sur l'horizon chargé (data.months) : windowStart
  // = index du premier mois visible, déplacé par pas de 1 (swipe à snap ou
  // flèches), jamais par pas de 3 — cf. l'exemple Oct|Nov|Déc → Nov|Déc|Jan.
  const [windowStart, setWindowStart] = useState(0);
  const [areaWidth, setAreaWidth] = useState(0);
  const monthScrollRef = useRef<ScrollView>(null);
  const columnWidth = areaWidth > 0 ? areaWidth / VISIBLE_COLUMNS : FALLBACK_COLUMN_WIDTH;

  const load = useCallback(async (h: number) => {
    const [planning, accountList, categoryList, planList] = await Promise.all([
      api.getPlanning(h),
      api.listAccounts(),
      api.listCategories(),
      api.listFinancialPlans(),
    ]);
    setData(planning);
    setAccounts(accountList);
    setCategories(categoryList);
    setPlans(planList);
    return planning;
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load(months).finally(() => setLoading(false));
    }, [load, months]),
  );

  // Revenir au début de la fenêtre uniquement quand l'horizon change (jamais
  // après un simple refresh de données, pour ne pas sauter la fenêtre affichée).
  React.useEffect(() => {
    setWindowStart(0);
    monthScrollRef.current?.scrollTo({ x: 0, animated: false });
  }, [months]);

  function goToWindow(idx: number) {
    if (!data) return;
    const maxStart = Math.max(0, data.months.length - VISIBLE_COLUMNS);
    const clamped = Math.max(0, Math.min(maxStart, idx));
    setWindowStart(clamped);
    monthScrollRef.current?.scrollTo({ x: clamped * columnWidth, animated: true });
  }

  async function refresh() {
    return load(months);
  }

  /**
   * Retrouve, dans une table Planning fraîchement chargée, l'occurrence
   * singleOccurrence d'une échéance précise — utilisé après un unrealize()
   * pour rouvrir AdjustModal avec le "déjà payé" RÉEL (d'éventuels paiements
   * partiels antérieurs à l'opération annulée restent comptés), jamais une
   * valeur figée capturée avant le refresh.
   */
  function findOccurrenceById(planning: api.PlanningTableApi, plannedOperationId: string): api.PlanningSingleOccurrenceApi | null {
    for (const block of [planning.depenses, planning.revenus, planning.epargne]) {
      for (const row of block) {
        for (const m of planning.months) {
          const occ = row.cells[m]?.singleOccurrence;
          if (occ?.plannedOperationId === plannedOperationId) return occ;
        }
      }
    }
    return null;
  }

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  /**
   * "Modifier l'échéance" (lot Planning) : si l'occurrence provient d'une
   * récurrence, demande d'abord "cette échéance uniquement / et les
   * suivantes" (ChoiceSheet) ; sinon (ponctuelle) ouvre directement le
   * formulaire d'édition, portée 'single' implicite.
   */
  function openEditFlow(cell: api.PlanningCellApi, rowLabel: string) {
    const occ = cell.singleOccurrence;
    if (!occ) return;
    if (occ.recurrenceRuleId) {
      setScopeChoiceTarget({ cell, rowLabel, intent: 'edit' });
    } else {
      setEditTarget({ cell, rowLabel, scope: 'single' });
    }
  }

  /** "Annuler l'échéance" — même logique de choix de portée que l'édition. */
  function openCancelFlow(cell: api.PlanningCellApi, rowLabel: string) {
    const occ = cell.singleOccurrence;
    if (!occ) return;
    if (occ.recurrenceRuleId) {
      setScopeChoiceTarget({ cell, rowLabel, intent: 'cancel' });
    } else {
      confirmCancelSingle(cell, rowLabel);
    }
  }

  /**
   * Annulation simple (déjà existante) — fonctionne pour TOUTE occurrence,
   * récurrente ou non : annule exclusivement CETTE ligne (status=CANCELLED),
   * jamais la règle ni les autres occurrences.
   */
  function confirmCancelSingle(cell: api.PlanningCellApi, rowLabel: string) {
    const occ = cell.singleOccurrence;
    if (!occ) return;
    Alert.alert(`Annuler « ${rowLabel} » ?`, "Cette échéance prévue sera retirée — elle n'a pas encore eu lieu.", [
      { text: 'Fermer', style: 'cancel' },
      {
        text: "Confirmer l'annulation",
        style: 'destructive',
        onPress: async () => {
          await api.cancelPlannedOperation(occ.plannedOperationId);
          showToast('Échéance annulée');
          await refresh();
        },
      },
    ]);
  }

  /**
   * Arrêter la série à partir de cette occurrence (§8) — annule le pivot et
   * toutes les occurrences encore PENDING à partir de sa date, et désactive
   * la règle (plus aucune occurrence future générée). Les occurrences déjà
   * réalisées avant le pivot restent intactes dans l'historique.
   */
  function confirmCancelSeries(cell: api.PlanningCellApi, rowLabel: string) {
    const occ = cell.singleOccurrence;
    const fromDate = cell.items[0]?.date;
    if (!occ || !occ.recurrenceRuleId || !fromDate) return;
    Alert.alert(
      `Arrêter la série « ${rowLabel} » ?`,
      "Cette échéance et toutes les suivantes seront annulées. Les occurrences déjà réalisées restent dans l'historique.",
      [
        { text: 'Fermer', style: 'cancel' },
        {
          text: 'Arrêter la série',
          style: 'destructive',
          onPress: async () => {
            await api.updateRecurrenceRule(occ.recurrenceRuleId!, { applyFrom: 'THIS_AND_FOLLOWING', fromDate: fromDate.slice(0, 10), active: false });
            showToast('Série arrêtée à partir de cette échéance');
            await refresh();
          },
        },
      ],
    );
  }

  /**
   * Tap simple (Lot ciblé §4, retour au mini pop-up) : sur une occurrence
   * unique, ouvre un petit pop-up de confirmation ([Marquer comme payé] ou
   * [Annuler le paiement] + [Fermer]) — le paiement n'est effectué qu'après
   * confirmation explicite. Sur une case agrégée (plusieurs opérations),
   * ouvre toujours le détail — impossible de savoir laquelle basculer sans
   * ambiguïté.
   */
  function onCellPress(cell: api.PlanningCellApi, rowLabel: string) {
    if (cell.status === 'EMPTY') return;
    if (!cell.singleOccurrence) {
      setDetailTarget({ cell, rowLabel, month: '' });
      return;
    }
    setPayPopupTarget({ cell, rowLabel });
  }

  /**
   * Appui long (§1, puis lot "modifier une échéance") : ouvre le détail/
   * modifier — jamais le toggle direct. Sur une case PENDING, ouvre
   * désormais un petit menu (Payer/Ajuster, Modifier l'échéance, Annuler
   * l'échéance) plutôt que de sauter directement dans l'ajustement — "Payer /
   * Ajuster" y mène au même AdjustModal qu'avant, comportement inchangé.
   */
  function onCellLongPress(cell: api.PlanningCellApi, rowLabel: string) {
    if (cell.status === 'EMPTY') return;
    if (cell.singleOccurrence?.status === 'PENDING') {
      setPendingMenuTarget({ cell, rowLabel });
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
    { title: 'REVENUS', rows: data.revenus, totalLabel: 'TOTAL REVENUS', totalKey: 'totalRevenus', emptyText: 'Aucun revenu prévu.', accentColor: colors.success, uncategorizedLabel: 'AUTRES REVENUS SANS CATÉGORIE' },
    { title: 'DÉPENSES', rows: data.depenses, totalLabel: 'TOTAL DÉPENSES', totalKey: 'totalDepenses', emptyText: 'Aucune dépense prévue.', accentColor: colors.danger, uncategorizedLabel: 'AUTRES DÉPENSES SANS CATÉGORIE' },
    { title: 'ÉPARGNE / VERSEMENTS', rows: data.epargne, totalLabel: 'TOTAL VERSEMENTS', totalKey: 'totalEpargne', emptyText: 'Aucun versement prévu.', accentColor: colors.secondary, uncategorizedLabel: 'AUTRES VERSEMENTS SANS CATÉGORIE' },
  ];
  const blockItemsByTitle = new Map(blocks.map((b) => [b.title, buildBlockItems(b.rows, b.uncategorizedLabel)]));
  const maxWindowStart = Math.max(0, data.months.length - VISIBLE_COLUMNS);

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
            <View style={[styles.labelCell, styles.headerLabelCell, { height: HEADER_HEIGHT }]}>
              <TouchableOpacity
                onPress={() => goToWindow(windowStart - 1)}
                disabled={windowStart === 0}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                testID="planning-month-prev"
              >
                <Ionicons name="chevron-back" size={16} color={windowStart === 0 ? colors.textPlaceholder : colors.textPrimary} />
              </TouchableOpacity>
            </View>
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
                  (blockItemsByTitle.get(block.title) ?? []).map((item, idx) =>
                    item.kind === 'header' ? (
                      // Titre de regroupement catégorie (Lot ciblé §5) — PUR AFFICHAGE :
                      // jamais de montant, jamais tappable, jamais de chevron.
                      <View key={`h-${idx}`} style={[styles.categoryHeaderCell, { height: CATEGORY_HEADER_HEIGHT }]}>
                        <Text style={styles.categoryHeaderText} numberOfLines={1}>
                          {item.label}
                        </Text>
                      </View>
                    ) : (
                      <View key={item.row.key} style={[styles.labelCell, { height: ROW_HEIGHT }]}>
                        <Text style={styles.rowLabelText} numberOfLines={2}>
                          {item.row.label}
                        </Text>
                      </View>
                    ),
                  )
                )}
                <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: block.accentColor }]}>
                  <Text style={styles.totalLabelText}>{block.totalLabel}</Text>
                </View>
              </React.Fragment>
            ))}
            {/* Lot "synthèse enrichie" (Part 2 A/D) : 2 lignes compactes
                supplémentaires ("où en suis-je"), jamais 5 nouvelles grandes
                lignes — adapte uniquement ce bloc de totaux existant, le
                Planning lui-même n'est pas reconstruit. */}
            <View style={[styles.totalLabelCell, { height: SYNTHESE_DEPENSES_ROW_HEIGHT, borderLeftColor: colors.danger }]}>
              <Text style={styles.totalLabelText} numberOfLines={2}>
                DÉPENSES payé/prévu
              </Text>
            </View>
            <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: colors.secondary }]}>
              <Text style={styles.totalLabelText} numberOfLines={2}>
                ÉPARGNE versé/prévu
              </Text>
            </View>
            <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, backgroundColor: colors.surfaceActive }]}>
              <Text style={styles.totalLabelText}>BALANCE MENSUELLE</Text>
            </View>
            <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, backgroundColor: colors.surfaceActive }]}>
              <Text style={styles.totalLabelText}>BALANCE CUMULÉE</Text>
            </View>
          </View>

          <View style={{ flex: 1, position: 'relative' }} onLayout={(e) => setAreaWidth(e.nativeEvent.layout.width)}>
            <TouchableOpacity
              style={styles.monthNextButton}
              onPress={() => goToWindow(windowStart + 1)}
              disabled={windowStart >= maxWindowStart}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              testID="planning-month-next"
            >
              <Ionicons name="chevron-forward" size={16} color={windowStart >= maxWindowStart ? colors.textPlaceholder : colors.textPrimary} />
            </TouchableOpacity>
            <ScrollView
              ref={monthScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={columnWidth}
              decelerationRate="fast"
              disableIntervalMomentum
              onMomentumScrollEnd={(e) => {
                if (!columnWidth) return;
                const idx = Math.round(e.nativeEvent.contentOffset.x / columnWidth);
                setWindowStart(Math.max(0, Math.min(maxWindowStart, idx)));
              }}
            >
              <View>
                <View style={{ flexDirection: 'row', height: HEADER_HEIGHT }}>
                  {data.months.map((m) => (
                    <View key={m} style={[styles.monthHeaderCell, { width: columnWidth }]}>
                      <Text style={styles.monthHeaderText} numberOfLines={1}>
                        {formatMonthShort(m)}
                      </Text>
                    </View>
                  ))}
                </View>

                {blocks.map((block) => (
                  <React.Fragment key={block.title}>
                    <View style={{ flexDirection: 'row', height: SECTION_HEIGHT }}>
                      {data.months.map((m) => (
                        <View key={m} style={[styles.sectionSpacerCell, { width: columnWidth }]} />
                      ))}
                    </View>
                    {block.rows.length === 0
                      ? [
                          <View key="empty" style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                            {data.months.map((m) => (
                              <View key={m} style={[styles.cell, { width: columnWidth }]} />
                            ))}
                          </View>,
                        ]
                      : (blockItemsByTitle.get(block.title) ?? []).map((item, idx) =>
                          item.kind === 'header' ? (
                            <View key={`h-${idx}`} style={{ flexDirection: 'row', height: CATEGORY_HEADER_HEIGHT }}>
                              {data.months.map((m) => (
                                <View key={m} style={[styles.categoryHeaderSpacerCell, { width: columnWidth }]} />
                              ))}
                            </View>
                          ) : (
                            <View key={item.row.key} style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                              {data.months.map((m) => (
                                <PlanningCellView
                                  key={m}
                                  cell={item.row.cells[m]}
                                  width={columnWidth}
                                  onPress={() => onCellPress(item.row.cells[m], item.row.label)}
                                  onLongPress={() => onCellLongPress(item.row.cells[m], item.row.label)}
                                  testID={`planning-cell-${testIdSlug(item.row.label)}-${m}`}
                                />
                              ))}
                            </View>
                          ),
                        )}
                    <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                      {data.months.map((m) => (
                        <View key={m} style={[styles.totalCell, { width: columnWidth }]}>
                          <Text style={styles.totalCellText} numberOfLines={1} adjustsFontSizeToFit>
                            {formatDh(data.synthese[m][block.totalKey])}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </React.Fragment>
                ))}

                {/* DÉPENSES payé/prévu + reste — axe "où en suis-je", distinct
                    de TOTAL DÉPENSES ci-dessus (cf. backend planning.util.ts).
                    3e ligne (couverture) UNIQUEMENT pour le mois courant
                    (depensesAProvisionner non-null) — jamais pour les mois
                    futurs, faute de projection de solde fiable (§8). */}
                <View style={{ flexDirection: 'row', height: SYNTHESE_DEPENSES_ROW_HEIGHT }}>
                  {data.months.map((m) => {
                    const s = data.synthese[m];
                    return (
                      <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-synthese-depenses-${m}`}>
                        <Text style={styles.syntheseDetailAmount} numberOfLines={1} adjustsFontSizeToFit>
                          {Math.round(s.depensesPayees).toLocaleString('fr-FR')}/{Math.round(s.depensesPrevues).toLocaleString('fr-FR')} DH
                        </Text>
                        <Text style={styles.syntheseDetailReste} numberOfLines={1} adjustsFontSizeToFit>
                          reste {Math.round(s.depensesReste).toLocaleString('fr-FR')} DH
                        </Text>
                        {s.depensesAProvisionner !== null &&
                          (s.depensesAProvisionner > 0 ? (
                            <Text style={styles.syntheseCouvertureWarn} numberOfLines={1} adjustsFontSizeToFit>
                              À provisionner {Math.round(s.depensesAProvisionner).toLocaleString('fr-FR')} DH
                            </Text>
                          ) : (
                            <Text style={styles.syntheseCouvertureOk} numberOfLines={1} adjustsFontSizeToFit>
                              ✓ Tout est couvert
                            </Text>
                          ))}
                      </View>
                    );
                  })}
                </View>
                {/* ÉPARGNE/VERSEMENTS versé/prévu + reste — jamais mélangé aux dépenses ci-dessus. */}
                <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                  {data.months.map((m) => {
                    const s = data.synthese[m];
                    return (
                      <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-synthese-epargne-${m}`}>
                        <Text style={styles.syntheseDetailAmount} numberOfLines={1} adjustsFontSizeToFit>
                          {Math.round(s.epargneVersee).toLocaleString('fr-FR')}/{Math.round(s.epargnePrevue).toLocaleString('fr-FR')} DH
                        </Text>
                        <Text style={styles.syntheseDetailReste} numberOfLines={1} adjustsFontSizeToFit>
                          reste {Math.round(s.epargneReste).toLocaleString('fr-FR')} DH
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                  {data.months.map((m) => (
                    <View key={m} style={[styles.totalCell, styles.syntheseCell, { width: columnWidth }]}>
                      <Text style={[styles.totalCellText, data.synthese[m].balanceMensuelle < 0 && styles.negativeText]} numberOfLines={1} adjustsFontSizeToFit>
                        {formatDh(data.synthese[m].balanceMensuelle)}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                  {data.months.map((m) => (
                    <View key={m} style={[styles.totalCell, styles.syntheseCell, { width: columnWidth }]}>
                      <Text style={[styles.totalCellText, data.synthese[m].balanceCumulee < 0 && styles.negativeText]} numberOfLines={1} adjustsFontSizeToFit>
                        {formatDh(data.synthese[m].balanceCumulee)}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>

        <PlansSection plans={plans} onOpen={(id) => navigation.navigate('FinancialPlanDetail', { id })} />
      </ScrollView>

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
        onPayAdjust={(occurrence, rowLabel) => {
          setDetailTarget(null);
          setAdjustTarget({ occurrence, rowLabel });
        }}
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
              const rowLabel = realizedMenuTarget?.rowLabel;
              if (!occ || !rowLabel) return;
              await api.unrealizePlannedOperation(occ.plannedOperationId);
              // Rouvre avec l'état FRAIS (jamais la case périmée d'avant le
              // unrealize) : d'éventuels paiements partiels antérieurs à ce
              // paiement restent comptés dans "déjà payé".
              const planning = await refresh();
              const freshOcc = findOccurrenceById(planning, occ.plannedOperationId);
              if (freshOcc) setAdjustTarget({ occurrence: freshOcc, rowLabel });
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

      {/* Case PENDING, appui long (lot "modifier une échéance") : Payer/Ajuster
          mène à l'AdjustModal existant (inchangé), Modifier/Annuler ouvrent les
          nouveaux parcours ci-dessous. */}
      <ChoiceSheet
        visible={!!pendingMenuTarget}
        title={pendingMenuTarget?.rowLabel ?? ''}
        onClose={() => setPendingMenuTarget(null)}
        testID="planning-pending-menu"
        options={[
          {
            key: 'pay',
            label: 'Payer / Ajuster',
            icon: 'card-outline',
            onPress: () => {
              const occ = pendingMenuTarget!.cell.singleOccurrence;
              if (occ) setAdjustTarget({ occurrence: occ, rowLabel: pendingMenuTarget!.rowLabel });
            },
          },
          {
            key: 'edit',
            label: "Modifier l'échéance",
            icon: 'create-outline',
            onPress: () => openEditFlow(pendingMenuTarget!.cell, pendingMenuTarget!.rowLabel),
          },
          {
            key: 'cancel',
            label: "Annuler l'échéance",
            icon: 'close-circle-outline',
            onPress: () => openCancelFlow(pendingMenuTarget!.cell, pendingMenuTarget!.rowLabel),
          },
        ]}
      />

      {/* "Que souhaitez-vous modifier ?" (§5) — uniquement pour une occurrence
          issue d'une récurrence ; une échéance ponctuelle ne passe jamais ici. */}
      <ChoiceSheet
        visible={!!scopeChoiceTarget}
        title="Que souhaitez-vous modifier ?"
        onClose={() => setScopeChoiceTarget(null)}
        testID="planning-scope-choice"
        options={[
          {
            key: 'single',
            label: 'Cette échéance uniquement',
            onPress: () => {
              if (!scopeChoiceTarget) return;
              if (scopeChoiceTarget.intent === 'edit') setEditTarget({ cell: scopeChoiceTarget.cell, rowLabel: scopeChoiceTarget.rowLabel, scope: 'single' });
              else confirmCancelSingle(scopeChoiceTarget.cell, scopeChoiceTarget.rowLabel);
            },
          },
          {
            key: 'series',
            label: 'Cette échéance et les suivantes',
            onPress: () => {
              if (!scopeChoiceTarget) return;
              if (scopeChoiceTarget.intent === 'edit') setEditTarget({ cell: scopeChoiceTarget.cell, rowLabel: scopeChoiceTarget.rowLabel, scope: 'series' });
              else confirmCancelSeries(scopeChoiceTarget.cell, scopeChoiceTarget.rowLabel);
            },
          },
        ]}
      />

      <EditOccurrenceModal
        target={editTarget}
        accounts={accounts}
        categories={categories}
        onClose={() => setEditTarget(null)}
        onDone={async (message) => {
          setEditTarget(null);
          showToast(message);
          await refresh();
        }}
      />

      <PayPopupModal
        target={payPopupTarget}
        onClose={() => setPayPopupTarget(null)}
        onConfirmed={async (message) => {
          setPayPopupTarget(null);
          showToast(message);
          await refresh();
        }}
      />

      <Toast message={toast} />
    </View>
  );
}

/**
 * Mini pop-up de confirmation (Lot ciblé §4) — sur une occurrence unique :
 * [Marquer comme payé] si PENDING, [Annuler le paiement] si REALIZED, + un
 * [Fermer] toujours disponible. Le paiement/l'annulation n'a lieu qu'après ce
 * clic explicite ; le toast existant confirme ensuite l'action.
 */
function PayPopupModal({
  target,
  onClose,
  onConfirmed,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string } | null;
  onClose: () => void;
  onConfirmed: (message: string) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  if (!target || !target.cell.singleOccurrence) return null;
  const occ = target.cell.singleOccurrence;
  const isPending = occ.status === 'PENDING';
  const dejaPayeAvant = occ.realizedAmount ?? 0;
  // Lot "paiements partiels successifs" : le tap simple règle le RESTE à
  // payer, jamais le prévu complet — sinon une échéance déjà partiellement
  // payée serait réglée en double (ex. 800 prévu, 300 déjà payé -> ce popup
  // ne doit solder QUE les 500 restants, jamais les 800 à nouveau).
  const remaining = occ.expectedAmount - dejaPayeAvant;

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      if (isPending) {
        await api.realizePlannedOperation(occ.plannedOperationId, { actualAmount: String(remaining) });
        await onConfirmed('Transaction marquée comme payée');
      } else {
        await api.unrealizePlannedOperation(occ.plannedOperationId);
        await onConfirmed('Transaction remise à venir');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} testID="planning-pay-popup">
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <View style={styles.confirmBox}>
        <Text style={styles.confirmTitle}>{target.rowLabel}</Text>
        <Text style={styles.confirmText}>
          {isPending
            ? dejaPayeAvant > 0
              ? `Déjà payé ${formatDh(dejaPayeAvant)} — reste à payer ${formatDh(remaining)}`
              : `Prévu ${formatDh(occ.expectedAmount)}`
            : `Réglé ${formatDh(occ.realizedAmount ?? occ.expectedAmount)}`}
        </Text>
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="planning-popup-close">
            <Text style={styles.confirmCancelText}>Fermer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmPay} onPress={confirm} testID="planning-popup-confirm">
            <Text style={styles.confirmPayText}>{saving ? '…' : isPending ? 'Marquer comme payé' : 'Annuler le paiement'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function PlanningCellView({
  cell,
  width,
  onPress,
  onLongPress,
  testID,
}: {
  cell: api.PlanningCellApi;
  width: number;
  onPress: () => void;
  onLongPress: () => void;
  testID: string;
}) {
  const isRealized = cell.status === 'REALIZED';
  const isPending = cell.status === 'PENDING';
  const isMixed = cell.status === 'MIXED';
  return (
    <TouchableOpacity
      style={[styles.cell, { width }, isRealized && styles.cellRealized, isPending && styles.cellPending, isMixed && styles.cellMixed]}
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
        <View style={[styles.cellChip, isRealized && styles.cellChipRealized, isPending && styles.cellChipPending]}>
          <Text style={[styles.cellAmount, isRealized && styles.cellAmountRealized, isPending && styles.cellAmountPending]} numberOfLines={1} adjustsFontSizeToFit>
            {formatDh(cell.displayAmount)}
            {isRealized ? ' ✓' : ''}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function AdjustModal({
  target,
  accounts,
  onClose,
  onDone,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occ = target?.occurrence ?? null;
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [partialAmount, setPartialAmount] = useState('');
  // Source RÉELLE de CE paiement (lot "choisir la source au moment du
  // paiement") — présélectionnée sur la source PRÉVUE de l'échéance, mais
  // librement modifiable ; n'est JAMAIS écrite sur l'échéance elle-même.
  const [accountOption, setAccountOption] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lot "paiements partiels successifs" : le "reste à payer" (jamais le
  // prévu complet) pilote le pré-remplissage ET la validation — une échéance
  // partiellement payée ne doit jamais pouvoir être réglée en double.
  const dejaPaye = occ?.realizedAmount ?? 0;
  const remaining = occ ? occ.expectedAmount - dejaPaye : 0;

  React.useEffect(() => {
    if (occ) {
      setAmount(String(remaining));
      setDate(new Date().toISOString().slice(0, 10));
      setPartialAmount('');
      setError(null);
      const { accountId, subaccountId } = relevantAccount(occ);
      setAccountOption(encodeAccountOption(accountId, subaccountId));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ?.plannedOperationId, occ?.realizedAmount]);

  if (!target || !occ) return null;
  const { preposition } = relevantAccount(occ);
  const sourceSelectOptions = accountSelectOptions(accounts, true);
  const accountFieldLabel = preposition === 'depuis' ? 'Compte / enveloppe à débiter' : 'Compte / enveloppe à créditer';
  const partialValue = Number(partialAmount);
  const canSubmitPartial = partialAmount.trim() !== '' && partialValue > 0 && partialValue < remaining;

  /**
   * Traduit le Select en override pour realize/partialRealize — jamais une
   * fusion avec la source prévue : si l'utilisateur a choisi une valeur,
   * c'est la paire COMPLÈTE (compte + sous-compte éventuel) qui est envoyée.
   */
  function paymentSourceOverride(): Partial<api.RealizePlannedOperationData> {
    if (!occ || !accountOption) return {};
    const decoded = decodeAccountOption(accountOption, accounts);
    return preposition === 'depuis'
      ? { sourceAccountId: decoded.accountId, sourceSubaccountId: decoded.subaccountId }
      : { destinationAccountId: decoded.accountId, destinationSubaccountId: decoded.subaccountId };
  }

  async function submit() {
    if (!amount.trim() || saving || !occ) return;
    setSaving(true);
    setError(null);
    try {
      await api.realizePlannedOperation(occ.plannedOperationId, { actualAmount: amount, actualDate: date || undefined, ...paymentSourceOverride() });
      await onDone();
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement du paiement");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Paiement partiel (§correction) : enregistre le montant réellement payé
   * sans clore l'échéance — le reste continue d'apparaître comme à venir
   * (même case, affichage "payé/total" + "reste X" déjà géré par la case
   * MIXTE existante, aucune UI dédiée nécessaire côté affichage).
   */
  async function submitPartial() {
    if (!canSubmitPartial || saving || !occ) return;
    setSaving(true);
    setError(null);
    try {
      await api.partialRealizePlannedOperation(occ.plannedOperationId, { actualAmount: partialAmount, actualDate: date || undefined, ...paymentSourceOverride() });
      await onDone();
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement du paiement partiel");
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
        {dejaPaye > 0 && (
          <>
            <Text style={styles.adjustPrevu} testID="planning-adjust-deja-paye">
              Déjà payé {formatDh(dejaPaye)}
            </Text>
            <Text style={styles.adjustPrevu} testID="planning-adjust-reste">
              Reste à payer {formatDh(remaining)}
            </Text>
          </>
        )}
        <FormField label="Montant réel" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="planning-adjust-amount" />
        <DateField label="Date" value={date} onChange={setDate} />
        <Select
          label={accountFieldLabel}
          value={accountOption}
          options={sourceSelectOptions}
          onChange={setAccountOption}
          testID="planning-adjust-source"
        />
        {error ? <Text style={styles.errorText} testID="planning-adjust-error">{error}</Text> : null}
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="planning-adjust-cancel">
            <Text style={styles.confirmCancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.confirmPay} onPress={submit} testID="planning-adjust-submit">
            <Text style={styles.confirmPayText}>{saving ? '…' : `Payer ${amount ? formatDh(Number(amount)) : ''}`}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.partialSectionLabel}>PAIEMENT PARTIEL</Text>
        <Text style={styles.adjustPrevu}>Enregistre un paiement sans clore l'échéance — le reste continue d'apparaître comme à venir.</Text>
        <FormField
          label="Montant payé maintenant"
          value={partialAmount}
          onChangeText={setPartialAmount}
          onFocus={handleFocus}
          keyboardType="decimal-pad"
          testID="planning-adjust-partial-amount"
        />
        <TouchableOpacity
          style={[styles.partialButton, !canSubmitPartial && styles.buttonDisabled]}
          onPress={submitPartial}
          disabled={!canSubmitPartial || saving}
          testID="planning-adjust-partial-submit"
        >
          <Text style={styles.partialButtonText}>{saving ? '…' : 'Enregistrer le paiement partiel'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

/**
 * "Modifier l'échéance" (lot Planning — distinct de "Réaliser/Payer") :
 * modifie ce qui était PRÉVU, jamais un paiement. scope='single' modifie
 * uniquement l'occurrence visée (PATCH /planned-operations/:id, jamais la
 * règle) ; scope='series' modifie le gabarit de la règle ET les occurrences
 * encore PENDING à partir de cette occurrence (PATCH /recurrence-rules/:id,
 * applyFrom=THIS_AND_FOLLOWING) — jamais l'historique avant elle, jamais les
 * occurrences déjà réalisées/annulées.
 */
function EditOccurrenceModal({
  target,
  accounts,
  categories,
  onClose,
  onDone,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string; scope: 'single' | 'series' } | null;
  accounts: api.AccountApi[];
  categories: api.CategoryApi[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occ = target?.cell.singleOccurrence ?? null;
  const originalDate = target?.cell.items[0]?.date.slice(0, 10) ?? '';

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountOption, setAccountOption] = useState<string | null>(null);
  // Périodicité (scope='series' uniquement) — préremplie depuis la règle
  // existante dès l'ouverture, pour ne jamais la changer silencieusement si
  // l'utilisateur ne modifie que le montant/libellé/source.
  const [frequency, setFrequency] = useState<RecurrenceOption | null>(null);
  const [originalFrequency, setOriginalFrequency] = useState<RecurrenceOption | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!occ || !target) return;
    setLabel(target.rowLabel);
    setAmount(String(occ.expectedAmount));
    setDate(originalDate);
    setCategoryId(occ.categoryId);
    const { accountId, subaccountId } = relevantAccount(occ);
    setAccountOption(encodeAccountOption(accountId, subaccountId));
    setError(null);
    setFrequency(null);
    setOriginalFrequency(null);
    if (target.scope === 'series' && occ.recurrenceRuleId) {
      api.listRecurrenceRules().then((rules) => {
        const rule = rules.find((r) => r.id === occ.recurrenceRuleId);
        if (rule && rule.frequency !== 'ONCE') {
          setFrequency(rule.frequency);
          setOriginalFrequency(rule.frequency);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ?.plannedOperationId, target?.scope]);

  if (!target || !occ) return null;
  const { preposition } = relevantAccount(occ);
  const accountOptionsList = accountSelectOptions(accounts, true);
  const canSubmit = label.trim() !== '' && amount.trim() !== '' && date.trim() !== '';

  async function submit() {
    if (!canSubmit || saving || !occ || !target) return;
    setSaving(true);
    setError(null);
    try {
      const decoded = accountOption ? decodeAccountOption(accountOption, accounts) : null;
      const sideFields = decoded
        ? preposition === 'depuis'
          ? { sourceAccountId: decoded.accountId, sourceSubaccountId: decoded.subaccountId }
          : { destinationAccountId: decoded.accountId, destinationSubaccountId: decoded.subaccountId }
        : {};

      if (target.scope === 'single') {
        await api.updatePlannedOperation(occ.plannedOperationId, {
          label: label.trim(),
          expectedAmount: amount,
          expectedDate: date,
          categoryId: categoryId ?? undefined,
          ...sideFields,
        });
        await onDone('Échéance modifiée');
      } else {
        const frequencyChanged = frequency !== null && frequency !== originalFrequency;
        const dateChanged = date !== originalDate;
        await api.updateRecurrenceRule(occ.recurrenceRuleId!, {
          applyFrom: 'THIS_AND_FOLLOWING',
          fromDate: originalDate,
          label: label.trim(),
          expectedAmount: amount,
          categoryId: categoryId ?? undefined,
          ...sideFields,
          frequency: frequencyChanged ? (frequency as api.RecurrenceFrequency) : undefined,
          anchorDate: frequencyChanged || dateChanged ? date : undefined,
        });
        await onDone('Échéance et suivantes modifiées');
      }
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement");
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
        <Text style={styles.confirmTitle}>{target.scope === 'series' ? 'Modifier cette échéance et les suivantes' : "Modifier l'échéance"}</Text>
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="planning-edit-label" />
        <FormField label="Montant prévu" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="planning-edit-amount" />
        <DateField label={target.scope === 'series' ? 'Date prévue (nouveau jour de référence)' : 'Date prévue'} value={date} onChange={setDate} />
        <Select label="Catégorie" value={categoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} onChange={setCategoryId} testID="planning-edit-category" />
        <Select label="Compte / enveloppe prévu(e)" value={accountOption} options={accountOptionsList} onChange={setAccountOption} testID="planning-edit-source" />
        {target.scope === 'series' && (
          <Select
            label="Périodicité"
            value={frequency}
            options={RECURRENCE_FREQUENCY_OPTIONS}
            onChange={(v) => setFrequency(v as RecurrenceOption)}
            testID="planning-edit-frequency"
          />
        )}
        {error ? <Text style={styles.errorText} testID="planning-edit-error">{error}</Text> : null}
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="planning-edit-cancel">
            <Text style={styles.confirmCancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.confirmPay, !canSubmit && styles.buttonDisabled]} onPress={submit} disabled={!canSubmit || saving} testID="planning-edit-submit">
            <Text style={styles.confirmPayText}>{saving ? '…' : 'Enregistrer'}</Text>
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
  onPayAdjust,
}: {
  target: { cell: api.PlanningCellApi; rowLabel: string; month: string } | null;
  onClose: () => void;
  onRealized: () => Promise<void>;
  onViewOperation: (operationId: string) => void;
  /** Lot "paiements partiels successifs" — "Payer / Ajuster" sur une ligne À
   * VENIR rouvre le MÊME flux complet (solde, nouveau paiement partiel, choix
   * de source) qu'un appui long sur une case à occurrence unique, jamais un
   * "Marquer réalisé" instantané qui risquerait de régler deux fois un
   * montant déjà partiellement payé. */
  onPayAdjust: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => void;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const [actingId, setActingId] = useState<string | null>(null);
  if (!target) return null;
  const { cell, rowLabel } = target;
  const realizedItems = cell.items.filter((i) => i.type !== 'PLANNED_PENDING');
  const pendingItems = cell.items.filter((i) => i.type === 'PLANNED_PENDING');

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
                {pendingItems.map((item, i) => {
                  const occurrence = occurrenceFromItem(item);
                  const dejaPaye = occurrence?.realizedAmount ?? 0;
                  return (
                    <View key={`p-${item.plannedOperationId}-${i}`} style={styles.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.detailLabel}>{item.label}</Text>
                        <Text style={styles.detailMeta}>
                          {formatShortDate(item.date)}
                          {dejaPaye > 0 ? ` · déjà payé ${formatDh(dejaPaye)}` : ''}
                        </Text>
                      </View>
                      {/* item.amount porte déjà le RESTE à payer (jamais le prévu complet). */}
                      <Text style={[styles.detailAmount, styles.detailAmountPending]}>{formatDh(item.amount)}</Text>
                      {occurrence && (
                        <TouchableOpacity
                          style={styles.markRealizedButton}
                          onPress={() => onPayAdjust(occurrence, item.label)}
                          testID={`planning-detail-pay-adjust-${item.plannedOperationId}`}
                        >
                          <Text style={styles.markRealizedButtonText}>Payer / Ajuster</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
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
  horizonBar: { flexDirection: 'row', paddingHorizontal: spacing.lg, marginBottom: spacing.xs, gap: spacing.sm },
  horizonPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary },
  horizonPillActive: { backgroundColor: colors.primary },
  horizonPillText: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.textSecondary },
  horizonPillTextActive: { color: colors.textOnPrimary },
  tableRow: { flexDirection: 'row', paddingLeft: spacing.lg },
  labelCell: { justifyContent: 'center', paddingRight: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  // Flèches ‹ › intégrées à l'en-tête des mois (correctif finition) — ‹ dans
  // la cellule d'en-tête de la colonne de libellés figée, › en superposition
  // compacte au-dessus du défilement, jamais une rangée séparée qui ajoute
  // de la hauteur. Déplacent la même fenêtre que le swipe (goToWindow).
  headerLabelCell: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  monthNextButton: {
    position: 'absolute',
    top: 0,
    right: 2,
    height: HEADER_HEIGHT,
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    zIndex: 2,
  },
  sectionLabelCell: { justifyContent: 'flex-end', paddingBottom: 4, paddingLeft: spacing.xs, borderLeftWidth: 3 },
  sectionLabelText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, letterSpacing: 0.5 },
  rowLabelText: { fontSize: 13, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary },
  emptyRowText: { ...typography.caption, color: colors.textPlaceholder },
  totalLabelCell: { justifyContent: 'center', borderTopWidth: 2, borderTopColor: colors.borderStrong, backgroundColor: colors.surfaceSecondary, paddingRight: spacing.sm, paddingLeft: spacing.xs, borderLeftWidth: 3 },
  totalLabelText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  monthHeaderCell: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 4 },
  monthHeaderText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, color: colors.textSecondary },
  sectionSpacerCell: {},
  // Titre de regroupement catégorie (Lot ciblé §5) — jamais une ligne financière :
  // pas de bordure de cellule, pas de fond de statut, juste un libellé discret.
  categoryHeaderCell: { justifyContent: 'flex-end', paddingBottom: 2 },
  categoryHeaderText: { fontSize: 10, fontFamily: fontFamily.sansBold, color: colors.textPlaceholder, letterSpacing: 0.4, textTransform: 'uppercase' },
  categoryHeaderSpacerCell: {},
  cell: { alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, borderLeftWidth: 1, borderLeftColor: colors.divider },
  cellRealized: {},
  cellPending: {},
  // MIXTE : même teinte que "prévu" (jamais confondu avec 100% réalisé, vert) mais un
  // liseré vert à gauche signale la part déjà réalisée dans la case — sobre, sans
  // ajouter de nouvelle couleur au design system (§7, purement visuel).
  cellMixed: { backgroundColor: colors.warningLight, borderLeftWidth: 3, borderLeftColor: colors.success },
  cellEmpty: { color: colors.textPlaceholder },
  // Montant affiché en chip/pill (maquette Planning validée).
  cellChip: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 3, maxWidth: '92%' },
  cellChipRealized: { backgroundColor: colors.successLight },
  cellChipPending: { backgroundColor: colors.warningLight },
  cellAmount: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.textPrimary },
  cellAmountRealized: { color: colors.success },
  cellAmountPending: { color: colors.warning },
  cellMixedWrap: { alignItems: 'center' },
  cellAmountMixed: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.warning, paddingHorizontal: 2 },
  cellRestantMixed: { fontSize: 8.5, fontFamily: fontFamily.sansBold, color: colors.danger, paddingHorizontal: 2, marginTop: 1 },
  totalCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderTopWidth: 2, borderTopColor: colors.borderStrong, borderLeftWidth: 1, borderLeftColor: colors.divider, paddingHorizontal: 2 },
  totalCellText: { fontSize: 11.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  syntheseCell: { backgroundColor: colors.surfaceActive },
  // Lot "synthèse enrichie" — 2 lignes compactes (payé/prévu + reste), même gabarit que la case MIXTE (cellAmountMixed/cellRestantMixed) pour rester dense.
  syntheseDetailAmount: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary, paddingHorizontal: 2 },
  syntheseDetailReste: { fontSize: 8.5, fontFamily: fontFamily.sansBold, color: colors.textSecondary, paddingHorizontal: 2, marginTop: 1 },
  // Lot "couverture des dépenses restantes" — 3e ligne du mois courant uniquement.
  syntheseCouvertureWarn: { fontSize: 8, fontFamily: fontFamily.sansExtraBold, color: colors.danger, paddingHorizontal: 2, marginTop: 1 },
  syntheseCouvertureOk: { fontSize: 8, fontFamily: fontFamily.sansExtraBold, color: colors.success, paddingHorizontal: 2, marginTop: 1 },
  negativeText: { color: colors.danger },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
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
  confirmPay: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary, ...elevation.button },
  confirmPayText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  adjustSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  adjustPrevu: { ...typography.bodySecondary, marginBottom: spacing.md },
  adjustAccount: { ...typography.bodySecondary, marginBottom: spacing.md },
  partialSectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, letterSpacing: 0.5, marginTop: spacing.lg, marginBottom: spacing.xs },
  partialButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.sm, ...elevation.button },
  partialButtonText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
  buttonDisabled: { opacity: 0.5 },
  errorText: { ...typography.body, color: colors.danger, marginTop: spacing.sm },
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
  planCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.sm, ...elevation.card },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planLabel: { ...typography.body, fontWeight: '700' },
  planNextDeadline: { ...typography.bodySecondary },
  planViewLink: { ...typography.caption, fontWeight: '700', color: colors.primary, marginTop: spacing.xs },
});
