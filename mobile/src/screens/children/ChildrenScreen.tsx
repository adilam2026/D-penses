import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

/** Enfants (Lot 0, docs/03) — écran secondaire, prérequis au module scolaire (Lot 4). */
export function ChildrenScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChildren(await api.listChildren());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onCreate() {
    if (!firstName.trim() || !lastName.trim()) return;
    setCreating(true);
    try {
      await api.createChild({ firstName: firstName.trim(), lastName: lastName.trim() });
      setFirstName('');
      setLastName('');
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={children}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={
          !loading ? <Text style={styles.empty}>Ajoutez vos enfants pour suivre leurs frais (scolarité, activités...) séparément.</Text> : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('ChildCosts', { id: item.id })}>
            <Text style={styles.rowName}>
              {item.firstName} {item.lastName}
            </Text>
            <Text style={styles.rowLink}>Coûts →</Text>
          </TouchableOpacity>
        )}
        contentContainerStyle={{ paddingBottom: spacing.sm }}
      />

      <View style={[styles.createBox, { paddingBottom: bottomInset }]}>
        <Text style={styles.sectionLabel}>Ajouter un enfant</Text>
        <View style={styles.createRow}>
          <FormField testID="child-firstname-input" containerStyle={styles.createField} placeholder="Prénom" value={firstName} onChangeText={setFirstName} />
          <FormField testID="child-lastname-input" containerStyle={styles.createField} placeholder="Nom" value={lastName} onChangeText={setLastName} />
          <TouchableOpacity style={styles.addButton} onPress={onCreate} disabled={creating} testID="child-create-submit">
            {creating ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.addButtonText}>+</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: spacing.md, paddingHorizontal: spacing.lg },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  rowLink: { fontSize: 12, color: colors.textSecondary },
  createBox: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.sm },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  createRow: { flexDirection: 'row', alignItems: 'center' },
  createField: { flex: 1, marginRight: spacing.sm, marginBottom: 0 },
  addButton: { backgroundColor: colors.primary, width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: colors.textOnPrimary, fontSize: 20, fontWeight: '700' },
});
