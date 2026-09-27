import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { useTopInset } from '../ui/useTopInset';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';

/**
 * Nouvel Accueil Finance Maison — minimal, sans graphique ni KPI empilés :
 * le "disponible libre" (somme des non-affectés) domine l'écran, suivi de la
 * liste des comptes réels avec leurs sous-comptes. Aucun écran/composant de
 * l'ancienne application réutilisé (reset total, cf. archive/legacy-d-penses-2026-09-27).
 */
export function AccueilScreen() {
  const navigation = useNavigation<any>();
  const topInset = useTopInset();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const data = await cached('accounts', () => api.listAccounts(), 60_000, force);
    setAccounts(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  const disponibleLibre = (accounts ?? []).reduce((sum, a) => sum + a.nonAffecte, 0);

  if (loading && !accounts) {
    return (
      <View style={[styles.center, { paddingTop: topInset }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topInset }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Accueil</Text>
        <TouchableOpacity
          testID="accueil-menu-button"
          onPress={() => navigation.navigate('Menu')}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="menu" size={26} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Disponible libre</Text>
        <Text style={styles.heroAmount}>{formatDh(disponibleLibre)}</Text>
        <Text style={styles.heroCaption}>Somme du non-affecté de tous les comptes réels</Text>
      </View>

      <Text style={styles.sectionLabel}>COMPTES</Text>

      {(accounts ?? []).length === 0 && !loading && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Aucun compte pour l'instant.</Text>
        </View>
      )}

      {(accounts ?? []).map((account) => (
        <View key={account.id} style={styles.accountCard}>
          <View style={styles.accountHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName}>{account.name}</Text>
              {account.bank ? <Text style={styles.accountBank}>{account.bank}</Text> : null}
            </View>
            <Text style={styles.accountBalance}>{formatDh(account.balance)}</Text>
          </View>

          {account.subaccounts.length > 0 && (
            <View style={styles.subaccountsList}>
              {account.subaccounts.map((sub) => (
                <View key={sub.id} style={styles.subaccountRow}>
                  <Text style={styles.subaccountName}>{sub.name}</Text>
                  <Text style={styles.subaccountBalance}>{formatDh(sub.balance)}</Text>
                </View>
              ))}
              <View style={styles.subaccountRow}>
                <Text style={styles.nonAffecteLabel}>Non affecté</Text>
                <Text style={styles.nonAffecteValue}>{formatDh(account.nonAffecte)}</Text>
              </View>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.xl,
  },
  heroLabel: { color: colors.textOnPrimary, opacity: 0.8, fontSize: 13, fontWeight: '600', marginBottom: spacing.xs },
  heroAmount: { color: colors.textOnPrimary, fontSize: 34, fontWeight: '800' },
  heroCaption: { color: colors.textOnPrimary, opacity: 0.7, fontSize: 12, marginTop: spacing.xs },
  sectionLabel: { ...typography.sectionLabel, color: colors.textSecondary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, alignItems: 'center' },
  emptyText: { ...typography.bodySecondary },
  accountCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md },
  accountHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  accountName: { ...typography.sectionTitle },
  accountBank: { ...typography.caption, marginTop: 2 },
  accountBalance: { ...typography.amountSecondary },
  subaccountsList: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  subaccountRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  subaccountName: { ...typography.body },
  subaccountBalance: { ...typography.body, fontWeight: '600' },
  nonAffecteLabel: { ...typography.bodySecondary },
  nonAffecteValue: { ...typography.bodySecondary, fontWeight: '600' },
});
