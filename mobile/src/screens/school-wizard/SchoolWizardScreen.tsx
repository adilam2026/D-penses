import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, FocusEvent, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useBottomInset } from '../../ui/useBottomInset';
import { DateField } from '../../ui/DateField';
import { FREQUENCY_LABEL } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import * as api from '../../api/client';
import { colors, radius, spacing } from '../../ui/theme';
import { MultiSelect } from '../../ui/MultiSelect';
import { Select } from '../../ui/Select';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

interface Account {
  id: string;
  name: string;
}

/**
 * Recette post-Vague 3 (§8/§9/§10) — les 6 fréquences du moteur générique sont
 * toutes disponibles ici (ex. Garderie n'était limitée qu'à mensuel/ponctuel,
 * une restriction métier injustifiée) ; 'trimestriel' reste le cas spécial
 * historique T1/T2/T3 (mêmes échéances que Scolarité/Restauration, §10), les
 * autres valeurs deviennent un vrai ChargePlan récurrent (même moteur que les
 * charges génériques — occurrence-generation.util.ts, jamais dupliqué).
 */
type Frequency = 'ponctuel' | 'hebdomadaire' | 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel';

interface TermState {
  amount: string;
  autoFilled: boolean;
  dueDate: string;
}

/**
 * R6.2 (§4-9, §8) : poste déjà réglé AVANT la saisie de ce plan (ex. Uniforme
 * payé en août). accountId reste facultatif (CAS A compte connu / CAS B
 * compte inconnu — cf. already-paid.util.ts côté backend). Jamais proposé
 * sur un poste trimestriel (Scolarité/Restauration T1/T2/T3) — l'ambiguïté
 * "quel trimestre ?" sortirait du périmètre sûr de cette version.
 */
interface AlreadyPaidState {
  active: boolean;
  amount: string;
  paidDate: string;
  accountId: string | null;
}

function newAlreadyPaid(): AlreadyPaidState {
  return { active: false, amount: '', paidDate: todayIso(), accountId: null };
}

interface PosteState {
  included: boolean;
  unknown: boolean;
  frequency: Frequency;
  amount: string;
  dueDate: string;
  terms: [TermState, TermState, TermState];
  alreadyPaid: AlreadyPaidState;
}

interface ExtraItem {
  label: string;
  amount: string;
  dueDate: string;
  alreadyPaid: AlreadyPaidState;
}

interface BuiltItem {
  label: string;
  amount: number | null;
  dueDate: string;
  obligationStatus?: string;
  recurrenceRule?: Exclude<Frequency, 'ponctuel' | 'trimestriel'>;
  alreadyPaid?: { amount: number; paidDate: string; accountId?: string };
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function newTerm(dueDate: string): TermState {
  return { amount: '', autoFilled: true, dueDate };
}

function newPoste(dueDate: string, included = false): PosteState {
  return {
    included,
    unknown: false,
    frequency: 'ponctuel',
    amount: '',
    dueDate,
    terms: [newTerm(dueDate), newTerm(dueDate), newTerm(dueDate)],
    alreadyPaid: newAlreadyPaid(),
  };
}

/**
 * Répartition proportionnelle T2/T3 à partir de T1 (§9-10 vague 1) — jamais un
 * montant identique T1=T2=T3 : le mensuel implicite de T1 (montant / mois de
 * T1) est simplement reporté sur le nombre de mois de T2/T3. Ne recalcule que
 * les termes encore "autoFilled" — un terme édité manuellement par
 * l'utilisateur n'est plus jamais écrasé automatiquement.
 */
function recomputeAutoTerms(poste: PosteState, termMonths: [number, number, number]): PosteState {
  const t1Amount = Number(poste.terms[0].amount.replace(',', '.'));
  if (!t1Amount || !termMonths[0]) return poste;
  const monthly = t1Amount / termMonths[0];
  const terms = poste.terms.map((t, i) => (i === 0 || !t.autoFilled ? t : { ...t, amount: String(round2(monthly * termMonths[i])) })) as [
    TermState,
    TermState,
    TermState,
  ];
  return { ...poste, terms };
}

const STEP_TITLES = ['Enfant(s) & établissement', 'Scolarité', 'Services scolaires', 'Frais de rentrée', 'Vie scolaire & réinscription', 'Récapitulatif'];

/**
 * Assistant « Frais scolaires » — refonte Vague 1 (fiabilisation + parcours
 * simplifié). Regroupe les anciennes 13 étapes en 6, avec sélection
 * intelligente (une case cochée ouvre son propre formulaire, rien d'inutile
 * affiché), calendrier natif partout, et l'estimation T2/T3 proportionnelle
 * (jamais un montant trimestriel supposé identique — §10).
 *
 * Root-cause corrigée (bug bloquant recette réelle Android) : l'ancienne
 * version définissait son composant de ligne (ItemStep) À L'INTÉRIEUR du
 * composant écran — une nouvelle identité de composant était donc recréée à
 * CHAQUE frappe (chaque setState), forçant React à démonter/remonter tout le
 * sous-arbre et donc le TextInput actif : le clavier se fermait et le focus
 * se perdait après un ou deux caractères. PosteEditor est maintenant déclaré
 * au niveau module (comme Figure ailleurs dans l'app), jamais recréé.
 */
export function SchoolWizardScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const [step, setStep] = useState(0);

