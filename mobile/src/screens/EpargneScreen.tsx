import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../api/client';
import { cached } from '../state/cache';
import { colors, radius, spacing, typography } from '../ui/theme';
import { formatDh } from '../ui/formatMoney';
import { HelpButton } from '../ui/HelpButton';
import { isSanteSubaccount } from '../ui/santeDetection';

interface Card {
  key: string;
  name: string;
  meta: string;
  amount: number;
  borderColor: string;
  extraLine?: string;
  onPress: () => void;
}

/**
 * Épargne (Checkpoint 2 §3) — sans curation cachée : tous les comptes de type
 * EPARGNE sans sous-compte, et TOUS les sous-comptes de TOUS les comptes
 * (enveloppes de réserve), y compris ceux sans objectif explicite.
 */
export function EpargneScreen() {
  const navigation = useNavigation<any>();
  const [accounts, setAccounts] = useState<api.AccountApi[] | null>(null);
  const [claims, setClaims] = useState<api.MedicalClaimApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const [accountsData, claimsData] = await Promise.all([
      cached('accounts', () => api.listAccounts(), 60_000, force),
      cached('medical-claims:all', () => api.listMedicalClaims(), 60_000, force),
    ]);
    setAccounts(accountsData);
    setClaims(claimsData);
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

  if (loading && !accounts) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const cards: Card[] = [];
  for (const account of accounts ?? []) {
    if (account.type === 'EPARGNE' && account.subaccounts.length === 0) {
      cards.push({
        key: account.id,
        name: account.name,
        meta: 'Compte bancaire',
        amount: account.balance,
        borderColor: colors.success,
        onPress: () => navigation.navigate('AccountDetail', { id: account.id }),
      });
    }
    for (const sub of account.subaccounts) {
      const sante = isSanteSubaccount(sub.name);
      const pendingCount = sante ? claims.filter((c) => c.subaccountId === sub.id && c.status === 'PENDING').length : 0;
      cards.push({
        key: sub.id,
        name: sub.name,
        meta: 'Disponible',
        amount: sub.balance,
        borderColor: sante ? colors.success : colors.primary,
        extraLine: pendingCount > 0 ? `${pendingCount} remboursement${pendingCount > 1 ? 's' : ''} en attente` : undefined,
        onPress: () => navigation.navigate(sante ? 'Health' : 'SubaccountDetail', { id: sub.id }),
      });
    }
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Épargne</Text>
          <Text style={styles.subtitle}>Comptes d'épargne et enveloppes de réserve du foyer.</Text>
        </View>
        <HelpButton
          title="Épargne"
          text="Retrouvez ici tous vos comptes d'épargne ainsi que les enveloppes réservées à l'intérieur de vos comptes courants (voiture, voyage, santé, scolarité…)."
        />
      </View>

      {cards.length === 0 ? (
        <Text style={styles.emptyText}>Aucune épargne pour l'instant.</Text>
      ) : (
        <View style={styles.grid}>
          {cards.map((card) => (
            <View key={card.key} style={styles.cardSlot}>
              <TouchableOpacity style={[styles.card, { borderLeftColor: card.borderColor }]} onPress={card.onPress} testID={`epargne-card-${card.key}`}>
                <Text style={styles.cardName} numberOfLines={1}>
                  {card.name}
                </Text>
                <Text style={styles.cardMeta}>{card.meta}</Text>
                <Text style={styles.cardAmount}>{formatDh(card.amount)}</Text>
                {card.extraLine ? <Text style={styles.cardExtra}>{card.extraLine}</Text> : null}
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.lg },
  title: { ...typography.screenTitle },
  subtitle: { ...typography.bodySecondary, marginTop: spacing.xs, maxWidth: 260 },
  emptyText: { ...typography.bodySecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs },
  cardSlot: { width: '50%', paddingHorizontal: spacing.xs, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderLeftWidth: 4,
    padding: spacing.md,
  },
  cardName: { ...typography.body, fontWeight: '700' },
  cardMeta: { ...typography.caption, marginTop: 2 },
  cardAmount: { ...typography.amountSecondary, marginTop: spacing.sm },
  cardExtra: { ...typography.caption, color: colors.warning, marginTop: spacing.xs },
});
