import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { DateField } from '../../ui/DateField';
import { FormField } from '../../ui/FormField';
import { MultiSelect } from '../../ui/MultiSelect';
import { Select } from '../../ui/Select';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import {
  AMOUNT_STATUS_OPTIONS,
  COMPLETUDE_LABEL,
  COVERAGE_ICON,
  COVERAGE_LABEL,
  Child,
  FinancialPlanDetail,
  STATUS_LABEL,
  STATUS_MARK,
  formatShortDate,
} from './financialPlanDetailLogic';

/**
 * Portail Web v4 (WEB-V4.4A) — FinancialPlanDetail desktop : synthèse +
 * coverage à gauche, puis DEUX sections distinctes — "Échéances certaines" et
 * "Échéances envisagées" — jamais mélangées (+ "Éléments inconnus" séparé).
 * Panneau droit : Ajouter une échéance / Modifier le plan / Dupliquer
 * (mini-wizard overlay inchangé). Suppression via menu "•••" dans l'en-tête.
 */
export function FinancialPlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const [detail, setDetail] = useState<FinancialPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateStep, setDuplicateStep] = useState<'form' | 'recap'>('form');
  const [duplicateLabel, setDuplicateLabel] = useState('');
  const [children, setChildren] = useState<Child[]>([]);
  const [duplicateChildIds, setDuplicateChildIds] = useState<string[]>([]);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [addLabel, setAddLabel] = useState('');
  const [addCategoryId, setAddCategoryId] = useState<string | null>(null);
  const [addAmountStatus, setAddAmountStatus] = useState<'confirme' | 'estime' | 'inconnu'>('confirme');
  const [addAmount, setAddAmount] = useState('');
  const [addDueDate, setAddDueDate] = useState('');
  const [addChildIds, setAddChildIds] = useState<string[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d: FinancialPlanDetail = await api.getFinancialPlan(id);
      d.deadlinesCertain = [...d.deadlinesCertain].sort((a, b) => {
        const byDate = a.dueDate.localeCompare(b.dueDate);
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });
      setDetail(d);
      setEditLabel(d.label);
      setEditPeriodStart(d.periodStart.slice(0, 10));
      setEditPeriodEnd(d.periodEnd.slice(0, 10));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const loadChildren = useCallback(async () => {
    setChildren(await api.listChildren());
  }, []);

  const loadCategories = useCallback(async () => {
    const all: Array<{ id: string; name: string; kind: string }> = await api.listCategories();
    setCategories(all.filter((c) => c.kind === 'expense' || c.kind === 'both'));
  }, []);

  React.useEffect(() => {
    loadChildren();
    loadCategories();
  }, [loadChildren, loadCategories]);

  async function onCreateDeadline() {
    if (!addLabel.trim()) {
      setAddError('Le libellé est obligatoire');
      return;
    }
    if (!addDueDate) {
      setAddError("La date d'échéance est obligatoire");
      return;
    }
    if (addAmountStatus !== 'inconnu' && (!addAmount.trim() || Number(addAmount.replace(',', '.')) <= 0)) {
      setAddError('Montant invalide');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const newPlan = await api.createChargePlan({
        label: addLabel.trim(),
        startDate: addDueDate,
        categoryId: addCategoryId ?? undefined,
        childIds: addChildIds,
        financialPlanId: id,
        generationMode: 'calendrier_manuel',
        obligationStatus: 'optionnelle_souscrite',
      });
      await api.createDeadline(newPlan.id, {
        dueDate: addDueDate,
        amountCurrent: addAmountStatus !== 'inconnu' ? Number(addAmount.replace(',', '.')) : undefined,
        amountStatus: addAmountStatus,
      });
      setAddLabel('');
      setAddCategoryId(null);
      setAddAmountStatus('confirme');
      setAddAmount('');
      setAddDueDate('');
      setAddChildIds([]);
      await load();
    } catch (err) {
      setAddError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setAdding(false);
    }
  }

  async function onSaveEdit() {
    if (!editLabel.trim()) {
      setEditError('Le nom du plan est obligatoire');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateFinancialPlan(id, { label: editLabel.trim(), periodStart: editPeriodStart, periodEnd: editPeriodEnd });
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  function openDuplicate() {
    if (!detail) return;
    setDuplicateStep('form');
    setDuplicateLabel(`${detail.label} (copie)`);
    setDuplicateChildIds([]);
    setDuplicateError(null);
    setDuplicateOpen(true);
  }

  function onGoToRecap() {
    if (!duplicateLabel.trim()) {
      setDuplicateError('Le nom de la copie est obligatoire');
      return;
    }
    setDuplicateError(null);
    setDuplicateStep('recap');
  }

  async function onConfirmDuplicate() {
    setDuplicating(true);
    setDuplicateError(null);
    try {
      const copy = await api.duplicateFinancialPlan(id, { label: duplicateLabel.trim(), childIds: duplicateChildIds });
      setDuplicateOpen(false);
      navigation.replace('FinancialPlanDetail', { id: copy.id });
    } catch (err) {
      setDuplicateError(err instanceof api.ApiError ? err.message : 'Duplication impossible');
    } finally {
      setDuplicating(false);
    }
  }

  async function onConfirmDelete() {
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.deleteFinancialPlan(id);
      navigation.goBack();
    } catch (err) {
      setDeleteError(err instanceof api.ApiError ? err.message : 'Suppression impossible');
    } finally {
      setDeleting(false);
    }
  }

  if (loading || !detail) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  const mainContent = (
    <>
      <Text style={styles.completude}>{COMPLETUDE_LABEL[detail.completude]}</Text>
      {deleteError && <Text style={styles.error}>{deleteError}</Text>}

      <View style={styles.figuresGrid}>
        <Figure label="Budget connu" value={detail.knownPlanCost} />
        <Figure label="Payé" value={detail.paidAmount} />
        <Figure label="Reste à payer" value={detail.remainingDue} />
        <Figure label="Provisionné" value={detail.provisionCoverage} />
        <Figure label="Reste à financer" value={detail.remainingToFund} highlight />
      </View>

      {detail.tauxCouverture !== null && (
        <View style={styles.coverageCard}>
          <View style={styles.coverageHeaderRow}>
            <Text style={styles.coverageTitle}>TAUX DE COUVERTURE</Text>
            <Text style={styles.coveragePercent}>{Math.round(detail.tauxCouverture)}%</Text>
          </View>
          <View style={styles.coverageTrack}>
            <View style={[styles.coverageFill, { width: `${Math.min(100, detail.tauxCouverture)}%` }]} />
          </View>
          <Text style={styles.coverageSub}>
            {detail.provisionCoverage.toLocaleString('fr-FR')} DH provisionnés sur {detail.remainingDue.toLocaleString('fr-FR')} DH restant dû
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Échéances certaines</Text>
      {detail.deadlinesCertain.length === 0 ? (
        <Text style={styles.empty}>Aucune échéance certaine pour l'instant.</Text>
      ) : (
        <View style={styles.list}>
          {detail.deadlinesCertain.map((d) => {
            const isOpen = d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee';
            const resteAPayerNum = d.resteAPayer !== null ? Number(d.resteAPayer) : 0;
            const couverturePct = d.coverageStatus !== 'sans_objet' && resteAPayerNum > 0 ? Math.round((d.coverageAffectee / resteAPayerNum) * 100) : null;
            return (
              <TouchableOpacity
                key={d.id}
                testID={`web-plan-deadline-${d.id}`}
                style={styles.row}
                onPress={() => navigation.navigate(d.amountStatus !== 'confirme' ? 'ConfirmDeadline' : 'DeadlineDetail', { id: d.id })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>
                    {COVERAGE_ICON[d.coverageStatus]} {d.chargePlanLabel} · {formatShortDate(d.dueDate)}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {STATUS_MARK[d.financialStatus]} {STATUS_LABEL[d.financialStatus]} · {d.amountStatus === 'confirme' ? 'Montant confirmé' : d.amountStatus === 'estime' ? 'Estimé — cliquer pour confirmer' : 'Montant inconnu'}
                  </Text>
                  {couverturePct !== null && (
                    <Text style={styles.rowCoverage}>
                      Couverture : {couverturePct}% ({COVERAGE_LABEL[d.coverageStatus]}) · Paiement : {STATUS_LABEL[d.financialStatus]}
                    </Text>
                  )}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.rowAmount}>{d.resteAPayer !== null ? `${resteAPayerNum.toLocaleString('fr-FR')} DH restants` : '—'}</Text>
                  {isOpen && (
                    <TouchableOpacity testID={`web-pay-deadline-${d.id}`} style={styles.payButton} onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}>
                      <Text style={styles.payButtonText}>Payer</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Text style={styles.sectionTitle}>Échéances envisagées</Text>
      {detail.envisagedItems.length === 0 ? (
        <Text style={styles.empty}>Aucune option envisagée.</Text>
      ) : (
        <>
          <View style={styles.list}>
            {detail.envisagedItems.map((i) => (
              <TouchableOpacity key={i.chargePlanId} style={styles.rowSimple} testID={`web-plan-envisaged-${i.chargePlanId}`} onPress={() => navigation.navigate('ChargePlanDetail', { id: i.chargePlanId })}>
                <Text style={styles.rowLabel}>{i.label}</Text>
                <Text style={styles.rowMeta}>{i.amountKnown ? 'Montant connu' : 'À décider'} · Modifier →</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.optionTotal}>Options envisagées : {detail.envisagedTotal.toLocaleString('fr-FR')} DH (jamais inclus ci-dessus)</Text>
        </>
      )}

      <Text style={styles.sectionTitle}>Éléments inconnus</Text>
      {detail.unknownItems.length === 0 ? (
        <Text style={styles.empty}>Aucun montant inconnu.</Text>
      ) : (
        <View style={styles.list}>
          {detail.unknownItems.map((i) => (
            <TouchableOpacity key={i.deadlineId} style={styles.rowSimple} onPress={() => navigation.navigate('ConfirmDeadline', { id: i.deadlineId })}>
              <Text style={styles.rowLabel}>{i.label}</Text>
              <Text style={styles.rowMeta}>À confirmer</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </>
  );

  const panel = (
    <View style={{ gap: webSpacing.md }}>
      <View style={styles.panelCard}>
        <Text style={styles.panelTitle}>Ajouter une échéance</Text>
        <FormField testID="web-plan-add-deadline-label" placeholder="Libellé" value={addLabel} onChangeText={setAddLabel} />
        {categories.length > 0 && (
          <Select testID="web-plan-add-deadline-category" label="Catégorie" placeholder="Sélectionner" value={addCategoryId} onChange={setAddCategoryId} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        )}
        <Select
          testID="web-plan-add-deadline-amount-status"
          label="Montant"
          value={addAmountStatus}
          onChange={(v) => setAddAmountStatus(v as 'confirme' | 'estime' | 'inconnu')}
          options={AMOUNT_STATUS_OPTIONS}
        />
        {addAmountStatus !== 'inconnu' && (
          <FormField testID="web-plan-add-deadline-amount" placeholder="Montant (DH)" keyboardType="decimal-pad" value={addAmount} onChangeText={setAddAmount} />
        )}
        <DateField label="Date d'échéance" value={addDueDate} onChange={setAddDueDate} />
        {children.length > 0 && (
          <MultiSelect testID="web-plan-add-deadline-children" label="Enfant(s) bénéficiaire(s)" value={addChildIds} onChange={setAddChildIds} options={children.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} />
        )}
        {addError && <Text style={styles.error}>{addError}</Text>}
        <TouchableOpacity testID="web-plan-add-deadline-save" style={styles.button} onPress={onCreateDeadline} disabled={adding}>
          {adding ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Ajouter</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.panelCard}>
        <Text style={styles.panelTitle}>Modifier le plan</Text>
        <FormField testID="web-plan-edit-label" placeholder="Nom du plan" value={editLabel} onChangeText={setEditLabel} />
        <DateField label="Début" value={editPeriodStart} onChange={setEditPeriodStart} />
        <DateField label="Fin" value={editPeriodEnd} onChange={setEditPeriodEnd} />
        {editError && <Text style={styles.error}>{editError}</Text>}
        <TouchableOpacity testID="web-plan-edit-save" style={styles.button} onPress={onSaveEdit} disabled={editSaving}>
          {editSaving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Enregistrer</Text>}
        </TouchableOpacity>
      </View>

      <TouchableOpacity testID="web-plan-duplicate-open" style={styles.duplicateButton} onPress={openDuplicate}>
        <Text style={styles.duplicateButtonText}>Dupliquer ce plan</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader
        title={detail.label}
        actions={
          <View>
            <TouchableOpacity testID="web-plan-menu-button" style={styles.menuButton} onPress={() => setMenuOpen((v) => !v)}>
              <Text style={styles.menuButtonText}>•••</Text>
            </TouchableOpacity>
            {menuOpen && (
              <View style={styles.menuDropdown}>
                <TouchableOpacity
                  testID="web-plan-menu-delete"
                  style={styles.menuItem}
                  onPress={() => {
                    setMenuOpen(false);
                    setDeleteConfirmOpen(true);
                  }}
                >
                  <Text style={styles.menuItemTextDanger}>Supprimer</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        }
      />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <Modal visible={duplicateOpen} transparent animationType="fade" onRequestClose={() => setDuplicateOpen(false)}>
        <View style={styles.modalOverlay}>
          {duplicateStep === 'form' ? (
            <View style={styles.modalCard} testID="web-plan-duplicate-form">
              <Text style={styles.modalTitle}>Dupliquer le plan</Text>
              <FormField testID="web-plan-duplicate-label" placeholder="Nom de la copie" value={duplicateLabel} onChangeText={setDuplicateLabel} />
              {children.length > 0 && (
                <MultiSelect testID="web-plan-duplicate-children-select" label="Enfant(s) bénéficiaire(s) de la copie" value={duplicateChildIds} onChange={setDuplicateChildIds} options={children.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} />
              )}
              {duplicateError && <Text style={styles.error}>{duplicateError}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setDuplicateOpen(false)}>
                  <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="web-plan-duplicate-next" style={styles.modalButton} onPress={onGoToRecap}>
                  <Text style={styles.modalButtonText}>Suivant</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.modalCard} testID="web-plan-duplicate-recap">
              <Text style={styles.modalTitle}>Confirmer la duplication</Text>
              <Text style={styles.recapIntro}>Vous allez créer un NOUVEAU plan indépendant :</Text>
              <View style={styles.recapCard}>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Nom de la copie</Text>
                  <Text style={styles.recapValue}>{duplicateLabel.trim()}</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Enfant(s) bénéficiaire(s)</Text>
                  <Text style={styles.recapValue}>{duplicateChildIds.length === 0 ? 'Aucun' : children.filter((c) => duplicateChildIds.includes(c.id)).map((c) => `${c.firstName} ${c.lastName}`).join(', ')}</Text>
                </View>
                <View style={[styles.recapRow, styles.recapRowLast]}>
                  <Text style={styles.recapLabel}>Échéances copiées</Text>
                  <Text style={styles.recapValue}>{detail.deadlinesCertain.length}</Text>
                </View>
              </View>
              <Text style={styles.help}>La copie ne reprend jamais les paiements ni l'historique — un échéancier neuf, indépendant de l'original.</Text>
              {duplicateError && <Text style={styles.error}>{duplicateError}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity testID="web-plan-duplicate-back" style={styles.modalButtonSecondary} onPress={() => setDuplicateStep('form')}>
                  <Text style={styles.modalButtonSecondaryText}>Retour</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="web-plan-duplicate-confirm" style={styles.modalButton} onPress={onConfirmDuplicate} disabled={duplicating}>
                  {duplicating ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Confirmer la duplication</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>

      <ConfirmDialog
        testID="web-plan-delete-confirm"
        visible={deleteConfirmOpen}
        title="Supprimer ce plan ?"
        message="Cette action est définitive."
        confirmLabel="Supprimer"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </ScrollView>
  );
}

function Figure({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, highlight && styles.figureValueHighlight]}>{value.toLocaleString('fr-FR')} DH</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: webColors.textSecondary },
  menuDropdown: { position: 'absolute', top: 30, right: 0, backgroundColor: webColors.surface, borderRadius: webRadius.md, borderWidth: 1, borderColor: webColors.border, minWidth: 140, zIndex: 10 },
  menuItem: { paddingHorizontal: webSpacing.md, paddingVertical: 10 },
  menuItemTextDanger: { fontSize: 13, color: webColors.danger, fontWeight: '600' },

  completude: { fontSize: 12, color: webColors.warning, marginBottom: webSpacing.md, fontStyle: 'italic' },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: webSpacing.sm, marginBottom: webSpacing.md },
  figure: { flexBasis: '18%', flexGrow: 1, backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.sm, borderWidth: 1, borderColor: webColors.border },
  figureLabel: { fontSize: 10, color: webColors.textSecondary },
  figureValue: { fontSize: 15, fontWeight: '700', color: webColors.textPrimary, marginTop: 4 },
  figureValueHighlight: { color: webColors.danger },
  coverageCard: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, padding: webSpacing.md, marginBottom: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  coverageHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: webSpacing.sm },
  coverageTitle: { fontSize: 11, fontWeight: '700', color: webColors.textSecondary, letterSpacing: 0.5 },
  coveragePercent: { fontSize: 16, fontWeight: '800', color: webColors.textPrimary },
  coverageTrack: { height: 8, backgroundColor: webColors.surfaceMuted, borderRadius: 4, overflow: 'hidden' },
  coverageFill: { height: '100%', backgroundColor: webColors.success },
  coverageSub: { fontSize: 11, color: webColors.textSecondary, marginTop: webSpacing.sm },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginTop: webSpacing.lg, marginBottom: webSpacing.sm },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  list: { gap: webSpacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.md, borderWidth: 1, borderColor: webColors.border },
  rowSimple: { backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.md, borderWidth: 1, borderColor: webColors.border },
  rowLabel: { fontSize: 13, fontWeight: '600', color: webColors.textPrimary },
  rowMeta: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  rowCoverage: { fontSize: 10, color: webColors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  payButton: { backgroundColor: webColors.primary, borderRadius: webRadius.pill, paddingHorizontal: 12, paddingVertical: 5, marginTop: 6 },
  payButtonText: { color: webColors.textOnPrimary, fontSize: 11, fontWeight: '600' },
  optionTotal: { fontSize: 11, color: webColors.textSecondary, marginTop: webSpacing.xs, fontStyle: 'italic' },

  panelCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, borderWidth: 1, borderColor: webColors.borderStrong },
  panelTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.sm },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 11, alignItems: 'center', marginTop: webSpacing.xs },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13 },
  duplicateButton: { backgroundColor: webColors.surface, borderWidth: 1, borderColor: webColors.border, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center' },
  duplicateButtonText: { color: webColors.textPrimary, fontWeight: '600', fontSize: 13 },

  error: { color: webColors.danger, fontSize: 12, marginBottom: webSpacing.sm },
  help: { fontSize: 11, color: webColors.textSecondary, fontStyle: 'italic', marginTop: 4, marginBottom: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,26,41,0.45)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  modalCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 460, maxWidth: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md, gap: webSpacing.sm },
  modalButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  modalButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10 },
  modalButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
  recapIntro: { fontSize: 13, color: webColors.textPrimary, fontWeight: '600', marginBottom: webSpacing.md },
  recapCard: { backgroundColor: webColors.background, borderRadius: webRadius.sm, marginBottom: webSpacing.md },
  recapRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: webColors.border },
  recapRowLast: { borderBottomWidth: 0 },
  recapLabel: { fontSize: 11, color: webColors.textSecondary, textTransform: 'uppercase', fontWeight: '700' },
  recapValue: { fontSize: 14, color: webColors.textPrimary, fontWeight: '600', marginTop: 3 },
});
