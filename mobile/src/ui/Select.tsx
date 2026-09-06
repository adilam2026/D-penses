import React, { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

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
        <View style={styles.sheet}>
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
  label: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    marginBottom: 8,
  },
  fieldDisabled: { opacity: 0.5 },
  fieldText: { fontSize: 14, color: '#172436', flex: 1, marginRight: 8 },
  fieldPlaceholder: { color: '#9AA0A6' },
  chevron: { fontSize: 12, color: '#6B747C' },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)' },
  sheet: { backgroundColor: '#F6F5F2', borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%', paddingBottom: 24 },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 10,
  },
  sheetTitle: { fontSize: 15, fontWeight: '700', color: '#172436' },
  sheetClose: { fontSize: 13, fontWeight: '600', color: '#2E7D5B' },
  search: {
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  list: { paddingHorizontal: 20 },
  empty: { color: '#6B747C', fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  option: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EDEBE6' },
  optionActive: { backgroundColor: '#EEF3F0' },
  optionText: { fontSize: 14, color: '#172436' },
  optionTextActive: { fontWeight: '700', color: '#2E7D5B' },
  optionSublabel: { fontSize: 11, color: '#6B747C', marginTop: 2 },
});
