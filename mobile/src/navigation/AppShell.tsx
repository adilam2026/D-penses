import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { useTopInset } from '../ui/useTopInset';
import { colors, spacing, typography } from '../ui/theme';

/**
 * Shell mobile persistant (validation Checkpoint 2 §5) — "Finance Maison" +
 * nom du foyer + ☰, visible sur les 4 onglets (Accueil/Planning/Épargne/
 * Ajouter), jamais un bouton menu isolé recréé écran par écran.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const navigation = useNavigation<any>();
  const topInset = useTopInset(12);
  const [householdName, setHouseholdName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      cached('household', () => api.getMyHousehold(), 5 * 60_000)
        .then((h: any) => setHouseholdName(h?.name ?? null))
        .catch(() => setHouseholdName(null));
    }, []),
  );

  return (
    <View style={styles.container}>
      <View style={[styles.bar, { paddingTop: topInset }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.brand}>Finance Maison</Text>
          {householdName ? <Text style={styles.household}>{householdName}</Text> : null}
        </View>
        <TouchableOpacity
          testID="app-shell-menu-button"
          onPress={() => navigation.navigate('Menu')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="menu" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  brand: { ...typography.sectionTitle },
  household: { ...typography.caption, marginTop: 1 },
  content: { flex: 1 },
});
