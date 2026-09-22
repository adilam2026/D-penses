import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useBottomInset } from '../ui/useBottomInset';
import { useTopInset } from '../ui/useTopInset';
import { colors, elevation, radius, spacing } from '../ui/theme';
import { HAMBURGER_SECTIONS as SECTIONS } from '../navigation/menuSections';

// Vague 3 §5 — menu structurel (☰), organisé par logique utilisateur. Les actions
// quotidiennes (dépense, revenu, paiement...) n'y figurent jamais : elles vivent
// dans la bottom sheet du bouton "+" central (§3).
// Architecture Web v3 §3/§11 — SECTIONS déplacé vers menuSections.ts (source
// partagée avec la Sidebar Web) : contenu identique, extraction mécanique.

/** Menu ☰ (Vague 3 §1/§5) — remplace l'onglet "Plus" devenu fourre-tout. */
export function HamburgerMenuScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const topInset = useTopInset();
  const { signOut } = useAuth();
  // Convergence V6 §8 — "Rejoindre un foyer" ne doit apparaître que si cela a
  // du sens pour l'utilisateur courant, jamais inconditionnellement : un
  // utilisateur qui jongle déjà entre plusieurs foyers connaît déjà le
  // parcours (accessible via "Mes foyers" ci-dessous) — le CTA reste
  // pertinent surtout pour qui n'a encore qu'un seul foyer (≤1 membership),
  // même logique que le "Vos foyers" conditionnel de JoinHouseholdScreen.
  const [showJoinCta, setShowJoinCta] = useState(true);

  useFocusEffect(
    useCallback(() => {
      api
        .listHouseholdMemberships()
        .then((memberships: unknown[]) => setShowJoinCta(memberships.length <= 1))
        .catch(() => setShowJoinCta(true));
    }, []),
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset }}>
      <Text style={styles.title}>Menu</Text>

      {showJoinCta && (
        <TouchableOpacity
          testID="menu-join-household-cta"
          style={styles.joinHouseholdCta}
          onPress={() => navigation.navigate('JoinHousehold')}
        >
          <Ionicons name="person-add" size={20} color={colors.textOnPrimary} style={styles.rowIcon} />
          <Text style={styles.joinHouseholdCtaText}>Rejoindre un foyer</Text>
        </TouchableOpacity>
      )}

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.items.map((item) => (
            <TouchableOpacity key={item.route} style={styles.row} onPress={() => navigation.navigate(item.route)}>
              <Ionicons name={item.icon} size={20} color={colors.textPrimary} style={styles.rowIcon} />
              <Text style={styles.rowText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textPlaceholder} />
            </TouchableOpacity>
          ))}
        </View>
      ))}

      {/* Convergence V6 §8 — Déconnexion doit être une entrée de menu visible
          en bas (même gabarit que les autres lignes), jamais un simple lien
          flottant centré. */}
      <View style={styles.section}>
        <TouchableOpacity testID="menu-logout-row" style={[styles.row, styles.logoutRow]} onPress={signOut}>
          <Ionicons name="log-out-outline" size={20} color={colors.danger} style={styles.rowIcon} />
          <Text style={styles.logoutRowText}>Déconnexion</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
  joinHouseholdCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
    borderRadius: radius.lg,
    paddingVertical: 16,
    marginBottom: spacing.xl,
    ...elevation.card,
  },
  joinHouseholdCtaText: { fontSize: 16, fontWeight: '700', color: colors.textOnPrimary },
  section: { marginBottom: spacing.xl },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', marginBottom: spacing.sm, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.sm,
  },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  logoutRow: { marginBottom: spacing.xxl },
  logoutRowText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.danger },
});
