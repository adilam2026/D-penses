import React, { useEffect, useState } from 'react';
import { LayoutChangeEvent, Modal, ScrollView, StyleProp, StyleSheet, Text, TouchableOpacity, TouchableWithoutFeedback, View, ViewStyle } from 'react-native';
import { colors, fontFamily, radius, spacing, typography } from './theme';
import { useHorizontalSwipe } from './useHorizontalSwipe';
import { fitFontSize } from './fitAmount';
import { monthKeyOf } from './monthKey';
import { useBottomInset } from './useBottomInset';

export interface NavigatorPeriod {
  monthKey: string;
  label: string;
  /** Absent : période non atteignable (bord de l'horizon), affichée mais inactive. */
  onPress?: () => void;
}

export interface PeriodPickerConfig {
  years: number[];
  /** Mois proposés mais non sélectionnables (ex. hors de l'horizon Planning). */
  isSelectable?: (monthKey: string) => boolean;
  onSelect: (monthKey: string) => void;
}

const ZONE_MIN_HEIGHT = 46;
const SIDE_FONT_SIZE = 11.5;
const ACTIVE_FONT_SIZE = 14;

/**
 * Navigation temporelle commune à Planning et À faire : trois zones tactiles
 * (période précédente / active / suivante) sur toute leur hauteur, balayables
 * (gauche = suivante, droite = précédente). Toucher la période active ouvre le
 * sélecteur mois/année. Remplace les anciennes flèches ‹ ›.
 */
