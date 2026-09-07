import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing } from './theme';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  label?: string;
  placeholder?: string;
  value: string[];
  options: MultiSelectOption[];
  onChange: (values: string[]) => void;
  testID?: string;
  searchThreshold?: number;
}

/**
 * R6 finition UX/UI §2 — sélecteur multi-choix compact (enfants bénéficiaires,
 * etc.) : jamais une longue liste de chips brute dès que le foyer compte
 * plusieurs enfants. Même principe visuel que Select (champ + bottom sheet),
 * mais chaque option se coche/décoche sans fermer le sheet ; le champ fermé
 * affiche un résumé court (noms si peu nombreux, sinon "N sélectionné(s)").
 */
export function MultiSelect({ label, placeholder = 'Sélectionner…', value, options, onChange, testID, searchThreshold = 8 }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selectedLabels = options.filter((o) => value.includes(o.value)).map((o) => o.label);
  const summary = selectedLabels.length === 0 ? null : selectedLabels.length <= 2 ? selectedLabels.join(', ') : `${selectedLabels.length} sélectionné(s)`;

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity testID={testID} style={styles.field} onPress={() => setOpen(true)}>
        <Text style={[styles.fieldText, !summary && styles.fieldPlaceholder]} numberOfLines={1}>
          {summary ?? placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={close} testID={testID ? `${testID}-modal` : undefined}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label ?? placeholder}</Text>
            <TouchableOpacity testID={testID ? `${testID}-done` : undefined} onPress={close}>
              <Text style={styles.sheetClose}>Terminé</Text>
            </TouchableOpacity>
          </View>
          {options.length > searchThreshold && (
            <TextInput
              style={styles.search}
              placeholder="Rechercher…"
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
            renderItem={({ item }) => {
              const checked = value.includes(item.value);
              return (
                <TouchableOpacity
                  testID={testID ? `${testID}-option-${item.value}` : undefined}
                  style={styles.option}
                  onPress={() => toggle(item.value)}
                >
                  <View style={[styles.checkbox, checked && styles.checkboxChecked]}>{checked ? <Text style={styles.checkmark}>✓</Text> : null}</View>
                  <Text style={[styles.optionText, checked && styles.optionTextActive]}>{item.label}</Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.xs },
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
  fieldText: { fontSize: 14, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  fieldPlaceholder: { color: colors.textPlaceholder },
  chevron: { fontSize: 12, color: colors.textSecondary },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: { backgroundColor: colors.background, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%', paddingBottom: spacing.xxl },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 18,
    paddingBottom: 10,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sheetClose: { fontSize: 13, fontWeight: '600', color: colors.success },
  search: {
    marginHorizontal: spacing.xl,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  list: { paddingHorizontal: spacing.xl },
  empty: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: colors.success, borderColor: colors.success },
  checkmark: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '700' },
  optionText: { fontSize: 14, color: colors.textPrimary },
  optionTextActive: { fontWeight: '700' },
});
