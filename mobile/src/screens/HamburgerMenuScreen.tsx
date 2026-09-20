import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset }}>
      <Text style={styles.title}>Menu</Text>

      {/* CTA UX §18 — "Rejoindre un foyer" mis en avant en action principale,
          au-dessus de "Mon foyer" : réutilise la route "JoinHousehold"
          existante (formulaire "Rejoindre un nouveau foyer"), jamais de
          logique métier dupliquée. Toujours visible, même avec un foyer déjà
          actif (multi-foyers). */}
      <TouchableOpacity
        testID="menu-join-household-cta"
        style={styles.joinHouseholdCta}
        onPress={() => navigation.navigate('JoinHousehold')}
      >
        <Ionicons name="person-add" size={20} color={colors.textOnPrimary} style={styles.rowIcon} />
        <Text style={styles.joinHouseholdCtaText}>Rejoindre un foyer</Text>
      </TouchableOpacity>

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

      <TouchableOpacity style={styles.logout} onPress={signOut}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
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
  logout: { marginTop: spacing.sm, marginBottom: spacing.xxl, alignItems: 'center' },
  logoutText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
