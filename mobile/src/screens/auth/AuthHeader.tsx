import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, spacing } from '../../ui/theme';

/**
 * Identité Finance Maison en tête des écrans d'authentification : icône
 * maison dans une pastille corail clair + nom en Fraunces. `compact` :
 * version discrète (écran verrouillé, création du code, code oublié).
 */
export function AuthHeader({ compact = false }: { compact?: boolean }) {
  return (
    <View style={[styles.header, compact && styles.headerCompact]} testID="auth-header">
      <View style={[styles.badge, compact && styles.badgeCompact]}>
        <Ionicons name="home" size={compact ? 16 : 24} color={colors.primary} />
      </View>
      <Text style={[styles.brand, compact && styles.brandCompact]}>Finance Maison</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  headerCompact: { flexDirection: 'row', justifyContent: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  badge: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  badgeCompact: { width: 30, height: 30, borderRadius: 15, marginBottom: 0 },
  brand: { fontSize: 26, fontFamily: fontFamily.displayBold, color: colors.textPrimary },
  brandCompact: { fontSize: 16, fontFamily: fontFamily.display },
});
