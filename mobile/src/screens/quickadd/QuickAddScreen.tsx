import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';

type Mode = 'depense' | 'revenu' | 'paiement' | 'transfert';

interface Account {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'both';
}

interface OpenDeadline {
  id: string;
  dueDate: string;
  resteAPayer: number | null;
  chargePlan: { label: string };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const MODE_LABEL: Record<Mode, string> = {
  depense: '+ Dépense',
  revenu: '+ Revenu',
  paiement: '+ Échéance',
  transfert: '+ Transfert',
};

/**
 * Saisie rapide « + » (Lot 3 §2/§16). Quatre actions bien distinctes :
 * - Dépense : dépense réelle ponctuelle (courses, essence...) — jamais de
 *   ChargePlan/Deadline créés, seulement une BudgetExpense ou AdHocExpense.
 * - Paiement d'une échéance : Payment rattaché à une Deadline EXISTANTE,
 *   jamais une Deadline créée artificiellement pour l'occasion (correction §2).
 */
export function QuickAddScreen() {
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<Mode>('depense');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [budgetHint, setBudgetHint] = useState<string | null>(null);

  const [openDeadlines, setOpenDeadlines] = useState<OpenDeadline[]>([]);
  const [deadlineId, setDeadlineId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accountList, quickDefault, categoryList, deadlines] = await Promise.all([
        api.listAccounts(),
        api.getQuickAddDefaultAccount(),
        api.listCategories(),
        api.listOpenDeadlines(),
      ]);
      setAccounts(accountList);
      setAccountId(quickDefault.accountId ?? (accountList[0]?.id ?? null));
      setCategories(categoryList);
      setOpenDeadlines(deadlines);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setBudgetHint(null);
    if (mode !== 'depense' || !categoryId) return;
    let cancelled = false;
    api
      .findActiveBudgetsForCategory(categoryId)
      .then((budgets: Array<{ status: { budgetContractuelRestant: number } }>) => {
        if (cancelled || budgets.length !== 1) return;
        const category = categories.find((c) => c.id === categoryId);
        setBudgetHint(`Budget ${category?.name ?? ''} : ${budgets[0].status.budgetContractuelRestant.toLocaleString('fr-FR')} DH restants cette période`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode, categoryId, categories]);

  function onSelectDeadline(d: OpenDeadline) {
    setDeadlineId(d.id);
    if (d.resteAPayer !== null) setAmount(String(d.resteAPayer));
  }

  async function onSubmit() {
    setError(null);
    const numericAmount = Number(amount.replace(',', '.'));
    if (!numericAmount || numericAmount <= 0) {
      setError('Montant invalide');
      return;
    }
    if (mode !== 'transfert' && !accountId) {
      setError('Aucun compte disponible — créez un compte dans « Plus » d\'abord');
      return;
    }

    setSubmitting(true);
    try {
      const today = todayIso();
      if (mode === 'depense') {
        await api.createExpense({ amount: numericAmount, accountId: accountId!, categoryId: categoryId ?? undefined, notes: notes || undefined });
      } else if (mode === 'revenu') {
        if (!label.trim()) {
          setError('Un libellé est requis');
          setSubmitting(false);
          return;
        }
        const source = await api.createIncomeSource({
          label: label.trim(),
          usualAmount: numericAmount,
          defaultAccountId: accountId!,
          isRecurring: false,
          recurrenceRule: 'ponctuel',
        });
        const occurrence = await api.createIncomeOccurrence(source.id, { usualDate: today, plannedAmount: numericAmount });
        await api.confirmIncomeOccurrence(occurrence.id, { actualAmount: numericAmount, actualDate: today, accountId: accountId! });
      } else if (mode === 'paiement') {
        if (!deadlineId) {
          setError('Choisissez une échéance à payer');
          setSubmitting(false);
          return;
        }
        await api.createPayment(deadlineId, { amount: numericAmount, accountId: accountId!, paidDate: today });
      } else {
        if (!toAccountId || toAccountId === accountId) {
          setError('Choisissez un compte de destination différent');
          setSubmitting(false);
          return;
        }
        await api.createTransfer({ fromAccountId: accountId!, toAccountId, amount: numericAmount, plannedDate: today });
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Enregistrement impossible');
    } finally {
      setSubmitting(false);
    }
  }

  const expenseCategories = categories.filter((c) => c.kind === 'expense' || c.kind === 'both');

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Ajouter</Text>

        <View style={styles.modeRow}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <TouchableOpacity key={m} style={[styles.modeChip, mode === m && styles.modeChipActive]} onPress={() => setMode(m)}>
              <Text style={[styles.modeChipText, mode === m && styles.modeChipTextActive]}>{MODE_LABEL[m]}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 24 }} />
        ) : (
          <>
            {mode === 'revenu' && (
              <TextInput style={styles.input} placeholder="Libellé (ex. Salaire)" value={label} onChangeText={setLabel} />
            )}

            {mode === 'paiement' && (
              <>
                <Text style={styles.sectionLabel}>Échéance à payer</Text>
                {openDeadlines.length === 0 ? (
                  <Text style={styles.empty}>Aucune échéance ouverte pour l'instant.</Text>
                ) : (
                  <View style={styles.pickList}>
                    {openDeadlines.map((d) => (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.pickRow, deadlineId === d.id && styles.pickRowActive]}
                        onPress={() => onSelectDeadline(d)}
                      >
                        <Text style={styles.pickRowLabel}>{d.chargePlan.label}</Text>
                        <Text style={styles.pickRowMeta}>
                          {d.resteAPayer !== null ? `${d.resteAPayer.toLocaleString('fr-FR')} DH restants` : 'Montant inconnu'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />

            {mode === 'depense' && (
              <>
                <Text style={styles.sectionLabel}>Catégorie</Text>
                <View style={styles.chipRow}>
                  {expenseCategories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.chip, categoryId === c.id && styles.chipActive]}
                      onPress={() => setCategoryId(categoryId === c.id ? null : c.id)}
                    >
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {budgetHint ? <Text style={styles.hint}>{budgetHint}</Text> : null}
                <TextInput style={styles.input} placeholder="Note (facultatif)" value={notes} onChangeText={setNotes} />
              </>
            )}

            <Text style={styles.sectionLabel}>{mode === 'transfert' ? 'Compte source' : 'Compte'}</Text>
            <View style={styles.chipRow}>
              {accounts.map((a) => (
                <TouchableOpacity key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                  <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {mode === 'transfert' && (
              <>
                <Text style={styles.sectionLabel}>Compte destination</Text>
                <View style={styles.chipRow}>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[styles.chip, toAccountId === a.id && styles.chipActive]}
                        onPress={() => setToAccountId(a.id)}
                      >
                        <Text style={[styles.chipText, toAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
                      </TouchableOpacity>
                    ))}
                </View>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer</Text>}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancel}>Annuler</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 16, textAlign: 'center' },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginBottom: 16 },
  modeChip: {
    backgroundColor: '#EDEBE6',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 4,
    marginBottom: 8,
  },
  modeChipActive: { backgroundColor: '#172436' },
  modeChipText: { fontSize: 12, color: '#6B747C', fontWeight: '600' },
  modeChipTextActive: { color: '#fff' },
  input: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#E3E1DC',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  empty: { color: '#6B747C', fontSize: 13, marginBottom: 12 },
  pickList: { marginBottom: 12 },
  pickRow: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E3E1DC' },
  pickRowActive: { borderColor: '#172436', backgroundColor: '#EEF0F3' },
  pickRowLabel: { fontSize: 14, fontWeight: '600', color: '#172436' },
  pickRowMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
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
  hint: { fontSize: 12, color: '#6B747C', marginBottom: 12, fontStyle: 'italic' },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
