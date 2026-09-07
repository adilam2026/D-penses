import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing } from '../ui/theme';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

// Vague 3 §5 — menu structurel (☰), organisé par logique utilisateur. Les actions
// quotidiennes (dépense, revenu, paiement...) n'y figurent jamais : elles vivent
// dans la bottom sheet du bouton "+" central (§3).
const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Mon foyer',
    items: [
      { label: 'Comptes', icon: 'card-outline', route: 'Accounts' },
      { label: 'Membres du foyer', icon: 'people-circle-outline', route: 'HouseholdMembers' },
      { label: 'Enfants', icon: 'people-outline', route: 'Children' },
    ],
  },
  {
    title: 'Mes finances',
    items: [
      { label: 'Revenus réguliers', icon: 'trending-up-outline', route: 'Income' },
      { label: 'Charges récurrentes', icon: 'receipt-outline', route: 'Charges' },
      { label: 'Budgets', icon: 'pie-chart-outline', route: 'Budgets' },
      { label: 'Enveloppes', icon: 'wallet-outline', route: 'Enveloppes' },
      { label: 'Objectifs', icon: 'flag-outline', route: 'Goals' },
    ],
  },
  {
    title: 'Mes plans',
    items: [
      { label: 'Plans financiers', icon: 'folder-outline', route: 'FinancialPlans' },
      { label: 'Frais scolaires', icon: 'school-outline', route: 'SchoolWizard' },
      { label: 'Voyages', icon: 'airplane-outline', route: 'TravelWizard' },
    ],
  },
  {
    title: 'Anticiper',
    items: [
      { label: 'Projection', icon: 'analytics-outline', route: 'Projection' },
      { label: 'Simulateur', icon: 'help-buoy-outline', route: 'Simulator' },
    ],
  },
  {
    title: 'Paramètres',
    items: [
      { label: 'Catégories', icon: 'pricetags-outline', route: 'Categories' },
      { label: 'Types de dépenses', icon: 'list-outline', route: 'CategoryTypes' },
      { label: 'Préférences', icon: 'options-outline', route: 'Preferences' },
      { label: 'Configuration du foyer', icon: 'home-outline', route: 'HouseholdConfig' },
      { label: 'Réinitialiser mes données financières', icon: 'trash-outline', route: 'ResetFinancialData' },
    ],
  },
];

/** Menu ☰ (Vague 3 §1/§5) — remplace l'onglet "Plus" devenu fourre-tout. */
export function HamburgerMenuScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { signOut } = useAuth();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: bottomInset }}>
      <Text style={styles.title}>Menu</Text>

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
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 56, paddingHorizontal: spacing.xl },
  title: { fontSize: 22, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.xl },
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
