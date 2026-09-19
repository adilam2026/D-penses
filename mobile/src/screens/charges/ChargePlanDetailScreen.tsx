import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { DateField } from '../../ui/DateField';
import { frequencyOptions } from '../../ui/frequency';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { colors, radius, spacing } from '../../ui/theme';

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

type ObligationStatus = 'obligatoire' | 'optionnelle_envisagee' | 'optionnelle_souscrite' | 'optionnelle_refusee';

interface ChargePlan {
  id: string;
  label: string;
  categoryId: string | null;
  recurrenceRule: string | null;
  recurrenceAnchorDate: string | null;
  status: 'actif' | 'inactif';
  obligationStatus: ObligationStatus;
  financialPlanId: string | null;
  // Corrections consolidées §8 — compte d'imputation par défaut, préremplissage
  // uniquement au moment du paiement (jamais imposé, cf. DeadlineDetailScreen).
  defaultAccountId?: string | null;
}

interface Account {
  id: string;
  name: string;
}

const OBLIGATION_STATUS_OPTIONS: { value: ObligationStatus; label: string }[] = [
  { value: 'obligatoire', label: 'Obligatoire' },
  { value: 'optionnelle_envisagee', label: 'Option envisagée' },
  { value: 'optionnelle_souscrite', label: 'Option retenue (souscrite)' },
  { value: 'optionnelle_refusee', label: 'Option refusée' },
];

interface Deadline {
  id: string;
  dueDate: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  resteAPayer: number | string | null;
}

const AMOUNT_STATUS_LABEL: Record<'estime' | 'confirme' | 'inconnu', string> = { estime: 'Estimé', confirme: 'Confirmé', inconnu: 'Inconnu' };

