import React, { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { colors, elevation, fontFamily, radius, spacing, typography } from '../ui/theme';
import { formatDh, formatMonthLabel, formatMonthShort, formatShortDate } from '../ui/formatMoney';
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
    responsibleMemberId: item.responsibleMemberId ?? null,
    expectedDate: item.date,
    realizedOperationId: null,
  };
}

/**
 * Retrouve, dans une table Planning fraîchement chargée, l'occurrence
 * singleOccurrence d'une échéance précise — utilisé après un unrealize()
 * pour reprendre la main avec le "déjà payé" RÉEL (d'éventuels paiements
 * partiels antérieurs à l'opération annulée restent comptés), jamais une
 * valeur figée capturée avant le refresh. Fonction pure (module-level),
 * réutilisable par tout écran qui charge un PlanningTableApi.
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
  const [members, setMembers] = useState<api.HouseholdMembershipApi[]>([]);
  const [plans, setPlans] = useState<api.FinancialPlanApi[]>([]);
  const [loading, setLoading] = useState(true);

  // Lot "refonte Planning/À faire" §3/§11 — ActionSheet est le SEUL point
  // d'entrée d'exécution d'une échéance, qu'elle vienne d'une case Planning
  // (singleOccurrence) ou d'un item précis d'une case ambiguë (reconstruit
  // via occurrenceFromItem, cf. CategoryDetailModal) — jamais un second
  // composant/moteur (remplace l'ancien trio PayPopupModal/AdjustModal/menus
  // pending+realized séparés).
  const [actionTarget, setActionTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);
  const [detailTarget, setDetailTarget] = useState<{ cell: api.PlanningCellApi; rowLabel: string; month: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Lot "refonte Planning/À faire" §2 — chaque bloc (Revenus/Dépenses/
  // Épargne) est pliable indépendamment (jamais un grand tableau continu
  // type Excel) ; replié, seule la ligne TOTAL reste visible. Tous dépliés
  // par défaut (comportement historique préservé, rien ne disparaît sans
  // action explicite de l'utilisateur).
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  function toggleBlock(title: string) {
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  // Fenêtre de 3 mois glissante sur l'horizon chargé (data.months) : windowStart
  // = index du premier mois visible, déplacé par pas de 1 (swipe à snap ou
  // flèches), jamais par pas de 3 — cf. l'exemple Oct|Nov|Déc → Nov|Déc|Jan.
  const [windowStart, setWindowStart] = useState(0);
  const [areaWidth, setAreaWidth] = useState(0);
  const monthScrollRef = useRef<ScrollView>(null);
  const columnWidth = areaWidth > 0 ? areaWidth / VISIBLE_COLUMNS : FALLBACK_COLUMN_WIDTH;

  const load = useCallback(async (h: number) => {
    const [planning, accountList, categoryList, planList, household] = await Promise.all([
      api.getPlanning(h),
      api.listAccounts(),
      api.listCategories(),
      api.listFinancialPlans(),
      api.getMyHousehold(),
    ]);
    setData(planning);
    setAccounts(accountList);
    setCategories(categoryList);
    setPlans(planList);
    setMembers(household.memberships);
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

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }

  /**
   * Montant cliquable (§3) : tap OU appui long sur toute case non vide ouvre
   * l'ActionSheet unique pour une occurrence unique — même comportement quel
   * que soit l'appui, jamais un pop-up différent selon tap/appui long. Sur
   * une case agrégée (plusieurs opérations), ouvre toujours le détail —
   * impossible de savoir laquelle basculer sans ambiguïté.
   */
  function onCellPress(cell: api.PlanningCellApi, rowLabel: string) {
    if (cell.status === 'EMPTY') return;
    if (!cell.singleOccurrence) {
      setDetailTarget({ cell, rowLabel, month: '' });
      return;
    }
    setActionTarget({ occurrence: cell.singleOccurrence, rowLabel });
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
  // Dernier mois VISIBLE de la fenêtre 3 mois courante (§13) — recalculé à
  // chaque navigation (windowStart change), jamais figé sur le dernier mois
  // de tout l'horizon chargé.
  const lastVisibleMonth = data.months[Math.min(windowStart + VISIBLE_COLUMNS - 1, data.months.length - 1)];

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
        {/* Cartes de synthèse (§2) — même langage visuel que l'Accueil
            (cartes arrondies, respiration, couleurs douces), mois COURANT
            uniquement (data.months[0]) : une vue d'ensemble immédiate,
            distincte du détail par mois ci-dessous — jamais mélangée au
            tableau. Mêmes totaux que les blocs/la synthèse par mois (aucun
            second calcul). */}
        <View style={styles.summaryCardsRow} testID="planning-summary-cards">
          <View style={[styles.summaryCard, { borderTopColor: colors.success }]} testID="planning-summary-card-revenus">
            <Text style={styles.summaryCardLabel}>REVENUS</Text>
            <Text style={styles.summaryCardAmount} numberOfLines={1} adjustsFontSizeToFit>
              {formatDh(data.synthese[data.months[0]].totalRevenus)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { borderTopColor: colors.danger }]} testID="planning-summary-card-depenses">
            <Text style={styles.summaryCardLabel}>DÉPENSES</Text>
            <Text style={styles.summaryCardAmount} numberOfLines={1} adjustsFontSizeToFit>
              {formatDh(data.synthese[data.months[0]].totalDepenses)}
            </Text>
          </View>
          <View style={[styles.summaryCard, { borderTopColor: colors.secondary }]} testID="planning-summary-card-versements">
            <Text style={styles.summaryCardLabel}>VERSEMENTS</Text>
            <Text style={styles.summaryCardAmount} numberOfLines={1} adjustsFontSizeToFit>
              {formatDh(data.synthese[data.months[0]].totalEpargne)}
            </Text>
          </View>
          <View style={[styles.summaryCard, styles.summaryCardAccent]} testID="planning-summary-card-resultat">
            <Text style={styles.summaryCardLabel}>RÉSULTAT PRÉVU</Text>
            <Text
              style={[styles.summaryCardAmount, data.synthese[data.months[0]].resultatPrevu < 0 && styles.negativeText]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatDh(data.synthese[data.months[0]].resultatPrevu)}
            </Text>
          </View>
        </View>

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
            {blocks.map((block) => {
              const isCollapsed = collapsedBlocks.has(block.title);
              return (
                <React.Fragment key={block.title}>
                  <TouchableOpacity
                    style={[styles.sectionLabelCell, { height: SECTION_HEIGHT, borderLeftColor: block.accentColor }]}
                    onPress={() => toggleBlock(block.title)}
                    testID={`planning-block-toggle-${testIdSlug(block.title)}`}
                  >
                    <Text style={[styles.sectionLabelText, { color: block.accentColor }]} numberOfLines={1}>
                      {block.title}
                    </Text>
                    <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={13} color={block.accentColor} />
                  </TouchableOpacity>
                  {isCollapsed ? null : block.rows.length === 0 ? (
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
              );
            })}
            {/* "Détail par mois" (§2) : REVENUS/DÉPENSES/VERSEMENTS reprennent
                EXACTEMENT les mêmes totaux que les lignes TOTAL ci-dessus
                (aucun second calcul) + RÉSULTAT PRÉVU — visuellement SÉPARÉ du
                détail par catégorie ci-dessus (fond teinté, jamais fondu dans
                le même tableau continu). */}
            <View style={styles.syntheseGroupLabel}>
              <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: colors.success }]}>
                <Text style={styles.totalLabelText}>REVENUS</Text>
              </View>
              <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: colors.danger }]}>
                <Text style={styles.totalLabelText}>DÉPENSES</Text>
              </View>
              <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, borderLeftColor: colors.secondary }]}>
                <Text style={styles.totalLabelText}>VERSEMENTS</Text>
              </View>
              <View style={[styles.totalLabelCell, { height: ROW_HEIGHT, backgroundColor: colors.surfaceActive }]}>
                <Text style={styles.totalLabelText}>RÉSULTAT PRÉVU</Text>
              </View>
              {/* "Reste à exécuter" — MOIS COURANT UNIQUEMENT (§10/§12), vide pour tout mois futur. */}
              <View style={[styles.totalLabelCell, { height: SYNTHESE_DEPENSES_ROW_HEIGHT }]}>
                <Text style={styles.totalLabelText} numberOfLines={2}>
                  RESTE À EXÉCUTER
                </Text>
              </View>
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

                {blocks.map((block) => {
                  const isCollapsed = collapsedBlocks.has(block.title);
                  return (
                    <React.Fragment key={block.title}>
                      <View style={{ flexDirection: 'row', height: SECTION_HEIGHT }}>
                        {data.months.map((m) => (
                          <View key={m} style={[styles.sectionSpacerCell, { width: columnWidth }]} />
                        ))}
                      </View>
                      {isCollapsed
                        ? null
                        : block.rows.length === 0
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
                                      onLongPress={() => onCellPress(item.row.cells[m], item.row.label)}
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
                  );
                })}

                {/* "Détail par mois" (§2) : REVENUS/DÉPENSES/VERSEMENTS =
                    EXACTEMENT les mêmes totaux que TOTAL REVENUS/DÉPENSES/
                    VERSEMENTS ci-dessus (aucun second calcul, aucune
                    divergence possible) + RÉSULTAT PRÉVU qui en dérive —
                    fond teinté (styles.syntheseGroupGrid), visuellement
                    séparé du détail par catégorie ci-dessus. */}
                <View style={styles.syntheseGroupGrid}>
                  <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-synthese-revenus-${m}`}>
                        <Text style={styles.totalCellText} numberOfLines={1} adjustsFontSizeToFit>
                          {formatDh(data.synthese[m].totalRevenus)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-synthese-depenses-${m}`}>
                        <Text style={styles.totalCellText} numberOfLines={1} adjustsFontSizeToFit>
                          {formatDh(data.synthese[m].totalDepenses)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-synthese-versements-${m}`}>
                        <Text style={styles.totalCellText} numberOfLines={1} adjustsFontSizeToFit>
                          {formatDh(data.synthese[m].totalEpargne)}
                        </Text>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', height: ROW_HEIGHT }}>
                    {data.months.map((m) => (
                      <View key={m} style={[styles.totalCell, styles.syntheseCell, { width: columnWidth }]} testID={`planning-synthese-resultat-prevu-${m}`}>
                        <Text style={[styles.totalCellText, data.synthese[m].resultatPrevu < 0 && styles.negativeText]} numberOfLines={1} adjustsFontSizeToFit>
                          {formatDh(data.synthese[m].resultatPrevu)}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* "Reste à exécuter" (§10/§11) — MOIS COURANT uniquement
                      (resteDepenses non-null) : vide pour tout mois futur,
                      jamais une valeur inventée faute de projection fiable. */}
                  <View style={{ flexDirection: 'row', height: SYNTHESE_DEPENSES_ROW_HEIGHT }}>
                    {data.months.map((m) => {
                      const s = data.synthese[m];
                      return (
                        <View key={m} style={[styles.totalCell, { width: columnWidth }]} testID={`planning-reste-a-executer-${m}`}>
                          {s.resteDepenses !== null && (
                            <>
                              <Text style={styles.syntheseDetailAmount} numberOfLines={1} adjustsFontSizeToFit>
                                Dépenses {Math.round(s.resteDepenses).toLocaleString('fr-FR')} DH
                              </Text>
                              <Text style={styles.syntheseDetailAmount} numberOfLines={1} adjustsFontSizeToFit>
                                Versements {Math.round(s.resteVersements ?? 0).toLocaleString('fr-FR')} DH
                              </Text>
                              {s.couverte ? (
                                <Text style={styles.syntheseCouvertureOk} numberOfLines={1} adjustsFontSizeToFit>
                                  ✓ Couvert
                                </Text>
                              ) : (
                                <Text style={styles.syntheseCouvertureWarn} numberOfLines={1} adjustsFontSizeToFit>
                                  À provisionner {Math.round(s.aProvisionner ?? 0).toLocaleString('fr-FR')} DH
                                </Text>
                              )}
                            </>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>

        {/* Projection (§13) — ligne UNIQUE sous le tableau (plus de grosse
            BALANCE CUMULÉE par colonne) : cumul des résultats prévus jusqu'au
            DERNIER MOIS VISIBLE de la fenêtre 3 mois, recalculée à chaque
            navigation (windowStart). */}
        <View style={styles.projectionLine} testID="planning-projection-cumulee">
          <Text style={styles.projectionLabel}>Projection à fin {formatMonthLabel(lastVisibleMonth)} :</Text>
          <Text style={[styles.projectionAmount, data.synthese[lastVisibleMonth].projectionCumulee < 0 && styles.negativeText]}>
            {formatDh(data.synthese[lastVisibleMonth].projectionCumulee)}
          </Text>
        </View>

        <PlansSection plans={plans} onOpen={(id) => navigation.navigate('FinancialPlanDetail', { id })} />
      </ScrollView>

      <PlannedOperationActionFlow
        target={actionTarget}
        accounts={accounts}
        categories={categories}
        members={members}
        onClose={() => setActionTarget(null)}
        onRefresh={async () => {
          await refresh();
        }}
        onRefreshAndResolve={async (plannedOperationId) => {
          const planning = await refresh();
          return findOccurrenceById(planning, plannedOperationId);
        }}
        showToast={showToast}
        onViewTransaction={(operationId) => navigation.navigate('TransactionDetail', { id: operationId })}
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
          setActionTarget({ occurrence, rowLabel });
        }}
      />

      <Toast message={toast} />
    </View>
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
        // Case MIXTE (partiellement réalisée) : réalisé ET à venir dans la
        // même case — jamais fondus en un seul total ambigu (§9 : ex. 570
        // réalisé / 592 total ne doit jamais lire "réalisé"). Allégé (lot
        // "Planning allégé") : plus de capsule jaune pleine, un simple accent
        // ocre discret (bordure) + texte ocre, jamais un fond saturé.
        <View style={styles.cellMixedWrap} testID={`${testID}-mixed`}>
          <Text style={styles.cellAmountMixed} numberOfLines={1} adjustsFontSizeToFit>
            {Math.round(cell.realizedAmount).toLocaleString('fr-FR')}/{Math.round(cell.displayAmount).toLocaleString('fr-FR')} DH
          </Text>
          <Text style={styles.cellRestantMixed} numberOfLines={1} adjustsFontSizeToFit>
            reste {Math.round(cell.pendingAmount).toLocaleString('fr-FR')} DH
          </Text>
        </View>
      ) : isPending ? (
        // À VENIR : affichage NEUTRE (lot "Planning allégé" §3) — jamais de
        // grosse capsule jaune derrière le montant, un simple texte discret
        // ocre/gris, sans fond.
        <Text style={styles.cellAmountPending} numberOfLines={1} adjustsFontSizeToFit>
          {formatDh(cell.displayAmount)}
        </Text>
      ) : (
        // RÉALISÉ : vert (seul statut gardant une capsule colorée, jamais allégée).
        <View style={styles.cellChip}>
          <Text style={styles.cellAmountRealized} numberOfLines={1} adjustsFontSizeToFit>
            {formatDh(cell.displayAmount)} ✓
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

/**
 * Composant d'action UNIQUE (§3/§11, "moteur commun Planning/À faire") —
 * exporté pour réutilisation STRICTE par TodoScreen : même composant, même
 * moteur backend (realize/partialRealize/unrealize), jamais une seconde
 * implémentation. Ouvert par un tap sur le montant d'une échéance (case
 * Planning ou ligne À faire) : affiche Prévu/Déjà payé/Reste (ou "✓ Payé
 * entièrement" pour une occurrence REALIZED), puis le menu d'actions
 * pertinent pour son état — Payer/Payer partiellement/Modifier/Annuler pour
 * une échéance non payée (§4/§5/§6/§9), Annuler le paiement/Modifier
 * l'échéance/Annuler l'échéance pour une échéance déjà payée (§8, via le
 * mécanisme de reversal déjà validé, cf. handlePaidOccurrenceAction).
 */
export function ActionSheet({
  target,
  accounts,
  onClose,
  onDone,
  onEdit,
  onCancel,
  onViewTransaction,
  onPaidAction,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onEdit: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => void;
  onCancel: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => void;
  onViewTransaction: (operationId: string) => void;
  onPaidAction: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string, intent: 'unrealize' | 'edit' | 'cancel') => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occ = target?.occurrence ?? null;
  // 'menu' = résumé + liste d'actions (les 5 écrans de la maquette
  // "Exécuter une échéance"/"Options sur échéance déjà payée" s'y résument à
  // UN seul composant, le menu changeant selon le statut) ; 'pay'/'partial' =
  // les deux sous-formulaires ("Paiement" / "Paiement partiel").
  const [view, setView] = useState<'menu' | 'pay' | 'partial'>('menu');
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
      setView('menu');
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
    if (!accountOption) return {};
    const decoded = decodeAccountOption(accountOption, accounts);
    return preposition === 'depuis'
      ? { sourceAccountId: decoded.accountId, sourceSubaccountId: decoded.subaccountId }
      : { destinationAccountId: decoded.accountId, destinationSubaccountId: decoded.subaccountId };
  }

  /** Paiement total (§4). */
  async function submitPay() {
    if (!amount.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.realizePlannedOperation(occ!.plannedOperationId, { actualAmount: amount, actualDate: date || undefined, ...paymentSourceOverride() });
      await onDone(`${target!.rowLabel} payé`);
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement du paiement");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Paiement partiel (§5) : enregistre le montant réellement payé sans
   * clore l'échéance — le reste continue d'apparaître comme à venir (même
   * échéance, toujours PENDING), et peut recevoir d'AUTRES paiements
   * partiels (paiements partiels successifs), chacun indépendant.
   */
  async function submitPartial() {
    if (!canSubmitPartial || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.partialRealizePlannedOperation(occ!.plannedOperationId, { actualAmount: partialAmount, actualDate: date || undefined, ...paymentSourceOverride() });
      await onDone('Paiement partiel enregistré');
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
      <ScrollView ref={scrollRef} style={styles.actionSheet} contentContainerStyle={{ paddingBottom: bottomInset }} testID="action-sheet">
        <Text style={styles.confirmTitle}>{target.rowLabel}</Text>

        {view === 'menu' && (
          <>
            <View style={styles.actionSheetSummary}>
              {occ.status === 'REALIZED' ? (
                <Text style={styles.actionSheetPaidFull} testID="action-sheet-paid-full">
                  ✓ Payé entièrement — {formatDh(occ.expectedAmount)}
                </Text>
              ) : dejaPaye > 0 ? (
                <>
                  <View style={styles.actionSheetSummaryRow}>
                    <Text style={styles.actionSheetSummaryLabel}>Prévu</Text>
                    <Text style={styles.actionSheetSummaryValue}>{formatDh(occ.expectedAmount)}</Text>
                  </View>
                  <View style={styles.actionSheetSummaryRow}>
                    <Text style={styles.actionSheetSummaryLabel}>Déjà payé</Text>
                    <Text style={[styles.actionSheetSummaryValue, styles.cellAmountRealized]} testID="action-sheet-deja-paye">
                      {formatDh(dejaPaye)}
                    </Text>
                  </View>
                  <View style={styles.actionSheetSummaryRow}>
                    <Text style={styles.actionSheetSummaryLabel}>Reste</Text>
                    <Text style={[styles.actionSheetSummaryValue, styles.actionSheetRemainingText]} testID="action-sheet-reste">
                      {formatDh(remaining)}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.actionSheetAmount}>{formatDh(occ.expectedAmount)}</Text>
              )}
            </View>

            {occ.status === 'PENDING' ? (
              <>
                <TouchableOpacity style={styles.actionPrimary} onPress={() => setView('pay')} testID="action-sheet-pay">
                  <Text style={styles.actionPrimaryText}>Payer {formatDh(remaining)}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSecondary} onPress={() => setView('partial')} testID="action-sheet-partial">
                  <Text style={styles.actionSecondaryText}>{dejaPaye > 0 ? 'Nouveau paiement partiel' : 'Payer partiellement'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSecondary} onPress={() => onEdit(occ!, target.rowLabel)} testID="action-sheet-edit">
                  <Text style={styles.actionSecondaryText}>Modifier l'échéance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSecondary} onPress={() => onCancel(occ!, target.rowLabel)} testID="action-sheet-cancel">
                  <Text style={styles.actionSecondaryText}>Annuler l'échéance</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {occ.realizedOperationId && (
                  <TouchableOpacity style={styles.actionSecondary} onPress={() => onViewTransaction(occ!.realizedOperationId!)} testID="action-sheet-view-transaction">
                    <Text style={styles.actionSecondaryText}>Voir la transaction</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={styles.actionSecondary}
                  onPress={async () => {
                    setSaving(true);
                    await onPaidAction(occ!, target.rowLabel, 'unrealize');
                    setSaving(false);
                  }}
                  disabled={saving}
                  testID="action-sheet-unrealize"
                >
                  <Text style={styles.actionSecondaryText}>{saving ? '…' : 'Annuler le paiement'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionSecondary}
                  onPress={async () => {
                    setSaving(true);
                    await onPaidAction(occ!, target.rowLabel, 'edit');
                    setSaving(false);
                  }}
                  disabled={saving}
                  testID="action-sheet-edit-paid"
                >
                  <Text style={styles.actionSecondaryText}>Modifier l'échéance</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionSecondary}
                  onPress={async () => {
                    setSaving(true);
                    await onPaidAction(occ!, target.rowLabel, 'cancel');
                    setSaving(false);
                  }}
                  disabled={saving}
                  testID="action-sheet-cancel-paid"
                >
                  <Text style={styles.actionSecondaryText}>Annuler l'échéance</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.actionClose} onPress={onClose} testID="action-sheet-close">
              <Text style={styles.actionCloseText}>Fermer</Text>
            </TouchableOpacity>
          </>
        )}

        {view === 'pay' && (
          <>
            <Text style={styles.actionSheetSectionLabel}>Confirmer le paiement</Text>
            <FormField label="Montant" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="action-sheet-pay-amount" />
            <DateField label="Date" value={date} onChange={setDate} />
            <Select label={accountFieldLabel} value={accountOption} options={sourceSelectOptions} onChange={setAccountOption} testID="action-sheet-pay-source" />
            {error ? (
              <Text style={styles.errorText} testID="action-sheet-error">
                {error}
              </Text>
            ) : null}
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setView('menu')} testID="action-sheet-pay-back">
                <Text style={styles.confirmCancelText}>Retour</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmPay} onPress={submitPay} disabled={saving} testID="action-sheet-pay-submit">
                <Text style={styles.confirmPayText}>{saving ? '…' : `Payer ${amount ? formatDh(Number(amount)) : ''}`}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {view === 'partial' && (
          <>
            <Text style={styles.actionSheetSectionLabel}>Paiement partiel</Text>
            <Text style={styles.adjustPrevu}>Enregistre un paiement sans clore l'échéance — le reste continue d'apparaître comme à venir.</Text>
            <FormField
              label="Montant payé maintenant"
              value={partialAmount}
              onChangeText={setPartialAmount}
              onFocus={handleFocus}
              keyboardType="decimal-pad"
              testID="action-sheet-partial-amount"
            />
            <DateField label="Date" value={date} onChange={setDate} />
            <Select label={accountFieldLabel} value={accountOption} options={sourceSelectOptions} onChange={setAccountOption} testID="action-sheet-partial-source" />
            {error ? (
              <Text style={styles.errorText} testID="action-sheet-error">
                {error}
              </Text>
            ) : null}
            <View style={styles.confirmActions}>
              <TouchableOpacity style={styles.confirmCancel} onPress={() => setView('menu')} testID="action-sheet-partial-back">
                <Text style={styles.confirmCancelText}>Retour</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmPay, !canSubmitPartial && styles.buttonDisabled]} onPress={submitPartial} disabled={!canSubmitPartial || saving} testID="action-sheet-partial-submit">
                <Text style={styles.confirmPayText}>{saving ? '…' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

/**
 * Enveloppe le composant d'action unique (ActionSheet) avec tout ce qu'il
 * peut déclencher — choix de portée (§6/§9), formulaire de modification
 * (EditOccurrenceModal), confirmations d'annulation — en UN seul bloc
 * exporté, réutilisé À L'IDENTIQUE par Planning ET TodoScreen (§3/§11 :
 * "même composant d'exécution ET même moteur backend", jamais une seconde
 * implémentation ne serait-ce que pour la navigation interne
 * menu -> modifier/annuler). `onRefreshAndResolve` est fourni par l'écran
 * appelant car Planning et À faire ne chargent pas la même forme de données
 * (PlanningTableApi vs TodoListApi) — seul ce petit "retrouve la ligne dans
 * MES données déjà rechargées" diffère, jamais les appels API eux-mêmes
 * (realize/partialRealize/update/cancel/unrealize, strictement partagés).
 */
export function PlannedOperationActionFlow({
  target,
  accounts,
  categories,
  members,
  onClose,
  onRefresh,
  onRefreshAndResolve,
  showToast,
  onViewTransaction,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  categories: api.CategoryApi[];
  members: api.HouseholdMembershipApi[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRefreshAndResolve: (plannedOperationId: string) => Promise<api.PlanningSingleOccurrenceApi | null>;
  showToast: (message: string) => void;
  onViewTransaction: (operationId: string) => void;
}) {
  // Choix "cette échéance uniquement / et les suivantes" — affiché uniquement
  // quand l'occurrence provient d'une récurrence (recurrenceRuleId non null).
  const [scopeChoiceTarget, setScopeChoiceTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string; intent: 'edit' | 'cancel' } | null>(null);
  const [editTarget, setEditTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string; scope: 'single' | 'series' } | null>(null);

  /**
   * "Modifier l'échéance" (§6) : si l'occurrence provient d'une récurrence,
   * demande d'abord "cette échéance uniquement / et les suivantes"
   * (ChoiceSheet) ; sinon (ponctuelle) ouvre directement le formulaire
   * d'édition, portée 'single' implicite — jamais ce choix pour une
   * opération non récurrente (§6).
   */
  function openEditFlow(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    if (occurrence.recurrenceRuleId) {
      setScopeChoiceTarget({ occurrence, rowLabel, intent: 'edit' });
    } else {
      setEditTarget({ occurrence, rowLabel, scope: 'single' });
    }
  }

  /** "Annuler l'échéance" (§9) — même logique de choix de portée que l'édition. */
  function openCancelFlow(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    if (occurrence.recurrenceRuleId) {
      setScopeChoiceTarget({ occurrence, rowLabel, intent: 'cancel' });
    } else {
      confirmCancelSingle(occurrence, rowLabel);
    }
  }

  /**
   * Annulation simple (déjà existante) — fonctionne pour TOUTE occurrence,
   * récurrente ou non : annule exclusivement CETTE ligne (status=CANCELLED),
   * jamais la règle ni les autres occurrences.
   */
  function confirmCancelSingle(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    Alert.alert(`Annuler « ${rowLabel} » ?`, "Cette échéance prévue sera retirée — elle n'a pas encore eu lieu.", [
      { text: 'Fermer', style: 'cancel' },
      {
        text: "Confirmer l'annulation",
        style: 'destructive',
        onPress: async () => {
          await api.cancelPlannedOperation(occurrence.plannedOperationId);
          showToast('Échéance annulée');
          await onRefresh();
        },
      },
    ]);
  }

  /**
   * Arrêter la série à partir de cette occurrence (§9) — annule le pivot et
   * toutes les occurrences encore PENDING à partir de sa date, et désactive
   * la règle (plus aucune occurrence future générée). Les occurrences déjà
   * réalisées avant le pivot restent intactes dans l'historique.
   */
  function confirmCancelSeries(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    if (!occurrence.recurrenceRuleId) return;
    Alert.alert(
      `Arrêter la série « ${rowLabel} » ?`,
      "Cette échéance et toutes les suivantes seront annulées. Les occurrences déjà réalisées restent dans l'historique.",
      [
        { text: 'Fermer', style: 'cancel' },
        {
          text: 'Arrêter la série',
          style: 'destructive',
          onPress: async () => {
            await api.updateRecurrenceRule(occurrence.recurrenceRuleId!, { applyFrom: 'THIS_AND_FOLLOWING', fromDate: occurrence.expectedDate.slice(0, 10), active: false });
            showToast('Série arrêtée à partir de cette échéance');
            await onRefresh();
          },
        },
      ],
    );
  }

  /**
   * Échéance déjà payée, actions "Modifier l'échéance" / "Annuler
   * l'échéance" (§8) — ces deux actions supposent une occurrence PENDING
   * (invariant backend inchangé) : on repasse donc d'abord par le
   * mécanisme de reversal déjà validé (unrealize, jamais une suppression),
   * puis on reprend EXACTEMENT le même parcours single/series que pour une
   * occurrence jamais payée, sur l'occurrence fraîche (PENDING) qui en
   * résulte. "unrealize" seul (sans action supplémentaire) correspond à
   * "Annuler le paiement".
   */
  async function handlePaidOccurrenceAction(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string, intent: 'unrealize' | 'edit' | 'cancel') {
    onClose();
    await api.unrealizePlannedOperation(occurrence.plannedOperationId);
    if (intent === 'unrealize') {
      await onRefresh();
      showToast('Paiement annulé');
      return;
    }
    const fresh = await onRefreshAndResolve(occurrence.plannedOperationId);
    if (!fresh) return;
    if (intent === 'edit') openEditFlow(fresh, rowLabel);
    else openCancelFlow(fresh, rowLabel);
  }

  return (
    <>
      <ActionSheet
        target={target}
        accounts={accounts}
        onClose={onClose}
        onDone={async (message) => {
          onClose();
          showToast(message);
          await onRefresh();
        }}
        onEdit={(occurrence, rowLabel) => {
          onClose();
          openEditFlow(occurrence, rowLabel);
        }}
        onCancel={(occurrence, rowLabel) => {
          onClose();
          openCancelFlow(occurrence, rowLabel);
        }}
        onViewTransaction={(operationId) => {
          onClose();
          onViewTransaction(operationId);
        }}
        onPaidAction={handlePaidOccurrenceAction}
      />

      {/* "Que souhaitez-vous modifier ?" (§6/§9) — uniquement pour une occurrence
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
              if (scopeChoiceTarget.intent === 'edit') setEditTarget({ occurrence: scopeChoiceTarget.occurrence, rowLabel: scopeChoiceTarget.rowLabel, scope: 'single' });
              else confirmCancelSingle(scopeChoiceTarget.occurrence, scopeChoiceTarget.rowLabel);
            },
          },
          {
            key: 'series',
            label: 'Cette échéance et les suivantes',
            onPress: () => {
              if (!scopeChoiceTarget) return;
              if (scopeChoiceTarget.intent === 'edit') setEditTarget({ occurrence: scopeChoiceTarget.occurrence, rowLabel: scopeChoiceTarget.rowLabel, scope: 'series' });
              else confirmCancelSeries(scopeChoiceTarget.occurrence, scopeChoiceTarget.rowLabel);
            },
          },
        ]}
      />

      <EditOccurrenceModal
        target={editTarget}
        accounts={accounts}
        categories={categories}
        members={members}
        onClose={() => setEditTarget(null)}
        onDone={async (message) => {
          setEditTarget(null);
          showToast(message);
          await onRefresh();
        }}
      />
    </>
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
  members,
  onClose,
  onDone,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string; scope: 'single' | 'series' } | null;
  accounts: api.AccountApi[];
  categories: api.CategoryApi[];
  members: api.HouseholdMembershipApi[];
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occ = target?.occurrence ?? null;
  const originalDate = target?.occurrence.expectedDate.slice(0, 10) ?? '';

  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [accountOption, setAccountOption] = useState<string | null>(null);
  // Lot "À faire" — RESPONSABLE ≠ SOURCE, jamais déduit de accountOption ci-dessus.
  const [responsibleMemberId, setResponsibleMemberId] = useState<string | null>(null);
  // Lot "refonte Planning/À faire" §1 — distingue la préremplissage (valeur
  // ACTUELLE de l'occurrence, jamais envoyée comme un nouveau choix) d'une
  // modification EXPLICITE par l'utilisateur ici : seule cette dernière est
  // envoyée au backend (-> MANUAL, protégée d'une cascade future) ; ne
  // jamais renvoyer la valeur préremplie, qui écraserait silencieusement une
  // origine AUTO existante à chaque simple modification de montant/date.
  const [responsibleTouched, setResponsibleTouched] = useState(false);
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
    setResponsibleMemberId(occ.responsibleMemberId);
    setResponsibleTouched(false);
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
      // Jamais renvoyer la valeur simplement préremplie (cf. commentaire de
      // responsibleTouched ci-dessus) — omis -> le backend garde le
      // responsable ET son origine (AUTO/MANUAL) existants inchangés.
      const responsibleFields = responsibleTouched ? { responsibleMemberId: responsibleMemberId ?? undefined, responsibleSource: 'MANUAL' as const } : {};

      if (target.scope === 'single') {
        await api.updatePlannedOperation(occ.plannedOperationId, {
          label: label.trim(),
          expectedAmount: amount,
          expectedDate: date,
          categoryId: categoryId ?? undefined,
          ...responsibleFields,
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
          ...responsibleFields,
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
        <Select
          label="Responsable"
          placeholder="Non défini"
          value={responsibleMemberId}
          options={members.map((m) => ({ value: m.id, label: m.user.firstName }))}
          onChange={(v) => {
            setResponsibleMemberId(v);
            setResponsibleTouched(true);
          }}
          testID="planning-edit-responsible-member"
        />
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
  labelCell: { justifyContent: 'center', paddingRight: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
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
  sectionLabelCell: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 4, paddingLeft: spacing.xs, paddingRight: 2, borderLeftWidth: 3 },
  sectionLabelText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, letterSpacing: 0.5, flex: 1 },
  // Cartes de synthèse (§2) — même langage visuel que l'Accueil : cartes
  // arrondies, respiration, couleurs douces, hiérarchie claire. Mois courant
  // uniquement, distinct du détail par mois (jamais un second calcul).
  summaryCardsRow: { flexDirection: 'row', paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.lg },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderTopWidth: 3,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    ...elevation.card,
  },
  summaryCardAccent: { backgroundColor: colors.surfaceActive, borderTopColor: colors.primary },
  summaryCardLabel: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.textSecondary, letterSpacing: 0.4, marginBottom: 2 },
  summaryCardAmount: { fontSize: 13, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  // Groupe "Détail par mois" (§2) — fond teinté + marge, pour se détacher
  // visuellement du détail par catégorie juste au-dessus (jamais un seul
  // tableau continu indifférencié).
  syntheseGroupLabel: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: 'hidden' },
  syntheseGroupGrid: { marginTop: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, overflow: 'hidden' },
  rowLabelText: { fontSize: 13, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary },
  emptyRowText: { ...typography.caption, color: colors.textPlaceholder },
  totalLabelCell: { justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.surfaceSecondary, paddingRight: spacing.sm, paddingLeft: spacing.xs, borderLeftWidth: 3 },
  totalLabelText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  monthHeaderCell: { justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 4 },
  monthHeaderText: { fontSize: 11, fontFamily: fontFamily.sansExtraBold, color: colors.textSecondary },
  sectionSpacerCell: {},
  // Titre de regroupement catégorie (Lot ciblé §5) — jamais une ligne financière :
  // pas de bordure de cellule, pas de fond de statut, juste un libellé discret.
  categoryHeaderCell: { justifyContent: 'flex-end', paddingBottom: 2 },
  categoryHeaderText: { fontSize: 10, fontFamily: fontFamily.sansBold, color: colors.textPlaceholder, letterSpacing: 0.4, textTransform: 'uppercase' },
  categoryHeaderSpacerCell: {},
  // Séparateurs ALLÉGÉS (lot "Planning allégé" §3) — hairline plutôt qu'1px plein,
  // pour un tableau beaucoup moins chargé visuellement (mêmes données, même structure).
  cell: { alignItems: 'center', justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  cellRealized: {},
  cellPending: {},
  // MIXTE (partiellement réalisée) : accent ocre discret (liseré gauche),
  // JAMAIS un fond saturé — §3 : "orange/ocre discret", jamais une grosse
  // capsule pleine comme l'ancien design.
  cellMixed: { borderLeftWidth: 3, borderLeftColor: colors.warning },
  cellEmpty: { color: colors.textPlaceholder },
  // Montant affiché en chip/pill — RÉSERVÉ au statut RÉALISÉ (vert) depuis le
  // lot "Planning allégé" : À VENIR n'a plus de capsule du tout (cf. cellAmountPending).
  cellChip: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 3, maxWidth: '92%', backgroundColor: colors.successLight },
  cellAmountRealized: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.success },
  // À VENIR : texte neutre ocre/gris, SANS fond — remplace l'ancienne capsule jaune pleine.
  cellAmountPending: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: colors.textSecondary },
  cellMixedWrap: { alignItems: 'center' },
  cellAmountMixed: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.warning, paddingHorizontal: 2 },
  cellRestantMixed: { fontSize: 8.5, fontFamily: fontFamily.sansBold, color: colors.textSecondary, paddingHorizontal: 2, marginTop: 1 },
  totalCell: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceSecondary, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider, paddingHorizontal: 2 },
  totalCellText: { fontSize: 11.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  syntheseCell: { backgroundColor: colors.surfaceActive },
  // "RESTE À EXÉCUTER" (mois courant uniquement, lot "Planning allégé" §10) — 2 lignes compactes.
  syntheseDetailAmount: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary, paddingHorizontal: 2 },
  syntheseDetailReste: { fontSize: 8.5, fontFamily: fontFamily.sansBold, color: colors.textSecondary, paddingHorizontal: 2, marginTop: 1 },
  syntheseCouvertureWarn: { fontSize: 8, fontFamily: fontFamily.sansExtraBold, color: colors.danger, paddingHorizontal: 2, marginTop: 1 },
  syntheseCouvertureOk: { fontSize: 8, fontFamily: fontFamily.sansExtraBold, color: colors.success, paddingHorizontal: 2, marginTop: 1 },
  negativeText: { color: colors.danger },
  projectionLine: { flexDirection: 'row', justifyContent: 'center', alignItems: 'baseline', paddingVertical: spacing.sm },
  projectionLabel: { ...typography.bodySecondary },
  projectionAmount: { ...typography.body, fontFamily: fontFamily.sansExtraBold, marginLeft: spacing.xs },
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
  // ActionSheet (§3/§11, composant d'action unique Planning/À faire) — même
  // langage visuel "cartes arrondies, respiration" que le reste de l'app.
  actionSheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, padding: spacing.xl, maxHeight: '85%' },
  actionSheetSummary: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg },
  actionSheetSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 },
  actionSheetSummaryLabel: { ...typography.bodySecondary },
  actionSheetSummaryValue: { ...typography.body, fontFamily: fontFamily.sansExtraBold },
  actionSheetRemainingText: { color: colors.primaryDark },
  actionSheetAmount: { ...typography.amountSecondary, textAlign: 'center' },
  actionSheetPaidFull: { ...typography.body, fontFamily: fontFamily.sansExtraBold, color: colors.success, textAlign: 'center' },
  actionSheetSectionLabel: { ...typography.sectionTitle, marginBottom: spacing.md },
  actionPrimary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm, ...elevation.button },
  actionPrimaryText: { ...typography.body, fontFamily: fontFamily.sansExtraBold, color: colors.textOnPrimary },
  actionSecondary: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  actionSecondaryText: { ...typography.body, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary },
  actionClose: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  actionCloseText: { ...typography.bodySecondary, fontFamily: fontFamily.sansSemiBold },
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
