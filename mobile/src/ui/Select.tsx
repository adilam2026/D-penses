import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from './useBottomInset';
import { colors, radius, spacing, typography } from './theme';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SelectProps {
  label?: string;
  placeholder?: string;
  value: string | null;
  options: SelectOption[];
  onChange: (value: string) => void;
  testID?: string;
  /** Recherche affichée à partir de ce nombre d'options (§2 : "si la liste devient longue, prévoir recherche"). */
  searchThreshold?: number;
  disabled?: boolean;
}

/**
 * Sélecteur compact (recette post-Vague 3 §2/§3) : remplace les longues listes
 * de chips permanentes (catégorie, type, sous-type, compte, enfant, fréquence)
 * par un champ "[ Sélectionner… ▼ ]" ouvrant une liste dédiée (modal), avec
 * recherche au-delà d'un seuil. Un seul composant partagé — jamais une
 * ré-implémentation par écran (§10).
 */
export function Select({ label, placeholder = 'Sélectionner…', value, options, onChange, testID, searchThreshold = 8, disabled }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // TXT réf. §M2 — jamais un paddingBottom codé en dur : la barre système
  // Android (gestes ou 3 boutons) ne doit jamais recouvrir la dernière option.
  const bottomInset = useBottomInset(24);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        testID={testID}
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        disabled={disabled}
      >
        <Text style={[styles.fieldText, !selected && styles.fieldPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close} testID={testID ? `${testID}-modal` : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: bottomInset }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label ?? placeholder}</Text>
            <TouchableOpacity onPress={close}>
              <Text style={styles.sheetClose}>Fermer</Text>
            </TouchableOpacity>
          </View>
          {options.length > searchThreshold && (
            <TextInput
              style={styles.search}
              placeholder="Rechercher…"
              placeholderTextColor={colors.textPlaceholder}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              testID={testID ? `${testID}-search` : undefined}
            />
          )}
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.value}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>Aucun résultat.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity
                testID={testID ? `${testID}-option-${item.value}` : undefined}
                style={[styles.option, item.value === value && styles.optionActive]}
                onPress={() => {
                  onChange(item.value);
                  close();
                }}
              >
                <Text style={[styles.optionText, item.value === value && styles.optionTextActive]}>{item.label}</Text>
                {item.sublabel ? <Text style={styles.optionSublabel}>{item.sublabel}</Text> : null}
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...typography.sectionLabel, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  fieldDisabled: { opacity: 0.5 },
  fieldText: { ...typography.body, flex: 1, marginRight: spacing.sm },
  fieldPlaceholder: { color: colors.textPlaceholder },
  chevron: { fontSize: 12, color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: radius.xl + 6, borderTopRightRadius: radius.xl + 6, maxHeight: '70%' },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sheetTitle: { ...typography.sectionTitle },
  sheetClose: { fontSize: 13, fontWeight: '600', color: colors.primary },
  search: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { paddingHorizontal: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  option: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.divider },
  optionActive: { backgroundColor: colors.surfaceActive },
  optionText: { ...typography.body },
  optionTextActive: { fontWeight: '700', color: colors.primary },
  optionSublabel: { ...typography.caption, marginTop: 2 },
});