  const [children, setChildren] = useState<Child[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  // R6.2 (§4-9, §8) : comptes disponibles pour "Compte débité" (facultatif) sur un poste déjà payé.
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [newChildFirst, setNewChildFirst] = useState('');
  const [newChildLast, setNewChildLast] = useState('');
  const [creatingChild, setCreatingChild] = useState(false);
  const [childError, setChildError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schoolYear, setSchoolYear] = useState('2026/2027');
  const [schoolName, setSchoolName] = useState('');
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [termMonths, setTermMonths] = useState<[number, number, number]>([4, 3, 3]);

  const [scolariteAnnual, setScolariteAnnual] = useState('');
  const [scolarite, setScolarite] = useState<PosteState>({ ...newPoste(todayIso(), true), frequency: 'trimestriel' });

  const [restauration, setRestauration] = useState<PosteState>(newPoste(todayIso()));
  const [garderie, setGarderie] = useState<PosteState & { souscrite: boolean }>({ ...newPoste(todayIso()), souscrite: false, frequency: 'mensuel' });

  const [uniforme, setUniforme] = useState<PosteState>(newPoste(todayIso()));
  const [fournitures, setFournitures] = useState<PosteState>(newPoste(todayIso()));
  const [assurance, setAssurance] = useState<PosteState>(newPoste(todayIso()));

  const [sorties, setSorties] = useState<PosteState>(newPoste(todayIso()));
  const [reinscription, setReinscription] = useState<PosteState>(newPoste(todayIso()));
  const [autres, setAutres] = useState<ExtraItem[]>([]);

  const loadChildren = useCallback(async () => {
    setLoadingChildren(true);
    try {
      setChildren(await api.listChildren());
    } finally {
      setLoadingChildren(false);
    }
  }, []);

  useEffect(() => {
    loadChildren();
    api.listAccounts().then(setAccounts);
  }, [loadChildren]);

  async function onCreateChild() {
    setChildError(null);
    if (!newChildFirst.trim() || !newChildLast.trim()) {
      setChildError('Prénom et nom requis');
      return;
    }
    setCreatingChild(true);
    try {
      const created = await api.createChild({ firstName: newChildFirst.trim(), lastName: newChildLast.trim() });
      setNewChildFirst('');
      setNewChildLast('');
      await loadChildren();
      // Présélectionne le nouvel enfant — l'utilisateur n'a pas à le rechercher (§6).
      setSelectedChildIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]));
    } catch (err) {
      setChildError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setCreatingChild(false);
    }
  }

  function applyScolariteAnnual() {
    const total = Number(scolariteAnnual.replace(',', '.'));
    const totalMonths = termMonths[0] + termMonths[1] + termMonths[2];
    if (!total || !totalMonths) return;
    // Répartition proportionnelle sur le total des mois de trimestre configurés
    // (ex. 4+3+3=10, PAS 12) — l'année scolaire n'est pas une année civile.
    const monthly = total / totalMonths;
    setScolarite((prev) => ({
      ...prev,
      included: true,
      frequency: 'trimestriel',
      terms: [
        { ...prev.terms[0], amount: String(round2(monthly * termMonths[0])), autoFilled: true },
        { ...prev.terms[1], amount: String(round2(monthly * termMonths[1])), autoFilled: true },
        { ...prev.terms[2], amount: String(round2(monthly * termMonths[2])), autoFilled: true },
      ],
    }));
  }

  function onTermMonthsChange(index: 0 | 1 | 2, value: string) {
    const n = Math.max(1, Math.min(12, Number(value) || 1));
    const next: [number, number, number] = [...termMonths];
    next[index] = n;
    setTermMonths(next);
    setScolarite((prev) => recomputeAutoTerms(prev, next));
    setRestauration((prev) => recomputeAutoTerms(prev, next));
  }

  function buildItems(): BuiltItem[] {
    const items: BuiltItem[] = [];

    function pushPoste(label: string, poste: PosteState, obligationStatus?: string) {
      if (!poste.included) return;
      if (poste.frequency === 'trimestriel') {
        const labels = ['T1', 'T2', 'T3'];
        poste.terms.forEach((term, i) => {
          const amount = term.amount.trim() === '' ? null : Number(term.amount.replace(',', '.')) || null;
          items.push({ label: `${label} ${labels[i]}`, amount, dueDate: term.dueDate, obligationStatus });
        });
      } else {
        const amount = poste.unknown ? null : Number(poste.amount.replace(',', '.')) || null;
        items.push({
          label,
          amount,
          dueDate: poste.dueDate,
          obligationStatus,
          // §10 : toute fréquence non ponctuelle devient un ChargePlan récurrent réel
          // (même moteur générique que les charges/revenus, jamais une 2e logique).
          recurrenceRule: poste.frequency !== 'ponctuel' ? poste.frequency : undefined,
          // R6.2 (§4-9) : poste déjà réglé — le montant réellement payé fait foi,
          // jamais celui saisi ci-dessus (qui peut rester une estimation du coût total).
          alreadyPaid: poste.alreadyPaid.active
            ? {
                amount: Number(poste.alreadyPaid.amount.replace(',', '.')) || 0,
                paidDate: poste.alreadyPaid.paidDate,
                accountId: poste.alreadyPaid.accountId ?? undefined,
              }
            : undefined,
        });
      }
    }

    pushPoste('Scolarité', scolarite);
    pushPoste('Restauration', restauration);
    if (garderie.included) pushPoste('Garderie', garderie, garderie.souscrite ? 'optionnelle_souscrite' : 'optionnelle_envisagee');
    pushPoste('Uniforme', uniforme);
    pushPoste('Fournitures', fournitures);
    pushPoste('Assurance', assurance);
    pushPoste('Sorties', sorties);
    pushPoste('Réinscription', reinscription);
    for (const extra of autres) {
      if (!extra.label.trim()) continue;
      const amount = extra.amount.trim() === '' ? null : Number(extra.amount.replace(',', '.')) || null;
      items.push({
        label: extra.label.trim(),
        amount,
        dueDate: extra.dueDate,
        alreadyPaid: extra.alreadyPaid.active
          ? {
              amount: Number(extra.alreadyPaid.amount.replace(',', '.')) || 0,
              paidDate: extra.alreadyPaid.paidDate,
              accountId: extra.alreadyPaid.accountId ?? undefined,
            }
          : undefined,
      });
    }
    return items;
  }

  async function onSubmit() {
    setError(null);
    if (selectedChildIds.length === 0) {
      setError('Sélectionnez au moins un enfant');
      setStep(0);
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.submitSchoolWizard({
        label: `École ${schoolYear}${schoolName ? ` — ${schoolName}` : ''}`,
        childIds: selectedChildIds,
        periodStart: `${schoolYear.slice(0, 4)}-09-01`,
        periodEnd: `${schoolYear.slice(5, 9) || String(Number(schoolYear.slice(0, 4)) + 1)}-06-30`,
        items: buildItems(),
      });
      // §15 : ouvrir directement le plan créé, jamais un écran générique.
      navigation.replace('FinancialPlanDetail', { id: res.financialPlan.id });
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  const items = buildItems();
  const totalKnown = round2(items.reduce((sum, it) => sum + (it.amount ?? 0), 0));
  const unknownCount = items.filter((it) => it.amount === null).length;

  if (loadingChildren) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // §6 : prérequis enfant contrôlé AVANT toute saisie utile, sans jamais quitter
  // l'écran (aucun draft perdu — tout l'état ci-dessus reste en mémoire React
  // même pendant que cette porte est affichée).
  if (children.length === 0) {
    return (
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset, justifyContent: 'center', flexGrow: 1 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.gateTitle}>Aucun enfant n'est encore configuré</Text>
          <Text style={styles.gateHelp}>Un plan de frais scolaires est toujours rattaché à au moins un enfant.</Text>
          <TextInput testID="gate-firstName" style={styles.input} placeholder="Prénom" value={newChildFirst} onChangeText={setNewChildFirst} onFocus={handleFocus} />
          <TextInput testID="gate-lastName" style={styles.input} placeholder="Nom" value={newChildLast} onChangeText={setNewChildLast} onFocus={handleFocus} />
          {childError ? <Text style={styles.error}>{childError}</Text> : null}
          <TouchableOpacity testID="gate-submit" style={styles.navButtonPrimary} onPress={onCreateChild} disabled={creatingChild}>
            {creatingChild ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.navButtonPrimaryText}>Ajouter un enfant</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, { marginTop: 12 }]} onPress={() => navigation.goBack()}>
            <Text style={styles.navButtonText}>Annuler</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <View>
            <MultiSelect
              testID="school-wizard-children-select"
              label="Enfant(s) concerné(s)"
              value={selectedChildIds}
              onChange={setSelectedChildIds}
              options={children.map((c) => ({ value: c.id, label: c.firstName }))}
            />

            <Text style={styles.sectionLabel}>Établissement (optionnel)</Text>
            <TextInput style={styles.input} value={schoolName} onChangeText={setSchoolName} placeholder="Nom de l'établissement" onFocus={handleFocus} />

            <Text style={styles.sectionLabel}>Année scolaire</Text>
            <TextInput style={styles.input} value={schoolYear} onChangeText={setSchoolYear} placeholder="2026/2027" onFocus={handleFocus} />

            <Text style={styles.sectionLabel}>Durée des trimestres (mois)</Text>
            <Text style={styles.hint}>Par défaut 4/3/3 — ajustez si votre établissement fonctionne autrement. Sert au calcul automatique T2/T3.</Text>
            <View style={styles.row}>
              {(['T1', 'T2', 'T3'] as const).map((label, i) => (
                <View key={label} style={styles.termMonthBox}>
                  <Text style={styles.miniLabel}>{label}</Text>
                  <TextInput
                    style={[styles.input, styles.termMonthInput]}
                    keyboardType="number-pad"
                    value={String(termMonths[i])}
                    onChangeText={(v) => onTermMonthsChange(i as 0 | 1 | 2, v)}
                    onFocus={handleFocus}
                  />
                </View>
              ))}
            </View>
          </View>
        );
      case 1:
        return (
          <View>
            <Text style={styles.stepHint}>Aide : indiquez le montant annuel total, réparti automatiquement selon les mois de trimestre ci-dessus (modifiable ensuite ligne par ligne).</Text>
            <View style={styles.row}>
              <TextInput
                testID="scolarite-annual"
                style={[styles.input, { flex: 1 }]}
                placeholder="Montant annuel (DH)"
                keyboardType="decimal-pad"
                value={scolariteAnnual}
                onChangeText={setScolariteAnnual}
                onFocus={handleFocus}
              />
              <TouchableOpacity testID="scolarite-repartir" style={styles.distributeButton} onPress={applyScolariteAnnual}>
                <Text style={styles.distributeButtonText}>Répartir</Text>
              </TouchableOpacity>
            </View>
            <PosteEditor
              label="Scolarité"
              poste={scolarite}
              onChange={(p) => setScolarite(recomputeAutoTerms(p, termMonths))}
              termMonths={termMonths}
              forceIncluded
              allowedFrequencies={['trimestriel']}
              onFocus={handleFocus}
            />
          </View>
        );
      case 2:
        return (
          <View>
            <PosteToggle
              label="Restauration"
              included={restauration.included}
              onToggle={(included) => setRestauration({ ...restauration, included })}
            >
              <PosteEditor
                label="Restauration"
                poste={restauration}
                onChange={(p) => setRestauration(recomputeAutoTerms(p, termMonths))}
                termMonths={termMonths}
                hint="Forfait de l'établissement — jamais un calcul prix du repas × nombre de repas."
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>

            <PosteToggle label="Garderie" included={garderie.included} onToggle={(included) => setGarderie({ ...garderie, included })}>
              <View style={styles.toggleRow}>
                <Text style={styles.toggleLabel}>Déjà souscrite (sinon : option envisagée)</Text>
                <Switch value={garderie.souscrite} onValueChange={(souscrite) => setGarderie({ ...garderie, souscrite })} />
              </View>
              <PosteEditor
                label="Garderie"
                poste={garderie}
                onChange={(p) => setGarderie({ ...garderie, ...p })}
                termMonths={termMonths}
                allowedFrequencies={['mensuel', 'trimestriel', 'annuel', 'ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>
          </View>
        );
      case 3:
        return (
          <View>
            <PosteToggle label="Uniforme" included={uniforme.included} onToggle={(included) => setUniforme({ ...uniforme, included })}>
              <PosteEditor
                label="Uniforme"
                poste={uniforme}
                onChange={setUniforme}
                termMonths={termMonths}
                allowedFrequencies={['ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>
            <PosteToggle label="Fournitures" included={fournitures.included} onToggle={(included) => setFournitures({ ...fournitures, included })}>
              <PosteEditor
                label="Fournitures"
                poste={fournitures}
                onChange={setFournitures}
                termMonths={termMonths}
                allowedFrequencies={['ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>
            <PosteToggle label="Assurance" included={assurance.included} onToggle={(included) => setAssurance({ ...assurance, included })}>
              <PosteEditor
                label="Assurance"
                poste={assurance}
                onChange={setAssurance}
                termMonths={termMonths}
                allowedFrequencies={['ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>
          </View>
        );
      case 4:
        return (
          <View>
            <PosteToggle label="Sorties / activités" included={sorties.included} onToggle={(included) => setSorties({ ...sorties, included })}>
              <PosteEditor
                label="Sorties"
                poste={sorties}
                onChange={setSorties}
                termMonths={termMonths}
                allowedFrequencies={['mensuel', 'trimestriel', 'ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>
            <PosteToggle label="Réinscription" included={reinscription.included} onToggle={(included) => setReinscription({ ...reinscription, included })}>
              <PosteEditor
                label="Réinscription"
                poste={reinscription}
                onChange={setReinscription}
                termMonths={termMonths}
                allowedFrequencies={['ponctuel']}
                onFocus={handleFocus}
                accounts={accounts}
              />
            </PosteToggle>

            <Text style={styles.sectionLabel}>Autres frais / événements exceptionnels</Text>
            {autres.map((extra, i) => (
              <View key={i} style={styles.extraBlock}>
                <TextInput
                  style={styles.input}
                  placeholder="Libellé (ex. Voyage scolaire)"
                  value={extra.label}
                  onChangeText={(label) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, label } : e)))}
                  onFocus={handleFocus}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Montant (DH) — laissez vide si inconnu"
                  keyboardType="decimal-pad"
                  value={extra.amount}
                  onChangeText={(amount) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, amount } : e)))}
                  onFocus={handleFocus}
                />
                <DateField value={extra.dueDate} onChange={(dueDate) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, dueDate } : e)))} />
                <AlreadyPaidEditor
                  testIdPrefix={`extra-${i}`}
                  value={extra.alreadyPaid}
                  accounts={accounts}
                  onChange={(alreadyPaid) => setAutres((prev) => prev.map((e, j) => (j === i ? { ...e, alreadyPaid } : e)))}
                  onFocus={handleFocus}
                />
              </View>
            ))}
            <TouchableOpacity
              style={styles.addExtraButton}
              onPress={() => setAutres((prev) => [...prev, { label: '', amount: '', dueDate: todayIso(), alreadyPaid: newAlreadyPaid() }])}
            >
              <Text style={styles.addExtraButtonText}>+ Ajouter une ligne</Text>
            </TouchableOpacity>
          </View>
        );
      case 5:
        return (
          <View>
            <Text style={styles.recapHeader}>{children.filter((c) => selectedChildIds.includes(c.id)).map((c) => c.firstName).join(', ') || '—'}</Text>
            <Text style={styles.recapSub}>
              {schoolName ? `${schoolName} · ` : ''}
              {schoolYear}
            </Text>

            {items.length === 0 ? (
              <Text style={styles.stepHint}>Aucun élément sélectionné pour l'instant.</Text>
            ) : (
              items.map((it, i) => (
                <View key={i} style={styles.recapRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recapLabel}>{it.label}</Text>
                    <Text style={styles.recapDate}>{new Date(it.dueDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.recapAmount}>{it.amount !== null ? `${it.amount.toLocaleString('fr-FR')} DH` : '—'}</Text>
                    <Text style={[styles.recapStatus, it.amount === null && styles.recapStatusUnknown]}>{it.amount === null ? 'Inconnu' : 'Estimé — à confirmer plus tard'}</Text>
                  </View>
                </View>
              ))
            )}

            <View style={styles.totalsCard}>
              <Text style={styles.totalsLine}>Total renseigné : {totalKnown.toLocaleString('fr-FR')} DH</Text>
              {unknownCount > 0 && <Text style={[styles.totalsLine, styles.totalsLineWarning]}>Montants inconnus : {unknownCount} poste(s)</Text>}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        );
      default:
        return null;
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.stepCounter}>
        Étape {step + 1}/{STEP_TITLES.length}
      </Text>
      <Text style={styles.title}>{STEP_TITLES[step]}</Text>

      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        {renderStep()}
      </ScrollView>

      <View style={[styles.navRow, { paddingBottom: bottomInset }]}>
        <TouchableOpacity testID="nav-prev" style={styles.navButton} onPress={() => (step === 0 ? navigation.goBack() : setStep(step - 1))}>
          <Text style={styles.navButtonText}>{step === 0 ? 'Annuler' : 'Précédent'}</Text>
        </TouchableOpacity>
        {step < STEP_TITLES.length - 1 ? (
          <TouchableOpacity testID="nav-next" style={styles.navButtonPrimary} onPress={() => setStep(step + 1)}>
            <Text style={styles.navButtonPrimaryText}>Suivant</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity testID="nav-submit" style={styles.navButtonPrimary} onPress={onSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.navButtonPrimaryText}>Créer le plan</Text>}
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

/** Case à cocher qui révèle son propre formulaire (§8) — jamais de champs inutiles affichés. */
function PosteToggle({ label, included, onToggle, children }: { label: string; included: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <View style={styles.posteBlock}>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Switch testID={`toggle-${label}`} value={included} onValueChange={onToggle} />
      </View>
      {included && children}
    </View>
  );
}

/**
 * Édition d'un poste — déclaré au NIVEAU MODULE (jamais à l'intérieur d'un
 * composant écran) pour garder une identité de composant stable entre les
 * renders : c'est la correction du bug de perte de focus (§2 vague 1).
 */
function PosteEditor({
  label,
  poste,
  onChange,
  termMonths,
  hint,
  forceIncluded,
  allowedFrequencies = ['ponctuel', 'mensuel', 'trimestriel'],
  onFocus,
  accounts = [],
}: {
  label: string;
  poste: PosteState;
  onChange: (p: PosteState) => void;
  termMonths: [number, number, number];
  hint?: string;
  forceIncluded?: boolean;
  allowedFrequencies?: Frequency[];
  /** Correctif post-Vague 3 (§1) — même mécanisme keyboard-aware que les autres écrans de saisie, jamais dupliqué : passé par le parent (module-level component, pas de closure). */
  onFocus?: (e: FocusEvent) => void;
  accounts?: Account[];
}) {
  const freqLabels = FREQUENCY_LABEL;

  return (
    <View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {allowedFrequencies.length > 1 && (
        <View style={styles.segment}>
          {allowedFrequencies.map((f) => (
            <TouchableOpacity
              key={f}
              testID={`${label}-freq-${f}`}
              style={[styles.segmentItem, poste.frequency === f && styles.segmentActive]}
              onPress={() => onChange({ ...poste, frequency: f })}
            >
              <Text style={[styles.segmentText, poste.frequency === f && styles.segmentTextActive]}>{freqLabels[f]}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {poste.frequency === 'trimestriel' ? (
        (['T1', 'T2', 'T3'] as const).map((termLabel, i) => (
          <View key={termLabel} style={styles.termCard}>
            <Text style={styles.termTitle}>
              {label} — {termLabel} ({termMonths[i]} mois)
            </Text>
            <TextInput
              testID={`${label}-term-${i}-amount`}
              style={styles.input}
              placeholder="Montant (DH) — laissez vide si inconnu"
              keyboardType="decimal-pad"
              value={poste.terms[i].amount}
              onChangeText={(amount) => {
                const terms = [...poste.terms] as [TermState, TermState, TermState];
                terms[i] = { ...terms[i], amount, autoFilled: i === 0 ? terms[i].autoFilled : false };
                const next = { ...poste, terms };
                onChange(i === 0 ? recomputeAutoTerms(next, termMonths) : next);
              }}
              onFocus={onFocus}
            />
            <DateField
              value={poste.terms[i].dueDate}
              onChange={(dueDate) => {
                const terms = [...poste.terms] as [TermState, TermState, TermState];
                terms[i] = { ...terms[i], dueDate };
                onChange({ ...poste, terms });
              }}
            />
            {i > 0 && poste.terms[i].autoFilled && poste.terms[i].amount !== '' && <Text style={styles.autoHint}>Estimation automatique — modifiable</Text>}
          </View>
        ))
      ) : (
        <>
          {!forceIncluded && (
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Je ne connais pas encore le montant</Text>
              <Switch value={poste.unknown} onValueChange={(unknown) => onChange({ ...poste, unknown })} />
            </View>
          )}
          {!poste.unknown && (
            <TextInput
              testID={`${label}-amount`}
              style={styles.input}
              placeholder={poste.frequency === 'mensuel' ? 'Montant mensuel (DH)' : 'Montant (DH)'}
              keyboardType="decimal-pad"
              value={poste.amount}
              onChangeText={(amount) => onChange({ ...poste, amount })}
              onFocus={onFocus}
            />
          )}
          <DateField value={poste.dueDate} onChange={(dueDate) => onChange({ ...poste, dueDate })} />
          {poste.frequency === 'mensuel' && <Text style={styles.hint}>Les échéances suivantes seront générées automatiquement (même moteur que les charges récurrentes).</Text>}
          <AlreadyPaidEditor
            testIdPrefix={label}
            value={poste.alreadyPaid}
            accounts={accounts}
            onChange={(alreadyPaid) => onChange({ ...poste, alreadyPaid })}
            onFocus={onFocus}
          />
        </>
      )}
    </View>
  );
}

/**
 * R6.2 (§4-9, §8) : "☐ Déjà payé" — compact, replié par défaut (champs
 * masqués tant que la case n'est pas cochée, §8 "contrôle simple/compact").
 * Compte débité facultatif (CAS A compte connu / CAS B compte inconnu,
 * déjà géré côté backend — cf. already-paid.util.ts) — jamais requis ici.
 */
function AlreadyPaidEditor({
  testIdPrefix,
  value,
  accounts,
  onChange,
  onFocus,
}: {
  testIdPrefix: string;
  value: AlreadyPaidState;
  accounts: Account[];
  onChange: (v: AlreadyPaidState) => void;
  onFocus?: (e: FocusEvent) => void;
}) {
  return (
    <View>
      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Déjà payé</Text>
        <Switch testID={`${testIdPrefix}-already-paid-switch`} value={value.active} onValueChange={(active) => onChange({ ...value, active })} />
      </View>
      {value.active && (
        <>
          <TextInput
            testID={`${testIdPrefix}-already-paid-amount`}
            style={styles.input}
            placeholder="Montant réellement payé (DH)"
            keyboardType="decimal-pad"
            value={value.amount}
            onChangeText={(amount) => onChange({ ...value, amount })}
            onFocus={onFocus}
          />
          <DateField label="Date de paiement" value={value.paidDate} onChange={(paidDate) => onChange({ ...value, paidDate })} />
          {accounts.length > 0 && (
            <Select
              testID={`${testIdPrefix}-already-paid-account-select`}
              label="Compte débité (facultatif)"
              placeholder="Compte inconnu / non précisé"
              value={value.accountId}
              onChange={(accountId) => onChange({ ...value, accountId })}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xxl },
  stepCounter: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  stepHint: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm, marginTop: 12 },
  hint: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm, fontStyle: 'italic' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
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
  miniLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: '600', marginBottom: 4 },
  termMonthBox: { flex: 1 },
  termMonthInput: { textAlign: 'center' },
  distributeButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  distributeButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 12 },
  posteBlock: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: 10 },
  segmentItem: { flex: 1, paddingVertical: spacing.sm, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  termCard: { backgroundColor: colors.background, borderRadius: radius.md, padding: 10, marginBottom: spacing.sm },
  termTitle: { fontSize: 12, fontWeight: '700', color: colors.textPrimary, marginBottom: 6 },
  autoHint: { fontSize: 10, color: colors.warning, marginTop: -6, marginBottom: 4, fontStyle: 'italic' },
  extraBlock: { marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  addExtraButton: { alignItems: 'center', paddingVertical: spacing.sm, marginBottom: spacing.sm },
  addExtraButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  recapHeader: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  recapSub: { fontSize: 12, color: colors.textSecondary, marginBottom: 12 },
  recapRow: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  recapLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  recapDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  recapAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  recapStatus: { fontSize: 10, color: colors.warning, marginTop: 2 },
  recapStatusUnknown: { color: colors.danger, fontWeight: '600' },
  totalsCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border },
  totalsLine: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  totalsLineWarning: { color: colors.danger },
  navRow: { flexDirection: 'row', paddingTop: spacing.xl, paddingHorizontal: spacing.xl, gap: spacing.md },
  navButton: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceSecondary },
  navButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  navButtonPrimary: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.primary, marginTop: spacing.sm },
  navButtonPrimaryText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  gateTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.sm },
  gateHelp: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
});
