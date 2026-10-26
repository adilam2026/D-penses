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
import { Toast } from '../ui/Toast';
import { useBottomInset } from '../ui/useBottomInset';
import { testIdSlug } from '../ui/testIdSlug';
import { useKeyboardAwareScroll } from '../ui/useKeyboardAwareScroll';
import { accountSelectOptions, decodeAccountOption, encodeAccountOption } from '../ui/accountOptions';
import { RECURRENCE_FREQUENCY_OPTIONS, RecurrenceOption } from '../ui/recurrenceLabels';

const HORIZON_OPTIONS = [3, 6, 9, 12] as const;
// Fenêtre multi-mois compacte — 3 colonnes visibles à la fois (flèches ‹ ›)
// sur tout l'horizon sélectionné, partagées par tous les accordéons (§3).
const VISIBLE_COLUMNS = 3;
const CENTER_COLUMN_INDEX = 1;
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
  // Lot "refonte Planning/À faire" §7 — chaque bloc (Revenus/Dépenses/
  // Versements) est un accordéon indépendant ; replié, seul le header (titre
  // + total du mois actif) reste visible. Revenus ouvert par défaut, les
  // autres fermés (§7) — état conservé pendant la navigation tant que l'écran
  // reste monté, rien ne se replie/déplie sans action explicite.
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set(['DÉPENSES', 'ÉPARGNE / VERSEMENTS']));
  function toggleBlock(title: string) {
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  // Fenêtre de 3 mois glissante sur l'horizon chargé (data.months) : windowStart
  // = index du premier mois visible, déplacé par pas de 1 (flèches), jamais
  // par pas de 3 — cf. l'exemple Oct|Nov|Déc → Nov|Déc|Jan. UNE seule barre
  // de navigation (§3), partagée par tous les accordéons.
  const [windowStart, setWindowStart] = useState(0);

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
  }, [months]);

  function goToWindow(idx: number) {
    if (!data) return;
    const maxStart = Math.max(0, data.months.length - VISIBLE_COLUMNS);
    setWindowStart(Math.max(0, Math.min(maxStart, idx)));
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
  // Dernier mois VISIBLE de la fenêtre 3 mois courante (§5) — recalculé à
  // chaque navigation (windowStart change), jamais figé sur le dernier mois
  // de tout l'horizon chargé.
  const lastVisibleMonth = data.months[Math.min(windowStart + VISIBLE_COLUMNS - 1, data.months.length - 1)];
  const visibleMonths = data.months.slice(windowStart, windowStart + VISIBLE_COLUMNS);
  // Mois actif (§4) : toujours le premier mois chargé (le mois réel en
  // cours), indépendant de la fenêtre de navigation — une référence stable,
  // jamais "ce sur quoi l'utilisateur a navigué".
  const currentSynthese = data.synthese[data.months[0]];

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

        {/* Navigation temporelle (§3) — UNE SEULE barre de mois, partagée par
            tous les accordéons ci-dessous (jamais un scroll horizontal par
            bloc) : les flèches déplacent la fenêtre de 3 mois d'un pas à la
            fois (ex. Oct|Nov|Déc -> Nov|Déc|Jan). Toujours 3 mois visibles. */}
        <View style={styles.monthNavRow} testID="planning-month-nav">
          <TouchableOpacity onPress={() => goToWindow(windowStart - 1)} disabled={windowStart === 0} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} testID="planning-month-prev">
            <Ionicons name="chevron-back" size={18} color={windowStart === 0 ? colors.textPlaceholder : colors.textPrimary} />
          </TouchableOpacity>
          {visibleMonths.map((m, i) => (
            <Text key={m} style={[styles.monthNavLabel, i === CENTER_COLUMN_INDEX && styles.monthNavLabelActive]} numberOfLines={1}>
              {formatMonthShort(m)}
            </Text>
          ))}
          <TouchableOpacity
            onPress={() => goToWindow(windowStart + 1)}
            disabled={windowStart >= maxWindowStart}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="planning-month-next"
          >
            <Ionicons name="chevron-forward" size={18} color={windowStart >= maxWindowStart ? colors.textPlaceholder : colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Carte Projection (§5) — toujours visuellement séparée, jamais une
            phrase perdue sous un tableau. Cumul jusqu'au DERNIER mois visible
            de la fenêtre 3 mois, recalculé à chaque navigation. */}
        <View style={styles.projectionCard} testID="planning-projection-cumulee">
          <View style={styles.projectionCardIcon}>
            <Ionicons name="flag" size={18} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.projectionCardLabel}>Projection à fin {formatMonthLabel(lastVisibleMonth)}</Text>
            <Text style={[styles.projectionCardAmount, data.synthese[lastVisibleMonth].projectionCumulee < 0 && styles.negativeText]}>
              {formatDh(data.synthese[lastVisibleMonth].projectionCumulee)}
            </Text>
          </View>
        </View>

        {/* "Reste à exécuter" (§12) — carte compacte, MOIS COURANT uniquement
            (resteDepenses non-null) : jamais une ligne supplémentaire d'un
            tableau, jamais une valeur inventée faute de projection fiable. */}
        {currentSynthese.resteDepenses !== null && (
          <View style={styles.resteCard} testID="planning-reste-card">
            <Text style={styles.resteCardTitle}>Reste à exécuter</Text>
            <View style={styles.resteCardRow}>
              <Text style={styles.resteCardLabel}>Dépenses</Text>
              <Text style={styles.resteCardValue}>{formatDh(currentSynthese.resteDepenses)}</Text>
            </View>
            <View style={styles.resteCardRow}>
              <Text style={styles.resteCardLabel}>Versements</Text>
              <Text style={styles.resteCardValue}>{formatDh(currentSynthese.resteVersements ?? 0)}</Text>
            </View>
            <View style={styles.resteCardRow}>
              {currentSynthese.couverte ? (
                <Text style={styles.syntheseCouvertureOk} testID="planning-reste-couvert">
                  ✓ Tout est couvert
                </Text>
              ) : (
                <Text style={styles.syntheseCouvertureWarn} testID="planning-reste-a-provisionner">
                  À provisionner {formatDh(currentSynthese.aProvisionner ?? 0)}
                </Text>
              )}
            </View>
          </View>
        )}

        {/* Structure principale (§6/§7) — 3 cartes/accordéons indépendants,
            partageant la même fenêtre de 3 mois (visibleMonths) que la
            navigation ci-dessus — plus aucun grand tableau continu. */}
        {blocks.map((block) => (
          <PlanningAccordion
            key={block.title}
            block={block}
            items={blockItemsByTitle.get(block.title) ?? []}
            visibleMonths={visibleMonths}
            currentMonth={data.months[0]}
            synthese={data.synthese}
            isCollapsed={collapsedBlocks.has(block.title)}
            onToggle={() => toggleBlock(block.title)}
            onCellPress={onCellPress}
          />
        ))}

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
      style={[styles.cell, isRealized && styles.cellRealized, isPending && styles.cellPending, isMixed && styles.cellMixed]}
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

