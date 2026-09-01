import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
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

const STEP_TITLES = [
  'Année scolaire',
  'Établissement',
  'Enfants',
  'Scolarité (T1/T2/T3)',
  'Fournitures',
  'Uniforme',
  'Sorties',
  'Restauration',
  'Garderie',
  'Assurance',
  'Réinscription',
  'Autres frais',
  'Récapitulatif',
];

/**
 * Assistant « Ajouter les frais scolaires » (§17). Chaque étape est passable —
 * un item non inclus n'est simplement pas envoyé. « Je ne connais pas encore »
 * → amount_status = inconnu, jamais 0 (§4). La restauration reste un forfait
 * saisi directement, jamais un calcul prix repas × quantité (§18).
 */
export function SchoolWizardScreen() {
  const navigation = useNavigation<any>();
  const [step, setStep] = useState(0);
  const [children, setChildren] = useState<Child[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schoolYear, setSchoolYear] = useState('2026/2027');
  const [schoolName, setSchoolName] = useState('');
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);

  const [t1, setT1] = useState<ItemState>(newItem(todayIso()));
  const [t2, setT2] = useState<ItemState>(newItem(todayIso()));
  const [t3, setT3] = useState<ItemState>(newItem(todayIso()));
  const [fournitures, setFournitures] = useState<ItemState>(newItem(todayIso()));
  const [uniforme, setUniforme] = useState<ItemState>(newItem(todayIso()));
  const [sorties, setSorties] = useState<ItemState>(newItem(todayIso()));
  const [restauration, setRestauration] = useState<ItemState>(newItem(todayIso()));
  const [garderie, setGarderie] = useState<ItemState & { souscrite: boolean }>({ ...newItem(todayIso(), false), souscrite: false });
  const [assurance, setAssurance] = useState<ItemState>(newItem(todayIso()));
  const [reinscription, setReinscription] = useState<ItemState>(newItem(todayIso()));
  const [autres, setAutres] = useState<ExtraItem[]>([]);

  useEffect(() => {
    api
      .listChildren()
      .then(setChildren)
      .finally(() => setLoadingChildren(false));
  }, []);

  function toggleChild(id: string) {
    setSelectedChildIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  function buildItems(): api.SchoolWizardItem[] {
    const items: api.SchoolWizardItem[] = [];
    const push = (label: string, item: ItemState, obligationStatus?: string) => {
      if (!item.included) return;
      items.push({
        label,
        amount: item.unknown ? null : Number(item.amount.replace(',', '.')) || null,
        dueDate: item.dueDate,
        obligationStatus,
      });
    };
    push('Scolarité T1', t1);
    push('Scolarité T2', t2);
    push('Scolarité T3', t3);
    push('Fournitures', fournitures);
    push('Uniforme', uniforme);
    push('Sorties', sorties);
    push('Restauration', restauration);
    if (garderie.included) push('Garderie', garderie, garderie.souscrite ? 'optionnelle_souscrite' : 'optionnelle_envisagee');
    push('Assurance', assurance);
    push('Réinscription', reinscription);
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

  async function onSubmit() {
    setError(null);
    if (selectedChildIds.length === 0) {
      setError('Sélectionnez au moins un enfant');
      return;
    }
    setSubmitting(true);
    try {
      await api.submitSchoolWizard({
        label: `École ${schoolYear}${schoolName ? ` — ${schoolName}` : ''}`,
        childIds: selectedChildIds,
        periodStart: `${schoolYear.slice(0, 4)}-09-01`,
        periodEnd: `${schoolYear.slice(5, 9) || String(Number(schoolYear.slice(0, 4)) + 1)}-06-30`,
        items: buildItems(),
      });
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  function ItemStep({
    itemLabel,
    hint,
    value,
    onChange,
  }: {
    itemLabel: string;
    hint?: string;
    value: ItemState;
    onChange: (v: ItemState) => void;
  }) {
    return (
      <View>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Inclure « {itemLabel} »</Text>
          <Switch value={value.included} onValueChange={(included) => onChange({ ...value, included })} />
        </View>
        {value.included && (
          <>
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Je ne connais pas encore le montant</Text>
              <Switch value={value.unknown} onValueChange={(unknown) => onChange({ ...value, unknown })} />
            </View>
            {!value.unknown && (
              <TextInput
                style={styles.input}
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                value={value.amount}
                onChangeText={(amount) => onChange({ ...value, amount })}
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="Date d'échéance (AAAA-MM-JJ)"
              value={value.dueDate}
              onChangeText={(dueDate) => onChange({ ...value, dueDate })}
            />
          </>
        )}
      </View>
    );
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <View>
            <Text style={styles.stepHint}>Sous quelle forme AAAA/AAAA (ex. 2026/2027) ?</Text>
            <TextInput style={styles.input} value={schoolYear} onChangeText={setSchoolYear} placeholder="2026/2027" />
          </View>
        );
      case 1:
        return (
          <View>
            <Text style={styles.stepHint}>Facultatif.</Text>
            <TextInput style={styles.input} value={schoolName} onChangeText={setSchoolName} placeholder="Nom de l'établissement" />
          </View>
        );
      case 2:
        return loadingChildren ? (
          <ActivityIndicator />
        ) : (
          <View style={styles.chipRow}>
            {children.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.chip, selectedChildIds.includes(c.id) && styles.chipActive]}
                onPress={() => toggleChild(c.id)}
              >
                <Text style={[styles.chipText, selectedChildIds.includes(c.id) && styles.chipTextActive]}>{c.firstName}</Text>
              </TouchableOpacity>
            ))}
            {children.length === 0 && <Text style={styles.stepHint}>Aucun enfant — créez-en un dans « Plus » d'abord.</Text>}
          </View>
        );
      case 3:
        return (
          <View>
            <Text style={styles.subStepTitle}>T1</Text>
            <ItemStep itemLabel="Scolarité T1" value={t1} onChange={setT1} />
            <Text style={styles.subStepTitle}>T2</Text>
            <ItemStep itemLabel="Scolarité T2" value={t2} onChange={setT2} />
            <Text style={styles.subStepTitle}>T3</Text>
            <ItemStep itemLabel="Scolarité T3" value={t3} onChange={setT3} />
          </View>
        );
      case 4:
        return <ItemStep itemLabel="Fournitures" value={fournitures} onChange={setFournitures} />;
      case 5:
        return <ItemStep itemLabel="Uniforme" value={uniforme} onChange={setUniforme} />;
      case 6:
        return <ItemStep itemLabel="Sorties" value={sorties} onChange={setSorties} />;
      case 7:
        return (
          <ItemStep
            itemLabel="Restauration"
            hint="Forfait mensuel/trimestriel/annuel de l'établissement — jamais un calcul prix du repas × nombre de repas."
            value={restauration}
            onChange={setRestauration}
          />
        );
      case 8:
        return (
          <View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Inclure « Garderie »</Text>
              <Switch value={garderie.included} onValueChange={(included) => setGarderie({ ...garderie, included })} />
            </View>
            {garderie.included && (
              <>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Déjà souscrite (sinon : option envisagée)</Text>
                  <Switch value={garderie.souscrite} onValueChange={(souscrite) => setGarderie({ ...garderie, souscrite })} />
                </View>
                <View style={styles.toggleRow}>
                  <Text style={styles.toggleLabel}>Je ne connais pas encore le montant</Text>
                  <Switch value={garderie.unknown} onValueChange={(unknown) => setGarderie({ ...garderie, unknown })} />
                </View>
                {!garderie.unknown && (
                  <TextInput
                    style={styles.input}
                    placeholder="Montant mensuel (DH)"
                    keyboardType="decimal-pad"
                    value={garderie.amount}
                    onChangeText={(amount) => setGarderie({ ...garderie, amount })}
                  />
                )}
              </>
            )}
          </View>
        );
      case 9:
        return <ItemStep itemLabel="Assurance" value={assurance} onChange={setAssurance} />;
      case 10:
        return <ItemStep itemLabel="Réinscription" value={reinscription} onChange={setReinscription} />;
      case 11:
        return (
          <View>
            {autres.map((extra, i) => (
              <View key={i} style={styles.extraBlock}>
                <TextInput
                  style={styles.input}
                  placeholder="Libellé"
                  value={extra.label}
                  onChangeText={(label) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, label } : e)))}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Montant (DH)"
                  keyboardType="decimal-pad"
                  value={extra.amount}
                  onChangeText={(amount) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, amount } : e)))}
                />
              </View>
            ))}
            <TouchableOpacity style={styles.addExtraButton} onPress={() => setAutres((prev) => [...prev, { label: '', amount: '', unknown: false, dueDate: todayIso() }])}>
              <Text style={styles.addExtraButtonText}>+ Ajouter une ligne</Text>
            </TouchableOpacity>
          </View>
        );
      case 12:
        return (
          <View>
            <Text style={styles.stepHint}>{buildItems().length} élément(s) seront ajoutés à « École {schoolYear} ».</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        );
      default:
        return null;
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.stepCounter}>
        Étape {step + 1}/{STEP_TITLES.length}
      </Text>
      <Text style={styles.title}>{STEP_TITLES[step]}</Text>

      <ScrollView contentContainerStyle={styles.scroll}>{renderStep()}</ScrollView>

      <View style={styles.navRow}>
        <TouchableOpacity style={styles.navButton} onPress={() => (step === 0 ? navigation.goBack() : setStep(step - 1))}>
          <Text style={styles.navButtonText}>{step === 0 ? 'Annuler' : 'Précédent'}</Text>
        </TouchableOpacity>
        {step < STEP_TITLES.length - 1 ? (
          <TouchableOpacity style={styles.navButtonPrimary} onPress={() => setStep(step + 1)}>
            <Text style={styles.navButtonPrimaryText}>Suivant</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.navButtonPrimary} onPress={onSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.navButtonPrimaryText}>Créer le plan</Text>}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 40 },
  scroll: { padding: 24 },
  stepCounter: { fontSize: 11, color: '#6B747C', textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: '#172436', textAlign: 'center', marginBottom: 8 },
  stepHint: { fontSize: 12, color: '#6B747C', marginBottom: 12 },
  subStepTitle: { fontSize: 13, fontWeight: '700', color: '#172436', marginTop: 12, marginBottom: 4 },
  hint: { fontSize: 11, color: '#6B747C', marginBottom: 8, fontStyle: 'italic' },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toggleLabel: { fontSize: 13, color: '#172436', flex: 1, marginRight: 8 },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  chip: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  chipActive: { backgroundColor: '#172436', borderColor: '#172436' },
  chipText: { fontSize: 13, color: '#172436' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  extraBlock: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E3E1DC' },
  addExtraButton: { alignItems: 'center', paddingVertical: 8 },
  addExtraButtonText: { color: '#172436', fontWeight: '600', fontSize: 13 },
  navRow: { flexDirection: 'row', padding: 20, gap: 12 },
  navButton: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#EDEBE6' },
  navButtonText: { color: '#172436', fontWeight: '600', fontSize: 14 },
  navButtonPrimary: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 10, backgroundColor: '#172436' },
  navButtonPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#B3261E', fontSize: 13, marginTop: 8 },
});
