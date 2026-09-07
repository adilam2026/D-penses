import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import * as api from '../../api/client';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

interface Provision {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
}

interface ItemState {
  included: boolean;
  amount: string;
  unknown: boolean;
  dueDate: string;
}

interface ExtraItem {
  label: string;
  amount: string;
  unknown: boolean;
  dueDate: string;
}

function newItem(dueDate: string, included = true): ItemState {
  return { included, amount: '', unknown: false, dueDate };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const DEFAULT_POSTES = ['Transport', 'Hôtel', 'Alimentation', 'Activités', 'Imprévus'];

/**
 * Assistant « Voyage » (§39/40 cadrage V1) — atomique : POST /travel-wizard crée
 * 1 FinancialPlan(travel) + N ChargePlan + N Deadline en une seule transaction
 * (Option B, décision utilisateur), jamais un enchaînement d'appels séparés qui
 * pourrait laisser un plan partiellement créé après une coupure réseau.
 */
export function TravelWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [destination, setDestination] = useState('');
  const [periodStart, setPeriodStart] = useState(todayIso());
  const [periodEnd, setPeriodEnd] = useState(todayIso());

  const [provisions, setProvisions] = useState<Provision[]>([]);
  const [linkedProvisionId, setLinkedProvisionId] = useState<string | null>(null);

  const [postes, setPostes] = useState<Record<string, ItemState>>(
    Object.fromEntries(DEFAULT_POSTES.map((label) => [label, newItem(todayIso(), label !== 'Imprévus')])),
  );
  const [autres, setAutres] = useState<ExtraItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listProvisions().then(setProvisions);
  }, []);

  function updatePoste(label: string, value: ItemState) {
    setPostes((prev) => ({ ...prev, [label]: value }));
  }

  function buildItems(): api.TravelWizardItem[] {
    const items: api.TravelWizardItem[] = [];
    for (const label of DEFAULT_POSTES) {
      const item = postes[label];
      if (!item.included) continue;
      items.push({
        label,
        amount: item.unknown ? null : Number(item.amount.replace(',', '.')) || null,
        dueDate: item.dueDate,
      });
    }
    for (const extra of autres) {
      if (!extra.label.trim()) continue;
      items.push({
        label: extra.label.trim(),
        amount: extra.unknown ? null : Number(extra.amount.replace(',', '.')) || null,
        dueDate: extra.dueDate,
      });
    }
    return items;
  }

  const items = buildItems();
  const total = items.reduce((sum, it) => sum + (it.amount ?? 0), 0);

  async function onSubmit() {
    setError(null);
    if (items.length === 0) {
      setError('Ajoutez au moins un poste de dépense');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitTravelWizard({
        label: `Voyage${destination.trim() ? ` — ${destination.trim()}` : ''}`,
        destination: destination.trim() || undefined,
        periodStart,
        periodEnd,
        linkedProvisionId: linkedProvisionId ?? undefined,
        items,
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Nouveau plan Voyage</Text>
        <Text style={styles.intro}>Estimez le coût de votre voyage poste par poste — chaque poste devient une échéance suivie séparément.</Text>

        <Text style={styles.sectionLabel}>Destination (optionnel)</Text>
        <TextInput style={styles.input} placeholder="ex. Rome" value={destination} onChangeText={setDestination} onFocus={handleFocus} />

        <Text style={styles.sectionLabel}>Dates du voyage</Text>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <DateField label="Début" value={periodStart} onChange={setPeriodStart} />
          </View>
          <View style={{ flex: 1 }}>
            <DateField label="Fin" value={periodEnd} onChange={setPeriodEnd} />
          </View>
        </View>

        {provisions.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>Lier une enveloppe existante (optionnel)</Text>
            <Text style={styles.hint}>Purement informatif — la couverture réelle se calcule ensuite ligne par ligne.</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity style={[styles.chip, linkedProvisionId === null && styles.chipActive]} onPress={() => setLinkedProvisionId(null)}>
                <Text style={[styles.chipText, linkedProvisionId === null && styles.chipTextActive]}>Aucune</Text>
              </TouchableOpacity>
              {provisions.map((p) => (
                <TouchableOpacity key={p.id} style={[styles.chip, linkedProvisionId === p.id && styles.chipActive]} onPress={() => setLinkedProvisionId(p.id)}>
                  <Text style={[styles.chipText, linkedProvisionId === p.id && styles.chipTextActive]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={styles.sectionLabel}>Postes de dépense</Text>
        {DEFAULT_POSTES.map((label) => {
          const item = postes[label];
          return (
            <View key={label} style={styles.posteBlock}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{label}</Text>
                <Switch value={item.included} onValueChange={(included) => updatePoste(label, { ...item, included })} />
              </View>
              {item.included && (
                <>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabelSmall}>Je ne connais pas encore le montant</Text>
                    <Switch value={item.unknown} onValueChange={(unknown) => updatePoste(label, { ...item, unknown })} />
                  </View>
                  {!item.unknown && (
                    <TextInput
                      style={styles.input}
                      placeholder="Montant (DH)"
                      keyboardType="decimal-pad"
                      value={item.amount}
                      onChangeText={(amount) => updatePoste(label, { ...item, amount })}
                      onFocus={handleFocus}
                    />
                  )}
                  <DateField value={item.dueDate} onChange={(dueDate) => updatePoste(label, { ...item, dueDate })} />
                </>
              )}
            </View>
          );
        })}

        <Text style={styles.sectionLabel}>Autres postes</Text>
        {autres.map((extra, i) => (
          <View key={i} style={styles.extraBlock}>
            <TextInput
              style={styles.input}
              placeholder="Libellé (ex. Visa, Assurance voyage)"
              value={extra.label}
              onChangeText={(label) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, label } : e)))}
              onFocus={handleFocus}
            />
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabelSmall}>Je ne connais pas encore le montant</Text>
              <Switch
                value={extra.unknown}
                onValueChange={(unknown) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, unknown } : e)))}
              />
            </View>
            {!extra.unknown && (
              <TextInput
                style={styles.input}
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                value={extra.amount}
                onChangeText={(amount) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, amount } : e)))}
                onFocus={handleFocus}
              />
            )}
            <DateField value={extra.dueDate} onChange={(dueDate) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, dueDate } : e)))} />
          </View>
        ))}
        <TouchableOpacity
          style={styles.addExtraButton}
          onPress={() => setAutres((prev) => [...prev, { label: '', amount: '', unknown: false, dueDate: periodStart }])}
        >
          <Text style={styles.addExtraButtonText}>+ Ajouter un poste</Text>
        </TouchableOpacity>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Budget connu estimé</Text>
          <Text style={styles.totalValue}>{total.toLocaleString('fr-FR')} DH</Text>
          <Text style={styles.totalMeta}>{items.length} poste(s) inclus</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Créer le plan Voyage</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.xxl, paddingTop: 40 },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  intro: { fontSize: 13, color: colors.textSecondary, lineHeight: 19, marginBottom: spacing.lg },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 12 },
  hint: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: spacing.sm,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.textPrimary },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  posteBlock: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  toggleLabelSmall: { fontSize: 12, color: colors.textSecondary, flex: 1, marginRight: spacing.sm },
  extraBlock: { marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  addExtraButton: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  addExtraButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  totalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, marginTop: 12, marginBottom: spacing.lg },
  totalLabel: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  totalValue: { fontSize: 24, fontWeight: '800', color: colors.textPrimary, marginTop: 4 },
  totalMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 4 },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.xxl },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