const BLOCK_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  REVENUS: 'trending-up-outline',
  DÉPENSES: 'cart-outline',
  'ÉPARGNE / VERSEMENTS': 'wallet-outline',
};

/**
 * Accordéon Planning (§6/§7) — carte autonome : header toujours visible
 * (icône + titre + total du mois ACTIF + chevron), contenu replié par
 * défaut sauf ouvert explicitement. Les 3 colonnes mensuelles affichées sont
 * celles de `visibleMonths` (fenêtre partagée, pilotée par la barre de
 * navigation unique en haut de l'écran) — jamais un scroll horizontal
 * indépendant par bloc.
 */
function PlanningAccordion({
  block,
  items,
  visibleMonths,
  currentMonth,
  synthese,
  isCollapsed,
  onToggle,
  onCellPress,
}: {
  block: BlockDef;
  items: BlockItem[];
  visibleMonths: string[];
  currentMonth: string;
  synthese: Record<string, api.PlanningMonthSyntheseApi>;
  isCollapsed: boolean;
  onToggle: () => void;
  onCellPress: (cell: api.PlanningCellApi, rowLabel: string) => void;
}) {
  const total = synthese[currentMonth][block.totalKey];
  return (
    <View style={styles.accordionCard} testID={`planning-accordion-${testIdSlug(block.title)}`}>
      <TouchableOpacity style={styles.accordionHeader} onPress={onToggle} testID={`planning-block-toggle-${testIdSlug(block.title)}`}>
        <View style={[styles.accordionIconCircle, { backgroundColor: `${block.accentColor}22` }]}>
          <Ionicons name={BLOCK_ICONS[block.title] ?? 'ellipse-outline'} size={16} color={block.accentColor} />
        </View>
        <Text style={styles.accordionTitle} numberOfLines={1}>
          {block.title}
        </Text>
        <Text style={[styles.accordionTotal, { color: block.accentColor }]}>{formatDh(total)}</Text>
        <Ionicons name={isCollapsed ? 'chevron-forward' : 'chevron-down'} size={16} color={colors.textSecondary} />
      </TouchableOpacity>

      {!isCollapsed && (
        <View style={styles.accordionBody}>
          {items.length === 0 ? (
            <Text style={styles.accordionEmptyText}>{block.emptyText}</Text>
          ) : (
            <>
              <View style={styles.monthColHeaderRow}>
                <View style={styles.monthColSpacer} />
                {visibleMonths.map((m) => (
                  <Text key={m} style={styles.monthColHeader} numberOfLines={1}>
                    {formatMonthShort(m)}
                  </Text>
                ))}
              </View>
              {items.map((item, idx) =>
                item.kind === 'header' ? (
                  // Titre de regroupement catégorie — PUR AFFICHAGE : jamais de montant, jamais tappable.
                  <View key={`h-${idx}`} style={styles.accordionCategoryHeader}>
                    <Text style={styles.accordionCategoryHeaderText} numberOfLines={1}>
                      {item.label}
                    </Text>
                  </View>
                ) : (
                  <View key={item.row.key} style={styles.accordionRow}>
                    <Text style={styles.accordionRowLabel} numberOfLines={2}>
                      {item.row.label}
                    </Text>
                    <View style={styles.accordionCellsRow}>
                      {visibleMonths.map((m) => (
                        <PlanningCellView
                          key={m}
                          cell={item.row.cells[m]}
                          onPress={() => onCellPress(item.row.cells[m], item.row.label)}
                          onLongPress={() => onCellPress(item.row.cells[m], item.row.label)}
                          testID={`planning-cell-${testIdSlug(item.row.label)}-${m}`}
                        />
                      ))}
                    </View>
                  </View>
                ),
              )}
            </>
          )}
        </View>
      )}
    </View>
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
  onClose,
  onDone,
  onEdit,
  onCancel,
  onViewTransaction,
  onUnrealize,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
  onEdit: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => void;
  onCancel: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => void;
  onViewTransaction: (operationId: string) => void;
  onUnrealize: (occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const occ = target?.occurrence ?? null;
  // 'menu' = résumé + liste d'actions ; 'partial' = le SEUL sous-formulaire
  // restant (§15 — le paiement total est désormais une action directe, sans
  // formulaire : montant/date/source sont automatiques, jamais redemandés).
  const [view, setView] = useState<'menu' | 'partial'>('menu');
  const [partialAmount, setPartialAmount] = useState('');
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
      setPartialAmount('');
      setError(null);
    }
  }, [occ?.plannedOperationId, occ?.realizedAmount]);

  if (!target || !occ) return null;
  const partialValue = Number(partialAmount);
  const canSubmitPartial = partialAmount.trim() !== '' && partialValue > 0 && partialValue < remaining;
  const todayIso = () => new Date().toISOString().slice(0, 10);

  /**
   * Paiement total (§15) — UNE SEULE action, immédiate : montant restant,
   * date = aujourd'hui, source/destination PRÉVUES — jamais un formulaire
   * intermédiaire. Si la source prévue n'est plus valide (§16), le backend
   * refuse et l'erreur s'affiche ici même, sans jamais transformer le
   * parcours normal en formulaire.
   */
  async function submitPay() {
    if (saving || !occ) return;
    setSaving(true);
    setError(null);
    try {
      await api.realizePlannedOperation(occ.plannedOperationId, { actualAmount: String(remaining), actualDate: todayIso() });
      await onDone(`${target!.rowLabel} payé`);
    } catch (e) {
      setError(e instanceof api.ApiError ? e.message : "Erreur lors de l'enregistrement du paiement");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Paiement partiel (§17) — SEUL le montant est demandé : date =
   * aujourd'hui, source = celle prévue, jamais redemandées. Enregistre le
   * montant réellement payé sans clore l'échéance — le reste continue
   * d'apparaître comme à venir (même échéance, toujours PENDING), et peut
   * recevoir d'AUTRES paiements partiels, chacun indépendant.
   */
  async function submitPartial() {
    if (!canSubmitPartial || saving || !occ) return;
    setSaving(true);
    setError(null);
    try {
      await api.partialRealizePlannedOperation(occ.plannedOperationId, { actualAmount: partialAmount, actualDate: todayIso() });
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

            {error ? (
              <Text style={styles.errorText} testID="action-sheet-error">
                {error}
              </Text>
            ) : null}

            {occ.status === 'PENDING' ? (
              <>
                <TouchableOpacity style={styles.actionPrimary} onPress={submitPay} disabled={saving} testID="action-sheet-pay">
                  <Text style={styles.actionPrimaryText}>{saving ? '…' : `Payer ${formatDh(remaining)}`}</Text>
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
                    await onUnrealize(occ!, target.rowLabel);
                    setSaving(false);
                  }}
                  disabled={saving}
                  testID="action-sheet-unrealize"
                >
                  <Text style={styles.actionSecondaryText}>{saving ? '…' : 'Annuler le paiement'}</Text>
                </TouchableOpacity>
                {/* §20 — ouvrir Modifier/Annuler sur une échéance payée ne mute
                    RIEN : mêmes callbacks que pour une échéance à faire, qui
                    ouvrent directement la sheet concernée. */}
                <TouchableOpacity style={styles.actionSecondary} onPress={() => onEdit(occ!, target.rowLabel)} testID="action-sheet-edit-paid">
                  <Text style={styles.actionSecondaryText}>Modifier l'échéance</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionSecondary} onPress={() => onCancel(occ!, target.rowLabel)} testID="action-sheet-cancel-paid">
                  <Text style={styles.actionSecondaryText}>Annuler l'échéance</Text>
                </TouchableOpacity>
              </>
            )}
            <TouchableOpacity style={styles.actionClose} onPress={onClose} testID="action-sheet-close">
              <Text style={styles.actionCloseText}>Fermer</Text>
            </TouchableOpacity>
          </>
        )}

        {view === 'partial' && (
          <>
            <Text style={styles.actionSheetSectionLabel}>Paiement partiel</Text>
            <Text style={styles.adjustPrevu}>Enregistre un paiement sans clore l'échéance — le reste continue d'apparaître comme à venir.</Text>
            <FormField
              label="Montant à payer maintenant"
              value={partialAmount}
              onChangeText={setPartialAmount}
              onFocus={handleFocus}
              keyboardType="decimal-pad"
              testID="action-sheet-partial-amount"
            />
            {partialValue > 0 && partialValue < remaining ? (
              <Text style={styles.adjustPrevu} testID="action-sheet-partial-reste">
                Il restera {formatDh(remaining - partialValue)} à payer.
              </Text>
            ) : null}
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
                <Text style={styles.confirmPayText}>{saving ? '…' : 'Enregistrer le paiement partiel'}</Text>
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
  showToast,
  onViewTransaction,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  accounts: api.AccountApi[];
  categories: api.CategoryApi[];
  members: api.HouseholdMembershipApi[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  showToast: (message: string) => void;
  onViewTransaction: (operationId: string) => void;
}) {
  const [editTarget, setEditTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<{ occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null>(null);

  /**
   * "Modifier l'échéance" (§20-22) — ouvre TOUJOURS directement le
   * formulaire d'édition, sur l'occurrence TELLE QU'ELLE EST (PENDING,
   * partiellement payée, ou REALIZED — le backend accepte désormais les
   * trois) : aucun appel réseau avant que l'utilisateur n'appuie sur
   * "Enregistrer" (§20/§40 — ouvrir/choisir Modifier ne mute jamais rien).
   * Le choix "cette échéance / et les suivantes" est posé DANS le même
   * formulaire (EditOccurrenceModal), jamais une étape séparée.
   */
  function openEditFlow(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    setEditTarget({ occurrence, rowLabel });
  }

  /**
   * "Annuler l'échéance" (§25-27) — ouvre TOUJOURS directement la sheet de
   * confirmation (CancelOccurrenceSheet, ci-dessous) : aucune mutation avant
   * "Confirmer l'annulation", y compris quand un paiement existe déjà.
   */
  function openCancelFlow(occurrence: api.PlanningSingleOccurrenceApi, rowLabel: string) {
    setCancelTarget({ occurrence, rowLabel });
  }

  return (
    <>
      <ActionSheet
        target={target}
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
        // "Annuler le paiement" (§19) reste la SEULE action du menu d'une
        // échéance payée qui mute immédiatement — c'est l'action elle-même,
        // pas une étape préalable à autre chose.
        onUnrealize={async (occurrence) => {
          await api.unrealizePlannedOperation(occurrence.plannedOperationId);
          onClose();
          showToast('Paiement annulé');
          await onRefresh();
        }}
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

      <CancelOccurrenceSheet
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onDone={async (message) => {
          setCancelTarget(null);
          showToast(message);
          await onRefresh();
        }}
      />
    </>
  );
}

/**
 * "Annuler l'échéance" (§25-27) — UNE seule sheet, mutation différée jusqu'à
 * "Confirmer l'annulation" (§40). Si un paiement existe déjà (partiel ou
 * total), l'affiche explicitement (§27, jamais une disparition silencieuse) :
 * - "Cette échéance uniquement" (ou échéance ponctuelle) : si REALIZED,
 *   annule D'ABORD le paiement (reversal déjà validé, unrealize) puis annule
 *   l'échéance redevenue PENDING ; si PENDING avec paiement(s) partiel(s),
 *   ceux-ci restent des transactions réelles intactes, seule l'échéance
 *   passe CANCELLED (rien à reverser, le ledger ne bouge pas).
 * - "Cette échéance et les suivantes" : arrête la série à partir de cette
 *   date (occurrences encore PENDING) — ne touche JAMAIS un paiement déjà
 *   enregistré sur le pivot lui-même, récurrent ou non.
 */
function CancelOccurrenceSheet({
  target,
  onClose,
  onDone,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
  onClose: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const bottomInset = useBottomInset(spacing.lg);
  const [scope, setScope] = useState<'single' | 'series'>('single');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (target) setScope('single');
  }, [target?.occurrence.plannedOperationId]);

  if (!target) return null;
  const { occurrence: occ, rowLabel } = target;
  const dejaPaye = occ.realizedAmount ?? 0;
  const hasPayment = dejaPaye > 0;
  const isRecurring = !!occ.recurrenceRuleId;

  async function confirm() {
    if (saving) return;
    setSaving(true);
    try {
      if (scope === 'series' && isRecurring) {
        await api.updateRecurrenceRule(occ.recurrenceRuleId!, { applyFrom: 'THIS_AND_FOLLOWING', fromDate: occ.expectedDate.slice(0, 10), active: false });
        await onDone('Série arrêtée à partir de cette échéance');
        return;
      }
      if (occ.status === 'REALIZED') {
        await api.unrealizePlannedOperation(occ.plannedOperationId);
      }
      await api.cancelPlannedOperation(occ.plannedOperationId);
      await onDone('Échéance annulée');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView style={styles.adjustSheet} contentContainerStyle={{ paddingBottom: bottomInset }} testID="cancel-occurrence-sheet">
        <Text style={styles.confirmTitle}>Annuler « {rowLabel} » ?</Text>
        {hasPayment ? (
          <Text style={styles.cancelPaymentWarning} testID="cancel-sheet-payment-warning">
            {formatDh(dejaPaye)} déjà payé{dejaPaye !== occ.expectedAmount ? ` sur ${formatDh(occ.expectedAmount)} prévus` : ''} sur cette échéance.
            {occ.status === 'REALIZED' ? ' Ce paiement sera annulé (reversal) avant que l\'échéance ne soit annulée.' : " Ce paiement reste une transaction réelle, conservée dans l'historique."}
          </Text>
        ) : (
          <Text style={styles.confirmText}>Cette échéance prévue sera retirée — elle n'a pas encore eu lieu.</Text>
        )}
        {isRecurring && (
          <ScopeRadioGroup
            value={scope}
            onChange={setScope}
            testIDPrefix="cancel-sheet-scope"
            seriesHelp="N'affecte jamais un paiement déjà enregistré sur cette échéance précise — seules les suivantes encore à venir sont annulées."
          />
        )}
        <View style={styles.confirmActions}>
          <TouchableOpacity style={styles.confirmCancel} onPress={onClose} testID="cancel-sheet-close">
            <Text style={styles.confirmCancelText}>Fermer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.dangerButton} onPress={confirm} disabled={saving} testID="cancel-sheet-confirm">
            <Text style={styles.dangerButtonText}>{saving ? '…' : "Confirmer l'annulation"}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

/** Choix de portée "cette échéance uniquement / et les suivantes" (§21/§26) — EMBARQUÉ dans la sheet concernée, jamais une étape séparée. */
function ScopeRadioGroup({
  value,
  onChange,
  testIDPrefix,
  seriesHelp,
}: {
  value: 'single' | 'series';
  onChange: (v: 'single' | 'series') => void;
  testIDPrefix: string;
  seriesHelp?: string;
}) {
  const options: { key: 'single' | 'series'; label: string }[] = [
    { key: 'single', label: 'Cette échéance uniquement' },
    { key: 'series', label: 'Cette échéance et les suivantes' },
  ];
  return (
    <View style={styles.scopeGroup}>
      {options.map((o) => (
        <TouchableOpacity key={o.key} style={styles.scopeOption} onPress={() => onChange(o.key)} testID={`${testIDPrefix}-${o.key}`}>
          <Ionicons name={value === o.key ? 'radio-button-on' : 'radio-button-off'} size={18} color={value === o.key ? colors.primary : colors.textSecondary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <Text style={styles.scopeOptionLabel}>{o.label}</Text>
            {o.key === 'series' && seriesHelp ? <Text style={styles.scopeOptionHelp}>{seriesHelp}</Text> : null}
          </View>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/**
 * "Modifier l'échéance" (§20-23) — UNE SEULE sheet, ouverte DIRECTEMENT
 * (aucun écran intermédiaire) : aucune mutation avant "Enregistrer" (§40),
 * y compris sur une occurrence déjà payée (REALIZED ou partiellement payée
 * — le backend l'accepte désormais directement). Le choix de portée ("cette
 * échéance uniquement" / "et les suivantes") est un simple champ radio EN
 * BAS du même formulaire quand l'occurrence est récurrente — jamais une
 * étape séparée. 'single' modifie uniquement l'occurrence visée (PATCH
 * /planned-operations/:id, jamais la règle) ; 'series' modifie le gabarit de
 * la règle ET les occurrences encore PENDING/REALIZED à partir de cette
 * occurrence (PATCH /recurrence-rules/:id, applyFrom=THIS_AND_FOLLOWING) —
 * jamais l'historique avant elle, jamais les occurrences annulées.
 */
function EditOccurrenceModal({
  target,
  accounts,
  categories,
  members,
  onClose,
  onDone,
}: {
  target: { occurrence: api.PlanningSingleOccurrenceApi; rowLabel: string } | null;
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

  const [scope, setScope] = useState<'single' | 'series'>('single');
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
    setScope('single');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occ?.plannedOperationId]);

  // La périodicité n'est chargée que si/quand l'utilisateur bascule sur
  // "et les suivantes" — jamais au chargement initial (évite un appel réseau
  // inutile pour la grande majorité des modifications, scope 'single').
  React.useEffect(() => {
    if (scope === 'series' && occ?.recurrenceRuleId && originalFrequency === null) {
      api.listRecurrenceRules().then((rules) => {
        const rule = rules.find((r) => r.id === occ.recurrenceRuleId);
        if (rule && rule.frequency !== 'ONCE') {
          setFrequency(rule.frequency);
          setOriginalFrequency(rule.frequency);
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, occ?.recurrenceRuleId]);

  if (!target || !occ) return null;
  const { preposition } = relevantAccount(occ);
  const accountOptionsList = accountSelectOptions(accounts, true);
  const canSubmit = label.trim() !== '' && amount.trim() !== '' && date.trim() !== '';
  const dejaPaye = occ.realizedAmount ?? 0;
  const isRecurring = !!occ.recurrenceRuleId;

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

      if (scope === 'single' || !isRecurring) {
        const updated = await api.updatePlannedOperation(occ.plannedOperationId, {
          label: label.trim(),
          expectedAmount: amount,
          expectedDate: date,
          categoryId: categoryId ?? undefined,
          ...responsibleFields,
          ...sideFields,
        });
        // §20/§24 — une occurrence REALIZED dont le prévu dépasse désormais
        // le déjà-payé redevient PENDING côté backend : le message le reflète.
        await onDone(updated.status === 'PENDING' && dejaPaye > 0 && dejaPaye < Number(amount) ? 'Échéance modifiée — reste à exécuter' : 'Échéance modifiée');
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
        <Text style={styles.confirmTitle}>Modifier l'échéance</Text>
        <Text style={styles.editSubtitle}>{target.rowLabel}</Text>
        {dejaPaye > 0 && (
          <Text style={styles.cancelPaymentWarning} testID="planning-edit-already-paid">
            {formatDh(dejaPaye)} déjà payés sur cette échéance — le nouveau montant prévu ne peut jamais être inférieur à ce montant.
          </Text>
        )}
        <FormField label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} testID="planning-edit-label" />
        <FormField label="Montant prévu" value={amount} onChangeText={setAmount} onFocus={handleFocus} keyboardType="decimal-pad" testID="planning-edit-amount" />
        <DateField label="Date prévue" value={date} onChange={setDate} />
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
        {isRecurring && scope === 'series' && (
          <Select
            label="Périodicité"
            value={frequency}
            options={RECURRENCE_FREQUENCY_OPTIONS}
            onChange={(v) => setFrequency(v as RecurrenceOption)}
            testID="planning-edit-frequency"
          />
        )}
        {isRecurring && <ScopeRadioGroup value={scope} onChange={setScope} testIDPrefix="planning-edit-scope" />}
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
  // Cartes de synthèse (§4) — même langage visuel que l'Accueil : cartes
  // arrondies, respiration, couleurs douces, hiérarchie claire. Grille 2×2 sur
  // mobile (jamais 4 cases minuscules serrées) — mois ACTIF uniquement.
  summaryCardsRow: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.lg, gap: spacing.sm, marginBottom: spacing.md },
  summaryCard: {
    width: '47%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderTopWidth: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...elevation.card,
  },
  summaryCardAccent: { backgroundColor: colors.surfaceActive, borderTopColor: colors.primary },
  summaryCardLabel: { fontSize: 10.5, fontFamily: fontFamily.sansExtraBold, color: colors.textSecondary, letterSpacing: 0.4, marginBottom: 4 },
  summaryCardAmount: { fontSize: 16, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  emptyRowText: { ...typography.caption, color: colors.textPlaceholder },
  // Barre de navigation temporelle UNIQUE (§3), partagée par tous les accordéons.
  monthNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, paddingVertical: spacing.sm, marginBottom: spacing.md },
  monthNavLabel: { ...typography.bodySecondary, fontFamily: fontFamily.sansSemiBold },
  monthNavLabelActive: { ...typography.body, fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary },
  // Carte Projection (§5) — jamais une phrase perdue sous un tableau.
  projectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    ...elevation.card,
  },
  projectionCardIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceActive, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  projectionCardLabel: { ...typography.caption, fontWeight: '700', color: colors.textSecondary },
  projectionCardAmount: { ...typography.sectionTitle, fontFamily: fontFamily.sansExtraBold, marginTop: 2 },
  // "Reste à exécuter" (§12) — carte compacte, mois courant uniquement.
  resteCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: spacing.lg, padding: spacing.md },
  resteCardTitle: { ...typography.caption, fontWeight: '800', color: colors.textSecondary, letterSpacing: 0.4, marginBottom: spacing.xs },
  resteCardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 2 },
  resteCardLabel: { ...typography.bodySecondary },
  resteCardValue: { ...typography.body, fontFamily: fontFamily.sansBold },
  syntheseCouvertureWarn: { ...typography.caption, fontFamily: fontFamily.sansExtraBold, color: colors.danger },
  syntheseCouvertureOk: { ...typography.caption, fontFamily: fontFamily.sansExtraBold, color: colors.success },
  negativeText: { color: colors.danger },
  // Accordéon (§6/§7) — carte arrondie, header toujours visible (icône +
  // titre + total du mois actif + chevron), contenu replié par défaut sauf
  // Revenus. Trois colonnes mensuelles FIXES quand ouvert (jamais de scroll
  // horizontal par bloc — la navigation se fait via monthNavRow, partagée).
  accordionCard: { backgroundColor: colors.surface, borderRadius: radius.lg, marginHorizontal: spacing.lg, marginBottom: spacing.md, overflow: 'hidden', ...elevation.card },
  accordionHeader: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  accordionIconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  accordionTitle: { ...typography.body, fontFamily: fontFamily.sansExtraBold, flex: 1 },
  accordionTotal: { ...typography.body, fontFamily: fontFamily.sansExtraBold, marginRight: spacing.sm },
  accordionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  monthColHeaderRow: { flexDirection: 'row', paddingTop: spacing.sm, paddingBottom: 2 },
  monthColSpacer: { flex: 1.4 },
  monthColHeader: { flex: 1, textAlign: 'center', fontSize: 10.5, fontFamily: fontFamily.sansExtraBold, color: colors.textSecondary },
  accordionCategoryHeader: { paddingTop: spacing.sm, paddingBottom: 2 },
  accordionCategoryHeaderText: { fontSize: 10, fontFamily: fontFamily.sansBold, color: colors.textPlaceholder, letterSpacing: 0.4, textTransform: 'uppercase' },
  accordionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs },
  accordionRowLabel: { flex: 1.4, fontSize: 13, fontFamily: fontFamily.sansSemiBold, color: colors.textPrimary, paddingRight: spacing.xs },
  accordionEmptyText: { ...typography.caption, color: colors.textPlaceholder, paddingVertical: spacing.sm },
  accordionCellsRow: { flex: 3, flexDirection: 'row' },
  // Séparateurs ALLÉGÉS — jamais de grosses lignes verticales/quadrillage complet.
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 32, borderRadius: radius.sm },
  cellRealized: {},
  cellPending: {},
  // MIXTE (partiellement réalisée) : accent ocre discret (liseré gauche), JAMAIS un fond saturé.
  cellMixed: { borderLeftWidth: 2, borderLeftColor: colors.warning },
  cellEmpty: { color: colors.textPlaceholder },
  // Montant affiché en chip/pill — RÉSERVÉ au statut RÉALISÉ (vert) : fond vert très clair + ✓.
  cellChip: { borderRadius: radius.pill, paddingHorizontal: 6, paddingVertical: 3, maxWidth: '96%', backgroundColor: colors.successLight },
  cellAmountRealized: { fontSize: 11, fontFamily: fontFamily.sansBold, color: colors.success },
  // À VENIR : texte neutre, fond très légèrement teinté (jamais une grosse capsule).
  cellAmountPending: { fontSize: 11, fontFamily: fontFamily.sansMedium, color: colors.textSecondary },
  cellMixedWrap: { alignItems: 'center' },
  cellAmountMixed: { fontSize: 9.5, fontFamily: fontFamily.sansExtraBold, color: colors.warning, paddingHorizontal: 2 },
  cellRestantMixed: { fontSize: 8.5, fontFamily: fontFamily.sansBold, color: colors.textSecondary, paddingHorizontal: 2, marginTop: 1 },
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
  editSubtitle: { ...typography.bodySecondary, marginBottom: spacing.md },
  // Avertissement "paiement déjà existant" (§23/§27, Modifier ET Annuler
  // d'une échéance déjà payée) — jamais une disparition silencieuse de ce fait.
  cancelPaymentWarning: { ...typography.body, backgroundColor: colors.warningLight, color: colors.textPrimary, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  // Choix de portée embarqué (§21/§26) — deux lignes à bouton radio, jamais une sheet séparée.
  scopeGroup: { marginTop: spacing.sm, marginBottom: spacing.sm },
  scopeOption: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
  scopeOptionLabel: { ...typography.body, fontWeight: '600' },
  scopeOptionHelp: { ...typography.caption, marginTop: 2 },
  dangerButton: { flex: 1, backgroundColor: colors.danger, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', ...elevation.button },
  dangerButtonText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
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
