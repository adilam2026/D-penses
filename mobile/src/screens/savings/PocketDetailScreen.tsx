import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { useKeyboardAwareScroll } from '../../ui/useKeyboardAwareScroll';
import { Select } from '../../ui/Select';
import { FormField } from '../../ui/FormField';
import { colors, radius, spacing } from '../../ui/theme';

interface Movement {
  id: string;
  status: 'prevu' | 'confirme' | 'en_retard' | 'annule';
  movementType: 'contribution' | 'retrait';
  plannedAmount: number;
  plannedDate: string;
  intentionLabel: string | null;
}

interface CoverageItem {
  deadlineId: string;
  dueDate: string;
  resteAPayer: number;
  coverageAffectee: number;
  engagementNonCouvert: number;
}

interface PocketDetail {
  id: string;
  name: string;
  allocationMode: 'virtual_allocation' | 'backed_by_account';
  currentAmount: number;
  isProtected?: boolean;
  targetAmount?: number | null;
  linkedAccountId?: string | null;
  coverage?: CoverageItem[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

// Vague 2 §11 — une seule entrée pour l'utilisateur ("Enveloppe"), la nature
// (Provision/Poche, protégée ou non) reste une information secondaire affichée
// en badge, jamais le concept principal exposé à l'écran.
function natureLabel(isProvision: boolean, isProtected?: boolean): string {
  if (isProvision) return 'Réservation';
  return isProtected ? 'Épargne protégée' : 'Épargne';
}

/**
 * Fiche enveloppe (Provision ou Poche d'épargne, unifiées en vocabulaire — §27/§20/Vague 2 §11).
 * Solde dérivé, jamais un compte. Pour une Provision, affiche aussi la couverture
 * chronologique (RG-090) et permet de payer une échéance couverte directement (§18-20).
 */
export function PocketDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const { scrollRef, handleFocus } = useKeyboardAwareScroll();
  const kind = route.params?.kind as 'pocket' | 'provision';
  const id = route.params?.id as string;
  const isProvision = kind === 'provision';

  const [detail, setDetail] = useState<PocketDetail | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [intentionLabel, setIntentionLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payingDeadlineId, setPayingDeadlineId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [accounts, setAccounts] = useState<{ id: string; name: string }[]>([]);
  const [payAccountId, setPayAccountId] = useState<string | null>(null);
  const [linkDeadlineId, setLinkDeadlineId] = useState('');
  const [openDeadlines, setOpenDeadlines] = useState<{ id: string; chargePlan: { label: string }; dueDate: string }[]>([]);
  const [linking, setLinking] = useState(false);
  const [confirmingMovementId, setConfirmingMovementId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [editAccountId, setEditAccountId] = useState<string | null>(null);
  const [savingAccount, setSavingAccount] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = isProvision ? await api.getProvision(id) : await api.getPocket(id);
      setDetail(d);
      setMovements(isProvision ? await api.listProvisionMovements(id) : await api.listPocketMovements(id));
      const accs = await api.listAccounts();
      setAccounts(accs);
      if (isProvision) {
        const open = await api.listOpenDeadlines();
        setOpenDeadlines(open);
        if (!payAccountId && accs.length) setPayAccountId(d.allocationMode === 'backed_by_account' ? d.linkedAccountId ?? accs[0].id : accs[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [id, isProvision]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onContribute() {
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      if (isProvision) await api.contributeProvision(id, { amount: value, intentionLabel: intentionLabel || undefined });
      else await api.contributePocket(id, { amount: value, intentionLabel: intentionLabel || undefined });
      setAmount('');
      setIntentionLabel('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Impossible de mettre de côté');
    } finally {
      setSubmitting(false);
    }
  }

  async function onWithdraw() {
    setError(null);
    const value = Number(amount.replace(',', '.'));
    if (!value || value <= 0) {
      setError('Montant invalide');
      return;
    }
    setSubmitting(true);
    try {
      if (isProvision) await api.withdrawProvision(id, { amount: value });
      else await api.withdrawPocket(id, { amount: value });
      setAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Retrait impossible');
    } finally {
      setSubmitting(false);
    }
  }

  async function onLinkDeadline() {
    if (!linkDeadlineId || linking) return;
    setError(null);
    setLinking(true);
    try {
      await api.linkProvisionDeadline(id, linkDeadlineId);
      setLinkDeadlineId('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Liaison impossible');
    } finally {
      setLinking(false);
    }
  }

  async function onConfirmMovement(movementId: string) {
    if (confirmingMovementId) return;
    setConfirmingMovementId(movementId);
    try {
      if (isProvision) await api.confirmProvisionMovement(movementId);
      else await api.confirmPocketMovement(movementId);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Confirmation impossible');
    } finally {
      setConfirmingMovementId(null);
    }
  }

  async function onPayWithProvision(deadlineId: string) {
    setError(null);
    const value = Number(payAmount.replace(',', '.'));
    if (!value || value <= 0 || !payAccountId) {
      setError('Montant ou compte invalide');
      return;
    }
    setSubmitting(true);
    try {
      await api.payDeadlineWithProvision(deadlineId, { amount: value, accountId: payAccountId, provisionId: id });
      setPayingDeadlineId(null);
      setPayAmount('');
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Paiement impossible — provision insuffisante ?');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSaveLinkedAccount() {
    setSavingAccount(true);
    setError(null);
    try {
      if (isProvision) await api.updateProvision(id, { linkedAccountId: editAccountId ?? undefined });
      else await api.updatePocket(id, { linkedAccountId: editAccountId ?? undefined });
      setEditingAccount(false);
      await load();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setSavingAccount(false);
    }
  }

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <Text style={styles.title}>{detail.name}</Text>
        <Text style={styles.natureBadge}>{natureLabel(isProvision, detail.isProtected)}</Text>
      </View>
      <Text style={styles.amount}>{detail.currentAmount.toLocaleString('fr-FR')} DH</Text>
      {detail.targetAmount ? <Text style={styles.subtitle}>Objectif : {detail.targetAmount.toLocaleString('fr-FR')} DH</Text> : null}
      <Text style={styles.subtitle}>{detail.allocationMode === 'backed_by_account' ? 'Compte dédié' : 'Réservation virtuelle — reste sur votre compte'}</Text>

      {detail.allocationMode === 'virtual_allocation' && (
        <View style={styles.locationRow}>
          {editingAccount ? (
            <View style={styles.formCard}>
              <Select
                testID="pocket-edit-account-select"
                label="Localiser sur quel compte ?"
                placeholder="Choisir un compte"
                value={editAccountId}
                onChange={setEditAccountId}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
              <View style={styles.buttonRow}>
                <TouchableOpacity style={[styles.button, styles.buttonHalf]} onPress={onSaveLinkedAccount} disabled={savingAccount || !editAccountId}>
                  {savingAccount ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.buttonHalf, styles.buttonSecondary]} onPress={() => setEditingAccount(false)} disabled={savingAccount}>
                  <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Annuler</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setEditAccountId(detail.linkedAccountId ?? accounts[0]?.id ?? null);
                setEditingAccount(true);
              }}
            >
              <Text style={styles.editLink}>
                Localisée sur : {accounts.find((a) => a.id === detail.linkedAccountId)?.name ?? 'Non précisé'} · Modifier
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {detail.allocationMode === 'virtual_allocation' ? (
        <View style={styles.formCard}>
          <FormField testID="pocket-contribute-amount-input" placeholder="Montant (DH)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} onFocus={handleFocus} />
          <FormField testID="pocket-intention-input" placeholder="Intention (facultatif)" value={intentionLabel} onChangeText={setIntentionLabel} onFocus={handleFocus} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <TouchableOpacity style={[styles.button, styles.buttonHalf]} onPress={onContribute} disabled={submitting}>
              {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>+ Mettre de côté</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.buttonHalf, styles.buttonSecondary]} onPress={onWithdraw} disabled={submitting}>
              <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Retirer</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <Text style={styles.help}>Utilisez un virement (écran Comptes) vers le compte dédié pour faire grandir cette provision — jamais une simple écriture logique.</Text>
      )}

      {isProvision && (
        <>
          <Text style={styles.sectionTitle}>Échéances liées</Text>
          {/* R5 clôture §6 — sélecteur compact au lieu de saisir un ID brut + une
              liste de chips arbitrairement tronquée à 6 (jamais une échéance
              réelle rendue impossible à choisir faute de place). */}
          <View style={styles.linkRow}>
            <View style={styles.linkSelect}>
              <Select
                testID="pocket-link-deadline-select"
                placeholder="Choisir une échéance à lier"
                value={linkDeadlineId || null}
                onChange={setLinkDeadlineId}
                options={openDeadlines.map((d) => ({ value: d.id, label: d.chargePlan.label, sublabel: formatDate(d.dueDate) }))}
              />
            </View>
            <TouchableOpacity style={styles.linkButton} onPress={onLinkDeadline} disabled={linking}>
              {linking ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.linkButtonText}>Lier</Text>}
            </TouchableOpacity>
          </View>

          {(detail.coverage ?? []).map((c) => (
            <View key={c.deadlineId} style={styles.coverageCard}>
              <Text style={styles.coverageDate}>Échéance du {formatDate(c.dueDate)}</Text>
              <Text style={styles.coverageLine}>Reste à payer : {c.resteAPayer.toLocaleString('fr-FR')} DH</Text>
              <Text style={styles.coverageLine}>Couvert : {c.coverageAffectee.toLocaleString('fr-FR')} DH</Text>
              <Text style={[styles.coverageLine, c.engagementNonCouvert > 0 && styles.coverageWarning]}>
                Encore à couvrir : {c.engagementNonCouvert.toLocaleString('fr-FR')} DH
              </Text>

              {payingDeadlineId === c.deadlineId ? (
                <View style={styles.payForm}>
                  <FormField testID={`pocket-pay-amount-${c.deadlineId}`} placeholder="Montant (DH)" keyboardType="decimal-pad" value={payAmount} onChangeText={setPayAmount} onFocus={handleFocus} />
                  {detail.allocationMode === 'backed_by_account' ? (
                    <Text style={styles.rowMeta}>
                      Compte débité : {accounts.find((a) => a.id === payAccountId)?.name ?? '—'} (enveloppe dédiée, compte imposé)
                    </Text>
                  ) : (
                    <Select
                      testID={`pocket-pay-account-select-${c.deadlineId}`}
                      placeholder="Choisir un compte"
                      value={payAccountId}
                      onChange={setPayAccountId}
                      options={accounts.map((a) => ({ value: a.id, label: a.name }))}
                    />
                  )}
                  <TouchableOpacity style={styles.button} onPress={() => onPayWithProvision(c.deadlineId)} disabled={submitting}>
                    {submitting ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Confirmer le paiement</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.payLink}
                  onPress={() => {
                    setPayingDeadlineId(c.deadlineId);
                    setPayAmount(String(Math.min(c.coverageAffectee, c.resteAPayer)));
                  }}
                >
                  <Text style={styles.payLinkText}>Payer avec cette Provision</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </>
      )}

      <Text style={styles.sectionTitle}>Mouvements</Text>
      <FlatList
        data={movements}
        keyExtractor={(m) => m.id}
        scrollEnabled={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={<Text style={styles.empty}>Aucun mouvement pour l'instant.</Text>}
        renderItem={({ item }) => (
          <View style={styles.movementRow}>
            <View>
              <Text style={styles.movementLabel}>
                {item.movementType === 'contribution' ? 'Contribution' : 'Retrait'} · {formatDate(item.plannedDate)}
                {item.status === 'prevu' ? ' (prévue)' : ''}
              </Text>
              {item.intentionLabel ? <Text style={styles.movementIntention}>{item.intentionLabel}</Text> : null}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.movementAmount, item.movementType === 'retrait' && styles.movementAmountNegative]}>
                {item.movementType === 'contribution' ? '+' : '-'}
                {item.plannedAmount.toLocaleString('fr-FR')} DH
              </Text>
              {item.status === 'prevu' && (
                <TouchableOpacity onPress={() => onConfirmMovement(item.id)} disabled={confirmingMovementId === item.id}>
                  {confirmingMovementId === item.id ? <ActivityIndicator size="small" /> : <Text style={styles.confirmLink}>Confirmer</Text>}
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      />

      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Retour</Text>
      </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl, paddingTop: spacing.xxl },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  natureBadge: { fontSize: 10, fontWeight: '700', color: colors.success, backgroundColor: colors.successLight, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  amount: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, marginTop: spacing.sm },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
  help: { fontSize: 12, color: colors.textSecondary, marginTop: spacing.md, fontStyle: 'italic' },
  locationRow: { marginTop: spacing.sm },
  editLink: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: colors.textPrimary, marginBottom: spacing.sm },
  rowMeta: { fontSize: 11, color: colors.textSecondary, marginBottom: spacing.sm },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginTop: spacing.lg },
  buttonRow: { flexDirection: 'row' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  buttonHalf: { flex: 1, marginRight: spacing.sm },
  buttonSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.primary, marginRight: 0 },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  buttonTextSecondary: { color: colors.textPrimary },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: spacing.xxl, marginBottom: spacing.md },
  linkRow: { flexDirection: 'row', marginBottom: spacing.sm, alignItems: 'flex-start' },
  linkSelect: { flex: 1, marginRight: spacing.sm },
  linkButton: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  linkButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  coverageCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 14, marginBottom: spacing.sm },
  coverageDate: { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 4 },
  coverageLine: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  coverageWarning: { color: colors.warning, fontWeight: '600' },
  payLink: { marginTop: spacing.sm },
  payLinkText: { color: colors.success, fontSize: 12, fontWeight: '700' },
  payForm: { marginTop: spacing.sm },
  empty: { color: colors.textSecondary, fontSize: 13 },
  movementRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  movementLabel: { fontSize: 12, color: colors.textPrimary, fontWeight: '600' },
  movementIntention: { fontSize: 11, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  movementAmount: { fontSize: 13, fontWeight: '700', color: colors.success },
  movementAmountNegative: { color: colors.danger },
  confirmLink: { color: colors.textPrimary, fontSize: 11, fontWeight: '600', marginTop: 4 },
  cancel: { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg, fontSize: 13, marginBottom: spacing.xxl },
  error: { color: colors.danger, fontSize: 12, marginBottom: spacing.sm },
});
