import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { Select } from '../../ui/Select';
import * as api from '../../api/client';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

const NEW_VEHICLE = '__new__';

const RECURRENCE_OPTIONS: { value: api.WizardRecurrenceRule; label: string }[] = [
  { value: 'ponctuel', label: 'Ponctuelle' },
  { value: 'hebdomadaire', label: 'Hebdomadaire' },
  { value: 'mensuel', label: 'Mensuelle' },
  { value: 'trimestriel', label: 'Trimestrielle' },
  { value: 'semestriel', label: 'Semestrielle' },
  { value: 'annuel', label: 'Annuelle' },
];

// guard-rail §10 — suggestions Plan Voiture. La périodicité proposée est une
// valeur PAR DÉFAUT intelligente uniquement (§7) : l'utilisateur peut TOUJOURS
// la changer (aucune règle métier ne l'impose jamais définitivement).
const SUGGESTED_POSTES: { label: string; defaultRule: api.WizardRecurrenceRule }[] = [
  { label: 'Assurance', defaultRule: 'annuel' },
  { label: 'Vignette', defaultRule: 'annuel' },
  { label: 'Visite technique', defaultRule: 'annuel' },
  { label: 'Vidange', defaultRule: 'semestriel' },
  { label: 'Entretien', defaultRule: 'semestriel' },
  { label: 'Pneus', defaultRule: 'ponctuel' },
  { label: 'Réparations', defaultRule: 'ponctuel' },
  { label: 'Carburant', defaultRule: 'mensuel' },
  { label: 'Lavage', defaultRule: 'mensuel' },
  { label: 'Parking', defaultRule: 'mensuel' },
  { label: 'Péages', defaultRule: 'mensuel' },
  { label: 'Crédit/leasing', defaultRule: 'mensuel' },
];

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
 * Assistant « Plan Voiture » (M7) — sélectionne un véhicule existant ou en crée
 * un (nom uniquement, guard-rail §1), puis coche les postes à suivre. Réutilise
 * EXCLUSIVEMENT ChargePlan/Deadline/le moteur de récurrence existant (une seule
 * requête atomique POST /vehicle-wizard) — jamais un moteur financier parallèle.
 */
export function VehicleWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();

  const [vehicles, setVehicles] = useState<api.Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(NEW_VEHICLE);
  const [vehicleName, setVehicleName] = useState('');

  const [postes, setPostes] = useState<Record<string, PosteState>>(
    Object.fromEntries(SUGGESTED_POSTES.map((p) => [p.label, newPoste(p.defaultRule)])),
  );
  const [autres, setAutres] = useState<ExtraItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listVehicles().then((list) => {
      setVehicles(list);
      if (list.length > 0) setVehicleId(list[0].id);
    });
  }, []);

  function updatePoste(label: string, value: PosteState) {
    setPostes((prev) => ({ ...prev, [label]: value }));
  }

  function buildItems(): api.VehicleWizardItem[] {
    const items: api.VehicleWizardItem[] = [];
    for (const p of SUGGESTED_POSTES) {
      const item = postes[p.label];
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
  const isNewVehicle = vehicleId === NEW_VEHICLE;

  async function onSubmit() {
    setError(null);
    if (isNewVehicle && !vehicleName.trim()) {
      setError('Indiquez le nom du véhicule');
      return;
    }
    if (items.length === 0) {
      setError('Sélectionnez au moins un poste à suivre');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitVehicleWizard({
        vehicleId: isNewVehicle ? undefined : vehicleId,
        vehicleName: isNewVehicle ? vehicleName.trim() : undefined,
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
        <Text style={styles.title}>Nouveau plan Voiture</Text>
        <Text style={styles.intro}>Sélectionnez le véhicule concerné, puis cochez les postes à suivre.</Text>

        <Text style={styles.sectionLabel}>Véhicule</Text>
        {vehicles.length > 0 && (
          <Select
            testID="vehicle-select"
            label="Véhicule existant"
            value={vehicleId}
            options={[...vehicles.map((v) => ({ value: v.id, label: v.name })), { value: NEW_VEHICLE, label: '+ Ajouter un véhicule' }]}
            onChange={setVehicleId}
          />
        )}
        {isNewVehicle && (
          <TextInput
            testID="vehicle-name-input"
            style={styles.input}
            placeholder="Nom du véhicule (ex. Audi Q5)"
            value={vehicleName}
            onChangeText={setVehicleName}
            onFocus={handleFocus}
          />
        )}

        <Text style={styles.sectionLabel}>Postes à suivre</Text>
        {SUGGESTED_POSTES.map((p) => {
          const item = postes[p.label];
          return (
            <View key={p.label} style={styles.posteBlock}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>{p.label}</Text>
                <Switch
                  testID={`vehicle-poste-toggle-${p.label}`}
                  value={item.included}
                  onValueChange={(included) => updatePoste(p.label, { ...item, included })}
                />
              </View>
              {item.included && (
                <>
                  <View style={styles.toggleRow}>
                    <Text style={styles.toggleLabelSmall}>Je ne connais pas encore le montant</Text>
                    <Switch value={item.unknown} onValueChange={(unknown) => updatePoste(p.label, { ...item, unknown })} />
                  </View>
                  {!item.unknown && (
                    <TextInput
                      style={styles.input}
                      placeholder="Montant (DH)"
                      keyboardType="decimal-pad"
                      value={item.amount}
                      onChangeText={(amount) => updatePoste(p.label, { ...item, amount })}
                      onFocus={handleFocus}
                    />
                  )}
                  <Select
                    testID={`vehicle-poste-recurrence-${p.label}`}
                    label="Périodicité"
                    value={item.recurrenceRule}
                    options={RECURRENCE_OPTIONS}
                    onChange={(v) => updatePoste(p.label, { ...item, recurrenceRule: v as api.WizardRecurrenceRule })}
                  />
                  <DateField
                    label={item.recurrenceRule === 'ponctuel' ? 'Date prévue' : 'Prochaine échéance'}
                    value={item.dueDate}
                    onChange={(dueDate) => updatePoste(p.label, { ...item, dueDate })}
                  />
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
              placeholder="Libellé (ex. Amende)"
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
            <Select
              label="Périodicité"
              value={extra.recurrenceRule}
              options={RECURRENCE_OPTIONS}
              onChange={(v) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, recurrenceRule: v as api.WizardRecurrenceRule } : e)))}
            />
            <DateField
              label="Date prévue"
              value={extra.dueDate}
              onChange={(dueDate) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, dueDate } : e)))}
            />
          </View>
        ))}
        <TouchableOpacity
          style={styles.addExtraButton}
          onPress={() => setAutres((prev) => [...prev, { label: '', amount: '', unknown: false, recurrenceRule: 'ponctuel', dueDate: todayIso() }])}
        >
          <Text style={styles.addExtraButtonText}>+ Ajouter un poste</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity testID="vehicle-wizard-submit" style={styles.button} onPress={onSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Créer le plan Voiture</Text>}
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