export function MonthNavigator({
  previous,
  active,
  next,
  picker,
  leading,
  activeFlex = 1,
  swipe = true,
  testIDPrefix,
  style,
  onLayout,
}: {
  previous: NavigatorPeriod;
  active: NavigatorPeriod;
  next: NavigatorPeriod;
  picker: PeriodPickerConfig;
  /** Colonne vide placée avant les trois zones (ex. colonne des libellés du Planning). */
  leading?: React.ReactNode;
  activeFlex?: number;
  /** false quand une zone parente gère déjà le balayage (Planning). */
  swipe?: boolean;
  testIDPrefix: string;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const swipeHandlers = useHorizontalSwipe(next.onPress, previous.onPress);
  return (
    <View {...(swipe ? swipeHandlers : {})} style={[styles.row, style]} onLayout={onLayout} testID={testIDPrefix}>
      {leading}
      <Zone period={previous} kind="prev" flex={1} testID={`${testIDPrefix}-prev`} />
      <Zone period={{ ...active, onPress: () => setPickerOpen(true) }} kind="active" flex={activeFlex} testID={`${testIDPrefix}-active`} />
      <Zone period={next} kind="next" flex={1} testID={`${testIDPrefix}-next`} />
      <PeriodPickerSheet
        visible={pickerOpen}
        value={active.monthKey}
        years={picker.years}
        isSelectable={picker.isSelectable}
        onCancel={() => setPickerOpen(false)}
        onConfirm={(monthKey) => {
          setPickerOpen(false);
          picker.onSelect(monthKey);
        }}
        testIDPrefix={`${testIDPrefix}-picker`}
      />
    </View>
  );
}

function Zone({ period, kind, flex, testID }: { period: NavigatorPeriod; kind: 'prev' | 'active' | 'next'; flex: number; testID: string }) {
  const [width, setWidth] = useState<number | null>(null);
  const isActive = kind === 'active';
  const baseSize = isActive ? ACTIVE_FONT_SIZE : SIDE_FONT_SIZE;
  const fontSize = width ? fitFontSize(period.label, width - 4, baseSize) : baseSize;
  const disabled = !period.onPress;
  return (
    <TouchableOpacity
      style={[styles.zone, { flex }]}
      onPress={period.onPress}
      disabled={disabled}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessibilityRole="button"
      accessibilityLabel={isActive ? `${period.label}, choisir une période` : period.label}
      testID={testID}
    >
      <Text
        style={[isActive ? styles.activeLabel : styles.sideLabel, { fontSize }, disabled && !isActive && styles.sideLabelDisabled]}
        numberOfLines={1}
        testID={`${testID}-label`}
      >
        {period.label}
      </Text>
      <View style={[styles.underline, !isActive && styles.underlineHidden]} />
    </TouchableOpacity>
  );
}

function monthName(month: number): string {
  const label = new Date(Date.UTC(2000, month - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Bottom sheet compact "Choisir une période" : mois + année, Annuler | Afficher. */
export function PeriodPickerSheet({
  visible,
  value,
  years,
  isSelectable,
  onCancel,
  onConfirm,
  testIDPrefix,
}: {
  visible: boolean;
  value: string;
  years: number[];
  isSelectable?: (monthKey: string) => boolean;
  onCancel: () => void;
  onConfirm: (monthKey: string) => void;
  testIDPrefix: string;
}) {
  const bottomInset = useBottomInset();
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const [month, setMonth] = useState(Number(value.slice(5, 7)));
  useEffect(() => {
    if (visible) {
      setYear(Number(value.slice(0, 4)));
      setMonth(Number(value.slice(5, 7)));
    }
  }, [visible, value]);

  if (!visible) return null;
  const selectable = (y: number, m: number) => !isSelectable || isSelectable(monthKeyOf(y, m));
  const canConfirm = selectable(year, month);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>
      <ScrollView style={styles.sheet} contentContainerStyle={{ paddingBottom: bottomInset }} testID={testIDPrefix}>
        <Text style={styles.sheetTitle}>Choisir une période</Text>

        <Text style={styles.sheetSectionLabel}>Mois</Text>
        <View style={styles.chipGrid}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
            const enabled = selectable(year, m);
            const selected = m === month;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.chip, styles.monthChip, selected && styles.chipSelected]}
                onPress={() => setMonth(m)}
                disabled={!enabled}
                accessibilityState={{ selected, disabled: !enabled }}
                testID={`${testIDPrefix}-month-${m}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected, !enabled && styles.chipTextDisabled]} numberOfLines={1}>
                  {monthName(m)}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.sheetSectionLabel}>Année</Text>
        <View style={styles.chipGrid}>
          {years.map((y) => {
            const selected = y === year;
            return (
              <TouchableOpacity
                key={y}
                style={[styles.chip, styles.yearChip, selected && styles.chipSelected]}
                onPress={() => setYear(y)}
                accessibilityState={{ selected }}
                testID={`${testIDPrefix}-year-${y}`}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{y}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {!canConfirm && (
          <Text style={styles.unavailable} testID={`${testIDPrefix}-unavailable`}>
            Cette période n'est pas disponible avec l'horizon affiché.
          </Text>
        )}

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.cancel} onPress={onCancel} testID={`${testIDPrefix}-cancel`}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirm, !canConfirm && styles.confirmDisabled]}
            onPress={() => onConfirm(monthKeyOf(year, month))}
            disabled={!canConfirm}
            testID={`${testIDPrefix}-confirm`}
          >
            <Text style={styles.confirmText}>Afficher</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch' },
  // Toute la zone est tactile (≥ 46 dp de haut), pas seulement le texte. Pas
  // de padding horizontal : les zones doivent tomber exactement sur les
  // colonnes du Planning (même flex que gridMonthCol).
  zone: { minHeight: ZONE_MIN_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontFamily: fontFamily.sansSemiBold, color: colors.textSecondary, letterSpacing: 0.3, textAlign: 'center' },
  sideLabelDisabled: { color: colors.textPlaceholder },
  activeLabel: { fontFamily: fontFamily.sansExtraBold, color: colors.textPrimary, letterSpacing: 0.3, textAlign: 'center' },
  underline: { width: 22, height: 2, borderRadius: 1, backgroundColor: colors.primary, marginTop: 4 },
  underlineHidden: { backgroundColor: 'transparent' },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: {
    flexGrow: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl + 6,
    borderTopRightRadius: radius.xl + 6,
    padding: spacing.xl,
    maxHeight: '85%',
  },
  sheetTitle: { ...typography.sectionTitle, marginBottom: spacing.md },
  sheetSectionLabel: { ...typography.caption, fontWeight: '700', color: colors.textSecondary, marginBottom: spacing.xs, marginTop: spacing.sm },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, alignItems: 'center', minHeight: 40, justifyContent: 'center' },
  monthChip: { width: '32%' },
  yearChip: { paddingHorizontal: spacing.md },
  chipSelected: { backgroundColor: colors.surfaceActive },
  chipText: { ...typography.body, fontSize: 13, color: colors.textSecondary },
  chipTextSelected: { color: colors.primaryDark, fontWeight: '800' },
  chipTextDisabled: { color: colors.textPlaceholder },
  unavailable: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancel: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.surfaceSecondary },
  cancelText: { ...typography.body, fontWeight: '700', color: colors.textSecondary },
  confirm: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.primary },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { ...typography.body, fontWeight: '700', color: colors.textOnPrimary },
});
