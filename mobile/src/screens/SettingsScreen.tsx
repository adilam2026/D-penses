import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { HelpButton } from '../ui/HelpButton';

/**
 * Application → Paramètres (§14) — volontairement minimal : nom du foyer,
 * devise, éléments de session pertinents. "Ne crée pas une dizaine de
 * réglages artificiels" (spec) : aucun réglage inventé.
 */
export function SettingsScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();
  const [household, setHousehold] = useState<any>(null);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);

  const load = useCallback(async () => {
    const [h, meRaw] = await Promise.all([api.getMyHousehold(), api.getMe()]);
    setHousehold(h);
    const mine = (h.memberships ?? []).find((m: any) => m.userId === meRaw.sub);
    if (mine) setMe({ email: mine.user.email, name: [mine.user.firstName, mine.user.lastName].filter(Boolean).join(' ') });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ScrollView style={[styles.container, { paddingTop: topInset }]} contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomInset + spacing.xxl }}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Paramètres</Text>
        <HelpButton title="Paramètres" text="Informations de base sur votre foyer et votre session. Pour modifier vos comptes, catégories ou sous-comptes, utilisez les écrans dédiés dans le menu Organisation." />
      </View>

      {!household ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <>
          <Text style={styles.sectionLabel}>FOYER</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Nom</Text>
              <Text style={styles.rowValue}>{household.name}</Text>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <Text style={styles.rowLabel}>Devise</Text>
              <Text style={styles.rowValue}>{household.currency ?? 'MAD'}</Text>
            </View>
          </View>

          {me ? (
            <>
              <Text style={styles.sectionLabel}>SESSION</Text>
              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Connecté en tant que</Text>
                  <Text style={styles.rowValue}>{me.name || me.email}</Text>
                </View>
                <View style={[styles.row, styles.rowBorder]}>
                  <Text style={styles.rowLabel}>Email</Text>
                  <Text style={styles.rowValue}>{me.email}</Text>
                </View>
              </View>
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  title: { ...typography.screenTitle, flex: 1 },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, marginTop: spacing.md, letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.divider },
  rowLabel: { ...typography.body },
  rowValue: { ...typography.body, fontWeight: '600', color: colors.textSecondary },
});