const STATUS_LABEL: Record<Deadline['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

const RECURRENCE_VALUES = ['hebdomadaire', 'mensuel', 'trimestriel', 'semestriel', 'annuel', 'ponctuel'] as const;

function n(v: number | string | null): number | null {
  if (v === null) return null;
  return typeof v === 'number' ? v : Number(v);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Recette post-Vague 3 (§4/§15) — détail d'une charge récurrente : modifier
 * (label/catégorie/fréquence), arrêter la récurrence (status=inactif — jamais
 * la même chose que supprimer) ou supprimer (bloqué avec historique de
 * paiement, RG implicite). Chaque échéance liste séparément, tap → détail
 * (paiement déjà géré par DeadlineDetailScreen, jamais dupliqué ici).
 */
export function ChargePlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const id = route.params?.id as string;

  const [plan, setPlan] = useState<ChargePlan | null>(null);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  // R6.4 (§4) — "Garderie T1/T2/T3" (options envisagées d'un plan) sont de simples
  // ChargePlan : changer cet état (ex. envisagée → souscrite) suffit à les faire
  // basculer d'"Options envisagées" vers les échéances certaines du plan, SANS
  // double comptage (financial-plans.service.ts classe déjà sur ce seul champ).
  const [obligationStatus, setObligationStatus] = useState<ObligationStatus>('obligatoire');
  const [recurrenceRule, setRecurrenceRule] = useState('ponctuel');
  // R6.2 (§1/§3) : une seule "prochaine échéance" éditable, jamais un jour du
  // mois séparé — modifier ce champ ne touche jamais l'historique (seules les
  // échéances encore ouvertes sans paiement sont régénérées côté backend).
  const [anchorDate, setAnchorDate] = useState('');
  // R6.2 (§3) : édition de montant optionnelle et explicite — ne s'applique
  // qu'aux échéances futures encore ouvertes, jamais rétroactive.
  const [editAmount, setEditAmount] = useState(false);
  const [amountStatus, setAmountStatus] = useState<'estime' | 'confirme' | 'inconnu'>('estime');
  const [amount, setAmount] = useState('');
  // Corrections consolidées §8 — compte d'imputation par défaut : sert
  // UNIQUEMENT de préremplissage au moment du paiement (jamais imposé).
  const [defaultAccountId, setDefaultAccountId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingStatus, setTogglingStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Corrections consolidées §14.1 — "Retirer du plan", distinct de "Supprimer".
  const [retiring, setRetiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, d, categoryList, accountList] = await Promise.all([
        api.getChargePlan(id),
        api.listChargePlanDeadlines(id),
        api.listCategories(),
        api.listAccounts(),
      ]);
      setPlan(p);
      setDeadlines(d);
      setCategories((categoryList as Category[]).filter((c) => c.kind === 'expense' || c.kind === 'both'));
      setAccounts(accountList as Account[]);
      setLabel(p.label);
      setCategoryId(p.categoryId);
      setObligationStatus(p.obligationStatus);
      setRecurrenceRule(p.recurrenceRule ?? 'ponctuel');
      setAnchorDate(p.recurrenceAnchorDate ? String(p.recurrenceAnchorDate).slice(0, 10) : '');
      setDefaultAccountId(p.defaultAccountId ?? null);
      setEditAmount(false);
      setAmountStatus('estime');
      setAmount('');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onSave() {
    setError(null);
    if (!label.trim()) {
      setError('Un libellé est requis');
      return;
    }
    if (recurrenceRule !== 'ponctuel' && !anchorDate) {
      setError('La prochaine échéance est requise pour une charge récurrente');
      return;
    }
    if (editAmount && amountStatus !== 'inconnu' && (!amount.trim() || Number(amount.replace(',', '.')) <= 0)) {
      setError('Montant invalide');
      return;
    }
    setSaving(true);
    try {
      await api.updateChargePlan(id, {
        label: label.trim(),
        categoryId: categoryId ?? null,
        obligationStatus,
        recurrenceRule: recurrenceRule === 'ponctuel' ? undefined : recurrenceRule,
        recurrenceAnchorDate: recurrenceRule === 'ponctuel' ? null : anchorDate,
        defaultAccountId,
        ...(editAmount
          ? { amountStatus, amountCurrent: amountStatus !== 'inconnu' ? Number(amount.replace(',', '.')) : undefined }
          : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSaving(false);
    }
  }

  async function onToggleStatus() {
    if (!plan) return;
    setError(null);
    setTogglingStatus(true);
    try {
      await api.updateChargePlan(id, { status: plan.status === 'actif' ? 'inactif' : 'actif' });
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Opération impossible');
    } finally {
      setTogglingStatus(false);
    }
  }

  function onDelete() {
    Alert.alert('Supprimer cette charge ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          setError(null);
          setDeleting(true);
          try {
            await api.deleteChargePlan(id);
            navigation.goBack();
          } catch (err) {
            setError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  }

  // Corrections consolidées §14.1 — "Retirer du plan" : jamais une suppression.
  // L'historique payé est intégralement conservé, seules les échéances futures
  // sans paiement sont annulées, et le poste est détaché du plan.
  function onRetire() {
    Alert.alert(
      'Retirer ce poste du plan ?',
      "Tout paiement déjà enregistré reste intégralement conservé, même partiel. Les échéances encore ouvertes (y compris leur reliquat non payé) seront annulées et ne resteront plus dues. Le poste sera retiré du plan et sa récurrence arrêtée.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer du plan',
          style: 'destructive',
          onPress: async () => {
            setError(null);
            setRetiring(true);
            try {
              await api.retireChargePlan(id);
              navigation.goBack();
            } catch (err) {
              setError(err instanceof api.ApiError ? err.message : 'Retrait impossible');
            } finally {
              setRetiring(false);
            }
          },
        },
      ],
    );
  }

  if (loading && !plan) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!plan) return null;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
        {plan.status === 'inactif' && (
          <View style={styles.inactiveBanner}>
            <Text style={styles.inactiveBannerText}>Récurrence arrêtée — aucune nouvelle échéance ne sera générée.</Text>
          </View>
        )}

        <FormField testID="chargeplan-label-input" label="Libellé" value={label} onChangeText={setLabel} onFocus={handleFocus} />

        {/* R6.4 (§4) — "Garderie T1/T2/T3" (options envisagées) sont modifiables ici :
            changer cet état bascule automatiquement entre "Options envisagées" et
            échéances certaines du plan (financial-plans.service.ts), jamais un double
            comptage puisqu'un ChargePlan n'appartient jamais aux deux groupes à la fois. */}
        {plan.financialPlanId && (
          <Select
            testID="chargeplan-obligation-status-select"
            label="Statut de l'option"
            value={obligationStatus}
            onChange={(v) => setObligationStatus(v as ObligationStatus)}
            options={OBLIGATION_STATUS_OPTIONS}
          />
        )}

        {categories.length > 0 && (
          <Select
            testID="chargeplan-category-select"
            label="Catégorie"
            placeholder="Sélectionner une catégorie"
            value={categoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            onChange={setCategoryId}
          />
        )}

        <Select
          testID="chargeplan-frequency-select"
          label="Fréquence"
          value={recurrenceRule}
          options={frequencyOptions(RECURRENCE_VALUES)}
          onChange={setRecurrenceRule}
        />

        {recurrenceRule !== 'ponctuel' && <DateField label="Prochaine échéance" value={anchorDate} onChange={setAnchorDate} />}

        {accounts.length > 0 && (
          <>
            <Select
              testID="chargeplan-default-account-select"
              label="Compte d'imputation par défaut (facultatif)"
              placeholder="Aucun compte par défaut"
              value={defaultAccountId ?? ''}
              onChange={(v) => setDefaultAccountId(v || null)}
              options={[{ value: '', label: 'Aucun compte par défaut' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
            />
            <Text style={styles.amountHint}>
              Sert uniquement à préremplir le compte au moment du paiement — jamais imposé, toujours modifiable à ce moment-là.
            </Text>
          </>
        )}

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>Modifier le montant des prochaines échéances</Text>
          <Switch testID="chargeplan-edit-amount-switch" value={editAmount} onValueChange={setEditAmount} />
        </View>
        {editAmount && (
          <>
            <View style={styles.segment}>
              {(['estime', 'confirme', 'inconnu'] as const).map((s) => (
                <TouchableOpacity key={s} style={[styles.segmentItem, amountStatus === s && styles.segmentActive]} onPress={() => setAmountStatus(s)}>
                  <Text style={[styles.segmentText, amountStatus === s && styles.segmentTextActive]}>{AMOUNT_STATUS_LABEL[s]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {amountStatus !== 'inconnu' && (
              <FormField
                testID="chargeplan-amount-input"
                placeholder="Montant (DH)"
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
                onFocus={handleFocus}
              />
            )}
            <Text style={styles.amountHint}>S'applique uniquement aux échéances futures encore ouvertes — jamais à une échéance déjà payée.</Text>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <TouchableOpacity style={styles.button} onPress={onSave} disabled={saving} testID="chargeplan-save">
          {saving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.buttonSecondary} onPress={onToggleStatus} disabled={togglingStatus} testID="chargeplan-toggle-status">
            {togglingStatus ? (
              <ActivityIndicator color={colors.textPrimary} />
            ) : (
              <Text style={styles.buttonSecondaryText}>{plan.status === 'actif' ? 'Arrêter la récurrence' : 'Réactiver'}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonDanger} onPress={onDelete} disabled={deleting} testID="chargeplan-delete">
            {deleting ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.buttonDangerText}>Supprimer</Text>}
          </TouchableOpacity>
        </View>

        {/* Corrections consolidées §14.1 — action distincte de "Supprimer", visible
            uniquement pour un poste rattaché à un plan financier. */}
        {plan.financialPlanId && (
          <TouchableOpacity style={styles.buttonRetire} onPress={onRetire} disabled={retiring} testID="chargeplan-retire">
            {retiring ? <ActivityIndicator color={colors.textPrimary} /> : <Text style={styles.buttonRetireText}>Retirer du plan</Text>}
          </TouchableOpacity>
        )}

        <Text style={styles.sectionTitle}>Échéances</Text>
        {deadlines.length === 0 ? (
          <Text style={styles.empty}>Aucune échéance pour l'instant.</Text>
        ) : (
          deadlines.map((d) => (
            <TouchableOpacity key={d.id} style={styles.deadlineRow} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
              <View style={{ flex: 1 }}>
                <Text style={styles.deadlineDate}>{formatDate(d.dueDate)}</Text>
                <Text style={styles.deadlineMeta}>
                  {STATUS_LABEL[d.financialStatus]} · {d.amountStatus === 'confirme' ? 'Confirmé' : d.amountStatus === 'estime' ? 'Estimé' : 'Inconnu'}
                </Text>
              </View>
              <Text style={styles.deadlineAmount}>{n(d.resteAPayer) !== null ? `${n(d.resteAPayer)!.toLocaleString('fr-FR')} DH` : '—'}</Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  inactiveBanner: { backgroundColor: colors.dangerLight, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.lg },
  inactiveBannerText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: 6 },
  toggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm, marginTop: spacing.xs },
  toggleLabel: { fontSize: 13, color: colors.textPrimary, flex: 1, marginRight: spacing.sm },
  segment: { flexDirection: 'row', backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, padding: 4, marginBottom: spacing.sm },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  segmentTextActive: { color: colors.textPrimary },
  amountHint: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
  actionsRow: { flexDirection: 'row', marginTop: spacing.md, justifyContent: 'space-between' },
  buttonSecondary: { flex: 1, backgroundColor: colors.surfaceActive, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginRight: spacing.sm },
  buttonSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  buttonDanger: { flex: 1, backgroundColor: colors.dangerLight, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' },
  buttonDangerText: { color: colors.danger, fontWeight: '600', fontSize: 13 },
  buttonRetire: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: spacing.sm },
  buttonRetireText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  deadlineRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  deadlineDate: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  deadlineMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  deadlineAmount: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
});
