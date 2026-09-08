import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { FREQUENCY_LABEL } from '../../ui/frequency';
import { colors, elevation, radius, spacing } from '../../ui/theme';

interface NextDeadline {
  id: string;
  dueDate: string;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | string | null | undefined;
}

interface ChargePlan {
  id: string;
  label: string;
  recurrenceRule: string | null;
  status: 'actif' | 'inactif';
  deadlines: NextDeadline[];
}

const STATUS_LABEL: Record<string, string> = { inconnu: 'Inconnu', estime: 'Estimé', confirme: 'Confirmé' };

// R6.2 (§2, correctif NaN DH) : v peut être null (montant inconnu, cas normal)
// OU undefined (champ absent de la réponse — jamais un cas normal, mais ne
// doit RIEN afficher plutôt que "NaN DH"/Number(undefined)) — jamais rendu
// tel quel : Number.isFinite() rejette explicitement NaN/Infinity.
function n(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

/**
 * Charges récurrentes (recette post-Vague 3 §6/§7) — liste compacte des
 * ChargePlan (une ligne = une charge + sa prochaine échéance ouverte, jamais
 * une carte de 3-4 lignes), séparée de la création (§7 : bouton dédié →
 * CreateChargeScreen, jamais un formulaire permanent affiché sous la liste).
 * Les charges arrêtées (status=inactif, §4) restent visibles et gérables —
 * jamais une entrée fantôme — mais repliées par défaut pour ne pas encombrer.
 */
export function ChargesScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [plans, setPlans] = useState<ChargePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlans(await api.listChargePlans());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const active = plans.filter((p) => p.status === 'actif');
  const inactive = plans.filter((p) => p.status === 'inactif');

  function renderRow(p: ChargePlan) {
    const next = p.deadlines[0];
    return (
      <TouchableOpacity
        key={p.id}
        testID={`charge-row-${p.id}`}
        style={styles.row}
        onPress={() => navigation.navigate('ChargePlanDetail', { id: p.id })}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {p.label}
          </Text>
          <Text style={styles.rowMeta}>
            {p.recurrenceRule ? FREQUENCY_LABEL[p.recurrenceRule] : 'Ponctuel'}
            {next ? ` · ${formatShortDate(next.dueDate)} · ${STATUS_LABEL[next.amountStatus]}` : ' · Aucune échéance ouverte'}
          </Text>
        </View>
        {next && (() => {
          const amount = n(next.resteAPayer);
          // R6.2 (§2) : jamais NaN/N/A pour un montant connu, "Montant inconnu"
          // explicite si l'échéance n'a réellement aucun montant (amountStatus
          // inconnu) — jamais une case vide silencieuse qui pourrait faire
          // croire à un oubli d'affichage plutôt qu'à un montant non renseigné.
          if (amount !== null) {
            return <Text style={styles.rowAmount}>{amount.toLocaleString('fr-FR')} DH</Text>;
          }
          if (next.amountStatus === 'inconnu') {
            return <Text style={styles.rowAmountUnknown}>Montant inconnu</Text>;
          }
          return null;
        })()}
      </TouchableOpacity>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      <Text style={styles.intro}>Vos dépenses récurrentes (loyer, internet, école...), anticipées automatiquement.</Text>

      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>CHARGES RÉCURRENTES</Text>
        <TouchableOpacity testID="add-charge-button" onPress={() => navigation.navigate('CreateCharge')}>
          <Text style={styles.addLink}>+ Ajouter une charge</Text>
        </TouchableOpacity>
      </View>

      {loading && plans.length === 0 ? (
        <ActivityIndicator />
      ) : active.length === 0 ? (
        <Text style={styles.empty}>Aucune charge récurrente. Ajoutez-en une ci-dessus.</Text>
      ) : (
        active.map(renderRow)
      )}

      {inactive.length > 0 && (
        <>
          <TouchableOpacity testID="toggle-inactive-charges" style={styles.inactiveToggle} onPress={() => setShowInactive((v) => !v)}>
            <Text style={styles.inactiveToggleText}>
              {showInactive ? 'Masquer' : 'Voir'} les charges arrêtées ({inactive.length})
            </Text>
          </TouchableOpacity>
          {showInactive && inactive.map(renderRow)}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5 },
  addLink: { color: colors.success, fontSize: 13, fontWeight: '700' },
  empty: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  rowMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginLeft: spacing.sm },
  rowAmountUnknown: { fontSize: 12, fontStyle: 'italic', color: colors.textSecondary, marginLeft: spacing.sm },
  inactiveToggle: { marginTop: 8, marginBottom: 4 },
  inactiveToggleText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
});
