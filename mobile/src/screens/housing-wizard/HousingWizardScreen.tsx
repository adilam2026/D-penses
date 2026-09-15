import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import * as api from '../../api/client';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

const NEW_HOUSING = '__new__';

const RECURRENCE_OPTIONS: { value: api.WizardRecurrenceRule; label: string }[] = [
  { value: 'ponctuel', label: 'Ponctuelle' },
  { value: 'hebdomadaire', label: 'Hebdomadaire' },
  { value: 'mensuel', label: 'Mensuelle' },
  { value: 'trimestriel', label: 'Trimestrielle' },
  { value: 'semestriel', label: 'Semestrielle' },
  { value: 'annuel', label: 'Annuelle' },
];

// guard-rail §11 — suggestions Plan Maison par catégorie. Périodicité par
// défaut uniquement (§7) : l'utilisateur peut TOUJOURS la changer.
interface PosteDef {
  key: string;
  label: string;
  defaultRule: api.WizardRecurrenceRule;
}
const CATEGORIES: { title: string; postes: PosteDef[] }[] = [
  {
    title: 'Énergie / Télécom',
    postes: [
      { key: 'electricite-energie', label: 'Électricité', defaultRule: 'mensuel' },
      { key: 'eau', label: 'Eau', defaultRule: 'mensuel' },
      { key: 'internet', label: 'Internet', defaultRule: 'mensuel' },
      { key: 'telephone', label: 'Téléphone', defaultRule: 'mensuel' },
    ],
  },
  {
    title: 'Personnel',
    postes: [
      { key: 'menage', label: 'Femme de ménage', defaultRule: 'mensuel' },
      { key: 'jardinier', label: 'Jardinier', defaultRule: 'mensuel' },
      { key: 'gardien', label: 'Gardien', defaultRule: 'mensuel' },
      { key: 'cuisinier', label: 'Cuisinier', defaultRule: 'mensuel' },
      { key: 'autre-personnel', label: 'Autre personnel', defaultRule: 'mensuel' },
    ],
  },
  {
    title: 'Entretien',
    postes: [
      { key: 'pisciniste', label: 'Pisciniste', defaultRule: 'mensuel' },
      { key: 'climatisation', label: 'Climatisation', defaultRule: 'ponctuel' },
      { key: 'chaudiere', label: 'Chaudière', defaultRule: 'ponctuel' },
      { key: 'plomberie', label: 'Plomberie', defaultRule: 'ponctuel' },
      { key: 'electricite-entretien', label: 'Électricité', defaultRule: 'ponctuel' },
      { key: 'jardin', label: 'Jardin', defaultRule: 'ponctuel' },
      { key: 'piscine', label: 'Piscine', defaultRule: 'ponctuel' },
      { key: 'reparations', label: 'Réparations', defaultRule: 'ponctuel' },
    ],
  },
  {
    title: 'Charges',
    postes: [
      { key: 'syndic', label: 'Syndic', defaultRule: 'mensuel' },
      { key: 'assurance-habitation', label: 'Assurance habitation', defaultRule: 'annuel' },
      { key: 'taxes', label: 'Taxes', defaultRule: 'annuel' },
      { key: 'autre-charge', label: 'Autre', defaultRule: 'ponctuel' },
    ],
  },
];
const ALL_POSTES = CATEGORIES.flatMap((c) => c.postes);

interface PosteState {
  included: boolean;
  amount: string;
  unknown: boolean;
  recurrenceRule: api.WizardRecurrenceRule;
  dueDate: string;
}

interface ExtraItem {
  label: string;
  amount: string;
  unknown: boolean;
  recurrenceRule: api.WizardRecurrenceRule;
  dueDate: string;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function newPoste(defaultRule: api.WizardRecurrenceRule): PosteState {
  return { included: false, amount: '', unknown: false, recurrenceRule: defaultRule, dueDate: todayIso() };
}

/**
 * Assistant « Plan Maison » (M8) — même patron EXACT que VehicleWizardScreen :
 * sélection/création du logement (nom uniquement, guard-rail §2), postes
 * groupés par catégorie, POST /housing-wizard atomique.
 */
export function HousingWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [housings, setHousings] = useState<api.Housing[]>([]);
  const [housingId, setHousingId] = useState<string>(NEW_HOUSING);
  const [housingName, setHousingName] = useState('');

