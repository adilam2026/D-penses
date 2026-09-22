import React, { createContext, useContext, useMemo } from 'react';
import { DimensionValue, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useResponsiveLayout } from './useResponsiveLayout';

/**
 * Correction structurelle "formulaires étirés" — composant de layout PARTAGÉ,
 * natif ET web, utilisable par tout écran de formulaire de l'application
 * (jamais un maxWidth ajouté écran par écran). Un formulaire ne doit jamais
 * s'étirer jusqu'au bord de l'écran simplement parce que la largeur est
 * disponible : FormContainer plafonne sa largeur ; FormGrid répartit les
 * champs en colonnes SELON la largeur réelle (mobile 1 / tablette 2 / desktop
 * 2-3), jamais un nombre de colonnes fixe. Sur mobile, `maxWidth` est
 * systématiquement un no-op (largeur d'écran toujours inférieure) : AUCUNE
 * branche `Platform.OS==='web'` n'est nécessaire, un seul comportement pour
 * les deux plateformes.
 */

export const FORM_MAX_WIDTH_STANDARD = 850;
export const FORM_MAX_WIDTH_WIDE = 1000;
const GAP_H = 16;
const GAP_V = 16;

interface FormContainerProps {
  children: React.ReactNode;
  /** ≈800-900px pour un formulaire standard ; FORM_MAX_WIDTH_WIDE (1000) réservé aux formulaires réellement complexes. */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

export function FormContainer({ children, maxWidth = FORM_MAX_WIDTH_STANDARD, style }: FormContainerProps) {
  return <View style={[styles.container, { maxWidth }, style]}>{children}</View>;
}

interface FormGridColumns {
  mobile?: number;
  tablet?: number;
  desktop?: number;
}

const ColumnsContext = createContext(1);

interface FormGridProps {
  children: React.ReactNode;
  /** Colonnes par palier — défaut 1 / 2 / 3 (mobile / tablette / desktop). */
  columns?: FormGridColumns;
  style?: StyleProp<ViewStyle>;
}

export function FormGrid({ children, columns, style }: FormGridProps) {
  const { deviceClass } = useResponsiveLayout();
  const cols = useMemo(() => {
    if (deviceClass === 'desktop') return columns?.desktop ?? 3;
    if (deviceClass === 'tablet') return columns?.tablet ?? 2;
    return columns?.mobile ?? 1;
  }, [deviceClass, columns?.desktop, columns?.tablet, columns?.mobile]);

  return (
    <ColumnsContext.Provider value={cols}>
      <View style={[styles.grid, { marginHorizontal: -GAP_H / 2, marginBottom: -GAP_V }, style]}>{children}</View>
    </ColumnsContext.Provider>
  );
}

interface FormGridItemProps {
  children: React.ReactNode;
  /** Nombre de colonnes occupées (ex. le champ Note sur 2 colonnes) — automatiquement plafonné au nombre de colonnes courant (donc 100% sur mobile). */
  span?: number;
  style?: StyleProp<ViewStyle>;
}

export function FormGridItem({ children, span = 1, style }: FormGridItemProps) {
  const cols = useContext(ColumnsContext);
  const effectiveSpan = Math.max(1, Math.min(span, cols));
  const widthPct = `${(100 * effectiveSpan) / cols}%` as DimensionValue;
  return (
    <View style={[styles.cell, { flexBasis: widthPct, maxWidth: widthPct, paddingHorizontal: GAP_H / 2, paddingBottom: GAP_V }, style]}>
      {children}
    </View>
  );
}

interface FormActionsProps {
  children: React.ReactNode;
  align?: 'left' | 'right';
  style?: StyleProp<ViewStyle>;
}

export function FormActions({ children, align = 'left', style }: FormActionsProps) {
  return <View style={[styles.actions, { justifyContent: align === 'left' ? 'flex-start' : 'flex-end' }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', alignSelf: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { flexGrow: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
