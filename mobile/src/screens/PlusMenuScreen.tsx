import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useBottomInset } from '../ui/useBottomInset';

interface MenuItem {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
}

const SECTIONS: { title: string; items: MenuItem[] }[] = [
  {
    title: 'Finances',
    items: [
      { label: 'Comptes', icon: 'card-outline', route: 'Accounts' },
      { label: 'Revenus', icon: 'trending-up-outline', route: 'Income' },
      { label: 'Charges récurrentes', icon: 'receipt-outline', route: 'Charges' },
      { label: 'Budgets variables', icon: 'pie-chart-outline', route: 'Budgets' },
    ],
  },
  {
    title: 'Famille',
    items: [{ label: 'Enfants', icon: 'people-outline', route: 'Children' }],
  },
  {
    title: 'Mes projets',
    items: [
      { label: 'Plans financiers', icon: 'folder-outline', route: 'FinancialPlans' },
      { label: 'Voyages', icon: 'airplane-outline', route: 'TravelWizard' },
      { label: 'Frais scolaires', icon: 'school-outline', route: 'SchoolWizard' },
      { label: 'Objectifs', icon: 'flag-outline', route: 'Goals' },
    ],
  },
  {
    title: 'Anticiper',
    items: [
      { label: 'Projection', icon: 'analytics-outline', route: 'Projection' },
      { label: 'Simulateur — Puis-je me le permettre ?', icon: 'help-buoy-outline', route: 'Simulator' },
    ],
  },
];

/** Menu « Plus » (docs/03 §J.4) — Comptes et Budgets restent des écrans secondaires, jamais en navigation principale (§37 risque L.3). */
export function PlusMenuScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { signOut } = useAuth();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: bottomInset }}>
      <Text style={styles.title}>Plus</Text>

      {SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.items.map((item) => (
            <TouchableOpacity key={item.route} style={styles.row} onPress={() => navigation.getParent()?.navigate(item.route)}>
              <Ionicons name={item.icon} size={20} color="#172436" style={styles.rowIcon} />
              <Text style={styles.rowText}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color="#9AA0A6" />
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
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 56, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 20 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: '#6B747C', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600', color: '#172436' },
  logout: { marginTop: 8, alignItems: 'center' },
  logoutText: { color: '#B3261E', fontSize: 13, fontWeight: '600' },
});