  const [postes, setPostes] = useState<Record<string, PosteState>>(
    Object.fromEntries(ALL_POSTES.map((p) => [p.key, newPoste(p.defaultRule)])),
  );
  const [autres, setAutres] = useState<ExtraItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listHousing().then((list) => {
      setHousings(list);
      if (list.length > 0) setHousingId(list[0].id);
    });
  }, []);

  function updatePoste(key: string, value: PosteState) {
    setPostes((prev) => ({ ...prev, [key]: value }));
  }

  function buildItems(): api.HousingWizardItem[] {
    const items: api.HousingWizardItem[] = [];
    for (const p of ALL_POSTES) {
      const item = postes[p.key];
      if (!item.included) continue;
      items.push({
        label: p.label,
        amount: item.unknown ? null : Number(item.amount.replace(',', '.')) || null,
        recurrenceRule: item.recurrenceRule,
        dueDate: item.dueDate,
      });
    }
    for (const extra of autres) {
      if (!extra.label.trim()) continue;
      items.push({
        label: extra.label.trim(),
        amount: extra.unknown ? null : Number(extra.amount.replace(',', '.')) || null,
        recurrenceRule: extra.recurrenceRule,
        dueDate: extra.dueDate,
      });
    }
    return items;
  }

  const items = buildItems();
  const isNewHousing = housingId === NEW_HOUSING;

  async function onSubmit() {
    setError(null);
    if (isNewHousing && !housingName.trim()) {
      setError('Indiquez le nom du logement');
      return;
    }
    if (items.length === 0) {
      setError('Sélectionnez au moins un poste à suivre');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitHousingWizard({
        housingId: isNewHousing ? undefined : housingId,
        housingName: isNewHousing ? housingName.trim() : undefined,
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
        <Text style={styles.title}>Nouveau plan Maison</Text>
        <Text style={styles.intro}>Sélectionnez le logement concerné, puis cochez les postes à suivre.</Text>

        <Text style={styles.sectionLabel}>Logement</Text>
        {housings.length > 0 && (
          <Select
            testID="housing-select"
            label="Logement existant"
            value={housingId}
            options={[...housings.map((h) => ({ value: h.id, label: h.name })), { value: NEW_HOUSING, label: '+ Ajouter un logement' }]}
            onChange={setHousingId}
          />
        )}
        {isNewHousing && (
          <TextInput
            testID="housing-name-input"
            style={styles.input}
            placeholder="Nom du logement (ex. Villa Almaz)"
            value={housingName}
            onChangeText={setHousingName}
            onFocus={handleFocus}
          />
        )}

        {CATEGORIES.map((cat) => (
          <View key={cat.title}>
            <Text style={styles.categoryLabel}>{cat.title.toUpperCase()}</Text>
            {cat.postes.map((p) => {
              const item = postes[p.key];
              return (
                <View key={p.key} style={styles.posteBlock}>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabel}>{p.label}</Text>
                    <Switch testID={`housing-poste-toggle-${p.key}`} value={item.included} onValueChange={(included) => updatePoste(p.key, { ...item, included })} />
                  </View>
                  {item.included && (
                    <>
                      <View style={styles.toggleRow}>
                        <Text style={styles.toggleLabelSmall}>Je ne connais pas encore le montant</Text>
                        <Switch value={item.unknown} onValueChange={(unknown) => updatePoste(p.key, { ...item, unknown })} />
                      </View>
                      {!item.unknown && (
                        <TextInput
                          style={styles.input}
                          placeholder="Montant (DH)"
                          keyboardType="decimal-pad"
                          value={item.amount}
                          onChangeText={(amount) => updatePoste(p.key, { ...item, amount })}
                          onFocus={handleFocus}
                        />
                      )}
                      <Select
                        testID={`housing-poste-recurrence-${p.key}`}
                        label="Périodicité"
                        value={item.recurrenceRule}
                        options={RECURRENCE_OPTIONS}
                        onChange={(v) => updatePoste(p.key, { ...item, recurrenceRule: v as api.WizardRecurrenceRule })}
                      />
                      <DateField
                        label={item.recurrenceRule === 'ponctuel' ? 'Date prévue' : 'Prochaine échéance'}
                        value={item.dueDate}
                        onChange={(dueDate) => updatePoste(p.key, { ...item, dueDate })}
                      />
                    </>
                  )}
                </View>
              );
            })}
          </View>
        ))}

        <Text style={styles.sectionLabel}>Autres postes</Text>
        {autres.map((extra, i) => (
          <View key={i} style={styles.extraBlock}>
            <TextInput
              style={styles.input}
              placeholder="Libellé"
              value={extra.label}
              onChangeText={(label) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, label } : e)))}
              onFocus={handleFocus}
            />
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabelSmall}>Je ne connais pas encore le montant</Text>
              <Switch value={extra.unknown} onValueChange={(unknown) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, unknown } : e)))} />
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
            <Select
              label="Périodicité"
              value={extra.recurrenceRule}
              options={RECURRENCE_OPTIONS}
              onChange={(v) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, recurrenceRule: v as api.WizardRecurrenceRule } : e)))}
            />
            <DateField label="Date prévue" value={extra.dueDate} onChange={(dueDate) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, dueDate } : e)))} />
          </View>
        ))}
        <TouchableOpacity
          style={styles.addExtraButton}
          onPress={() => setAutres((prev) => [...prev, { label: '', amount: '', unknown: false, recurrenceRule: 'ponctuel', dueDate: todayIso() }])}
        >
          <Text style={styles.addExtraButtonText}>+ Ajouter un poste</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity testID="housing-wizard-submit" style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Créer le plan Maison</Text>}
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
  categoryLabel: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.4, marginTop: spacing.md, marginBottom: spacing.xs },
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
  posteBlock: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  toggleLabelSmall: { fontSize: 12, color: colors.textSecondary, flex: 1, marginRight: spacing.sm },
  extraBlock: { marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  addExtraButton: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  addExtraButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.xxl },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
