import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../auth/AuthContext';
import { useTopInset } from '../ui/useTopInset';
import { useBottomInset } from '../ui/useBottomInset';
import { colors, radius, spacing, typography } from '../ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

interface MenuEntry {
  label: string;
  icon: IconName;
  onPress: () => void;
}

/**
 * Menu haut-droite Finance Maison — 4 sections nommées (MON FOYER / ORGANISATION /
 * APPLICATION / SESSION). Les entrées d'ORGANISATION/APPLICATION renvoient vers
 * des écrans encore à construire (Checkpoint 2+) : PlaceholderScreen, jamais un
 * ancien écran métier réutilisé.
 */
export function MenuScreen() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();
  const topInset = useTopInset();
  const bottomInset = useBottomInset();

  const sections: { title: string; entries: MenuEntry[] }[] = [
    {
      title: 'Mon foyer',
      entries: [
        { label: 'Membres', icon: 'people-outline', onPress: () => navigation.navigate('HouseholdMembers') },
        { label: 'Inviter', icon: 'person-add-outline', onPress: () => navigation.navigate('HouseholdMembers') },
      ],
    },
    {
      title: 'Organisation',
      entries: [
        { label: 'Comptes', icon: 'card-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Comptes' }) },
        { label: 'Épargne & sous-comptes', icon: 'wallet-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Épargne & sous-comptes' }) },
        { label: 'Catégories', icon: 'pricetags-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Catégories' }) },
        { label: 'Plans financiers', icon: 'folder-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Plans financiers' }) },
        { label: 'Mutuelle', icon: 'medkit-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Mutuelle' }) },
      ],
    },
    {
      title: 'Application',
      entries: [
        { label: 'Guide', icon: 'book-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Guide' }) },
        { label: 'Paramètres', icon: 'settings-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Paramètres' }) },
        { label: 'Réinitialiser les données', icon: 'refresh-outline', onPress: () => navigation.navigate('Placeholder', { title: 'Réinitialiser les données' }) },
      ],
    },
    {
      title: 'Session',
      entries: [{ label: 'Déconnexion', icon: 'log-out-outline', onPress: () => signOut() }],
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topInset }]}
      contentContainerStyle={{ paddingBottom: bottomInset + spacing.xxl }}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Menu</Text>
        <View style={{ width: 26 }} />
      </View>

      {sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title.toUpperCase()}</Text>
          <View style={styles.card}>
            {section.entries.map((entry, index) => (
              <TouchableOpacity
                key={entry.label}
                style={[styles.row, index < section.entries.length - 1 && styles.rowBorder]}
                onPress={entry.onPress}
              >
                <Ionicons name={entry.icon} size={20} color={colors.textSecondary} style={{ marginRight: spacing.md }} />
                <Text style={styles.rowLabel}>{entry.label}</Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textPlaceholder} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  headerTitle: { ...typography.screenTitle },
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  rowLabel: { ...typography.body, flex: 1 },
});
