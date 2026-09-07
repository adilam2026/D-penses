import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';

interface Pocket {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  isProtected: boolean;
  currentAmount: number;
  targetAmount: number | null;
}

interface Provision {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  currentAmount: number;
}

type Envelope = {
  id: string;
  kind: 'pocket' | 'provision';
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  currentAmount: number;
  targetAmount: number | null;
  isProtected: boolean;
};

// Vague 2 §11 — une seule entrée pour l'utilisateur ("Enveloppes"), la nature
// (Réservation/Épargne/Épargne protégée) reste secondaire, affichée en badge.
function natureLabel(e: Envelope): string {
  if (e.kind === 'provision') return 'Réservation';
  return e.isProtected ? 'Épargne protégée' : 'Épargne';
}

/**
 * Enveloppes (§27, unifié Vague 2 §11) — Provisions et Poches d'épargne dans une
 * même liste, jamais confondues avec un solde de compte bancaire (§2). Le badge
 * « protégée » (RG-047) n'a aucune action associée : rien ne la mobilise
 * automatiquement (§22). Objectifs reste un concept séparé (accessible ci-dessous).
 */
export function EpargneScreen() {
  const navigation = useNavigation<any>();
  const [pockets, setPockets] = useState<Pocket[]>([]);
  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, pr] = await Promise.all([api.listPockets(), api.listProvisions()]);
      setPockets(p);
      setProvisions(pr);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const envelopes: Envelope[] = useMemo(() => {
    const fromProvisions: Envelope[] = provisions.map((p) => ({
      id: p.id,
      kind: 'provision',
      name: p.name,
      allocationMode: p.allocationMode,
      currentAmount: p.currentAmount,
      targetAmount: null,
      isProtected: false,
    }));
    const fromPockets: Envelope[] = pockets.map((p) => ({
      id: p.id,
      kind: 'pocket',
      name: p.name,
      allocationMode: p.allocationMode,
      currentAmount: p.currentAmount,
      targetAmount: p.targetAmount,
      isProtected: p.isProtected,
    }));
    return [...fromProvisions, ...fromPockets].sort((a, b) => a.name.localeCompare(b.name));
  }, [provisions, pockets]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}>
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.goalsButton} onPress={() => navigation.navigate('Goals')}>
          <Text style={styles.goalsButtonText}>Objectifs</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Toutes les enveloppes</Text>
        <TouchableOpacity onPress={() => navigation.navigate('CreatePocket', {})}>
          <Text style={styles.addLink}>+ Enveloppe</Text>
        </TouchableOpacity>
      </View>
      {envelopes.length === 0 && !loading ? (
        <Text style={styles.empty}>Aucune enveloppe pour l'instant.</Text>
      ) : (
        envelopes.map((e) => (
          <TouchableOpacity key={`${e.kind}-${e.id}`} style={styles.card} onPress={() => navigation.navigate('PocketDetail', { kind: e.kind, id: e.id })}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{e.name}</Text>
              <Text style={styles.natureBadge}>{natureLabel(e)}</Text>
            </View>
            <Text style={styles.cardAmount}>
              {e.currentAmount.toLocaleString('fr-FR')} DH
              {e.targetAmount ? ` / ${e.targetAmount.toLocaleString('fr-FR')} DH` : ''}
            </Text>
            <Text style={styles.cardMeta}>{e.allocationMode === 'backed_by_account' ? 'Compte dédié' : 'Réservation virtuelle'}</Text>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  headerRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginBottom: spacing.lg },
  goalsButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: spacing.sm },
  goalsButtonText: { color: colors.textOnPrimary, fontSize: 12, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  addLink: { color: colors.success, fontSize: 13, fontWeight: '600' },
  empty: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: 10 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  natureBadge: { fontSize: 10, fontWeight: '700', color: colors.success, backgroundColor: colors.successLight, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  cardAmount: { fontSize: 18, fontWeight: '800', color: colors.textPrimary, marginTop: 6 },
  cardMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
});
