import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { DateField } from '../../ui/DateField';
import { colors, radius, spacing } from '../../ui/theme';

interface Child {
  id: string;
  firstName: string;
  lastName: string;
}

type CoverageStatus = 'couverte' | 'partielle' | 'non_couverte' | 'sans_objet';

interface DeadlineRow {
  id: string;
  dueDate: string;
  chargePlanLabel: string;
  amountCurrent: string | number | null;
  amountStatus: 'inconnu' | 'estime' | 'confirme';
  resteAPayer: number | null;
  financialStatus: 'ouverte' | 'partiellement_payee' | 'soldee' | 'annulee';
  provisionId: string | null;
  coverageAffectee: number;
  engagementNonCouvert: number;
  coverageStatus: CoverageStatus;
}

const STATUS_MARK: Record<DeadlineRow['financialStatus'], string> = {
  ouverte: '○',
  partiellement_payee: '◐',
  soldee: '✓',
  annulee: '✕',
};

// §9 — un symbole par statut de COUVERTURE (réservé), jamais confondu avec le
// statut de PAIEMENT (STATUS_MARK/STATUS_LABEL ci-dessus, §10).
const COVERAGE_ICON: Record<CoverageStatus, string> = {
  couverte: '✅',
  partielle: '🟠',
  non_couverte: '🔴',
  sans_objet: '',
};

const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  couverte: 'Couverte',
  partielle: 'Partiellement couverte',
  non_couverte: 'Non couverte',
  sans_objet: '',
};

const STATUS_LABEL: Record<DeadlineRow['financialStatus'], string> = {
  ouverte: 'Ouverte',
  partiellement_payee: 'Partiellement payée',
  soldee: 'Soldée',
  annulee: 'Annulée',
};

function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

interface UnknownItem {
  chargePlanId: string;
  label: string;
  deadlineId: string;
}

interface EnvisagedItem {
  chargePlanId: string;
  label: string;
  amountKnown: boolean;
}

interface FinancialPlanDetail {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  planType: 'school' | 'travel' | 'other';
  knownPlanCost: number;
  paidAmount: number;
  remainingDue: number;
  provisionCoverage: number;
  remainingToFund: number;
  tauxCouverture: number | null;
  completude: 'complet' | 'contient_estimations' | 'contient_inconnues';
  deadlinesCertain: DeadlineRow[];
  envisagedItems: EnvisagedItem[];
  envisagedTotal: number;
  unknownItems: UnknownItem[];
}

const COMPLETUDE_LABEL: Record<FinancialPlanDetail['completude'], string> = {
  complet: 'Budget total : complet',
  contient_estimations: 'Contient des estimations — total non définitif',
  contient_inconnues: 'Au moins ce montant identifié — budget incomplet',
};

/** Vue plan financier (§15) — jamais une grille de tableur, jamais un faux total définitif. */
export function FinancialPlanDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const id = route.params?.id as string;
  const bottomInset = useBottomInset();
  const [detail, setDetail] = useState<FinancialPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // R5 §2 — menu "..." (Modifier/Dupliquer/Supprimer), pattern réutilisable (§19).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [editPeriodStart, setEditPeriodStart] = useState('');
  const [editPeriodEnd, setEditPeriodEnd] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // R5 clôture §10 — duplication en 2 étapes (formulaire puis récapitulatif
  // explicite) : jamais une duplication silencieuse dès le choix de l'enfant,
  // l'utilisateur doit voir et confirmer ce qui va être créé.
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateStep, setDuplicateStep] = useState<'form' | 'recap'>('form');
  const [duplicateLabel, setDuplicateLabel] = useState('');
  const [children, setChildren] = useState<Child[]>([]);
  const [duplicateChildIds, setDuplicateChildIds] = useState<string[]>([]);
  const [duplicating, setDuplicating] = useState(false);
  const [duplicateError, setDuplicateError] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d: FinancialPlanDetail = await api.getFinancialPlan(id);
      // Tri chronologique (§26 cadrage V1) : dueDate ASC, id en départage — jamais
      // l'ordre de création des ChargePlan, purement un affichage mobile.
      d.deadlinesCertain = [...d.deadlinesCertain].sort((a, b) => {
        const byDate = a.dueDate.localeCompare(b.dueDate);
        return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
      });
      setDetail(d);
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

  function openEdit() {
    if (!detail) return;
    setMenuOpen(false);
    setEditLabel(detail.label);
    setEditPeriodStart(detail.periodStart.slice(0, 10));
    setEditPeriodEnd(detail.periodEnd.slice(0, 10));
    setEditError(null);
    setEditOpen(true);
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
      setEditOpen(false);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  function openDuplicate() {
    if (!detail) return;
    setMenuOpen(false);
    setDuplicateStep('form');
    setDuplicateLabel(`${detail.label} (copie)`);
    setDuplicateChildIds([]);
    setDuplicateError(null);
    loadChildren();
    setDuplicateOpen(true);
  }

  function toggleDuplicateChild(childId: string) {
    setDuplicateChildIds((current) => (current.includes(childId) ? current.filter((c) => c !== childId) : [...current, childId]));
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

  function onRequestDelete() {
    setMenuOpen(false);
    setDeleteError(null);
    Alert.alert('Supprimer ce plan ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: onDelete },
    ]);
  }

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteFinancialPlan(id);
      navigation.goBack();
    } catch (err) {
      // §2 — jamais un DELETE silencieux : le backend refuse dès qu'un paiement
      // existe déjà sous ce plan (historique financier réel), affiché ici en clair.
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

  return (
    <ScrollView testID="plan-detail-scroll" style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{detail.label}</Text>
        <TouchableOpacity testID="plan-menu-button" style={styles.menuButton} onPress={() => setMenuOpen(true)}>
          <Text style={styles.menuButtonText}>•••</Text>
        </TouchableOpacity>
      </View>
      {deleteError && <Text style={styles.error}>{deleteError}</Text>}
      <Text style={styles.completude}>{COMPLETUDE_LABEL[detail.completude]}</Text>

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

      <Text style={styles.sectionTitle}>Échéances</Text>
      {detail.deadlinesCertain.length === 0 ? (
        <Text style={styles.empty}>Aucune échéance certaine pour l'instant.</Text>
      ) : (
        detail.deadlinesCertain.map((d) => {
          const isOpen = d.financialStatus === 'ouverte' || d.financialStatus === 'partiellement_payee';
          const resteAPayerNum = d.resteAPayer !== null ? Number(d.resteAPayer) : 0;
          const couverturePct = d.coverageStatus !== 'sans_objet' && resteAPayerNum > 0 ? Math.round((d.coverageAffectee / resteAPayerNum) * 100) : null;
          return (
            <TouchableOpacity
              key={d.id}
              style={styles.row}
              onPress={() => navigation.navigate(d.amountStatus !== 'confirme' ? 'ConfirmDeadline' : 'DeadlineDetail', { id: d.id })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>
                  {COVERAGE_ICON[d.coverageStatus]} {d.chargePlanLabel} · {formatShortDate(d.dueDate)}
                </Text>
                <Text style={styles.rowMeta}>
                  {STATUS_MARK[d.financialStatus]} {STATUS_LABEL[d.financialStatus]} ·{' '}
                  {d.amountStatus === 'confirme' ? 'Montant confirmé' : d.amountStatus === 'estime' ? 'Estimé — appuyer pour confirmer' : 'Montant inconnu'}
                </Text>
                {/* §10 — Couverture (réservé) et Paiement (réglé) : deux informations
                    toujours affichées séparément, jamais fusionnées en une seule. */}
                {couverturePct !== null && (
                  <Text style={styles.rowCoverage}>
                    Couverture : {couverturePct}% ({COVERAGE_LABEL[d.coverageStatus]}) · Paiement : {STATUS_LABEL[d.financialStatus]}
                  </Text>
                )}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.rowAmount}>{d.resteAPayer !== null ? `${resteAPayerNum.toLocaleString('fr-FR')} DH restants` : '—'}</Text>
                {isOpen && (
                  <TouchableOpacity
                    testID={`pay-deadline-${d.id}`}
                    style={styles.payButton}
                    onPress={() => navigation.navigate('DeadlineDetail', { id: d.id })}
                  >
                    <Text style={styles.payButtonText}>Payer</Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })
      )}

      <Text style={styles.sectionTitle}>Options envisagées</Text>
      {detail.envisagedItems.length === 0 ? (
        <Text style={styles.empty}>Aucune option envisagée.</Text>
      ) : (
        <>
          {detail.envisagedItems.map((i) => (
            <View key={i.chargePlanId} style={styles.rowSimple}>
              <Text style={styles.rowLabel}>{i.label}</Text>
              <Text style={styles.rowMeta}>{i.amountKnown ? 'Montant connu' : 'À décider'}</Text>
            </View>
          ))}
          <Text style={styles.optionTotal}>Options envisagées : {detail.envisagedTotal.toLocaleString('fr-FR')} DH (jamais inclus ci-dessus)</Text>
        </>
      )}

      <Text style={styles.sectionTitle}>Éléments inconnus</Text>
      {detail.unknownItems.length === 0 ? (
        <Text style={styles.empty}>Aucun montant inconnu.</Text>
      ) : (
        detail.unknownItems.map((i) => (
          <TouchableOpacity key={i.deadlineId} style={styles.rowSimple} onPress={() => navigation.navigate('ConfirmDeadline', { id: i.deadlineId })}>
            <Text style={styles.rowLabel}>{i.label}</Text>
            <Text style={styles.rowMeta}>À confirmer</Text>
          </TouchableOpacity>
        ))
      )}

      <ChoiceSheet
        testID="plan-menu"
        visible={menuOpen}
        title={detail.label}
        onClose={() => setMenuOpen(false)}
        options={[
          { key: 'modifier', label: 'Modifier', icon: 'create-outline', onPress: openEdit },
          { key: 'dupliquer', label: 'Dupliquer', icon: 'copy-outline', onPress: openDuplicate },
          { key: 'supprimer', label: 'Supprimer', icon: 'trash-outline', onPress: onRequestDelete },
        ]}
      />

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="plan-edit-form">
            <Text style={styles.modalTitle}>Modifier le plan</Text>
            <TextInput style={styles.modalInput} value={editLabel} onChangeText={setEditLabel} placeholder="Nom du plan" testID="plan-edit-label" />
            <DateField label="Début" value={editPeriodStart} onChange={setEditPeriodStart} />
            <DateField label="Fin" value={editPeriodEnd} onChange={setEditPeriodEnd} />
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="plan-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={duplicateOpen} transparent animationType="fade" onRequestClose={() => setDuplicateOpen(false)}>
        <View style={styles.modalOverlay}>
          {duplicateStep === 'form' ? (
            <View style={styles.modalCard} testID="plan-duplicate-form">
              <Text style={styles.modalTitle}>Dupliquer le plan</Text>
              <TextInput style={styles.modalInput} value={duplicateLabel} onChangeText={setDuplicateLabel} placeholder="Nom de la copie" testID="plan-duplicate-label" />
              {children.length > 0 && (
                <>
                  <Text style={styles.modalSubLabel}>Enfant(s) bénéficiaire(s) de la copie</Text>
                  <View style={styles.chipRow}>
                    {children.map((c) => (
                      <TouchableOpacity
                        key={c.id}
                        testID={`plan-duplicate-child-${c.id}`}
                        style={[styles.chip, duplicateChildIds.includes(c.id) && styles.chipActive]}
                        onPress={() => toggleDuplicateChild(c.id)}
                      >
                        <Text style={[styles.chipText, duplicateChildIds.includes(c.id) && styles.chipTextActive]}>
                          {c.firstName} {c.lastName}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {duplicateError && <Text style={styles.error}>{duplicateError}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setDuplicateOpen(false)}>
                  <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="plan-duplicate-next" style={styles.modalButton} onPress={onGoToRecap}>
                  <Text style={styles.modalButtonText}>Suivant</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            // R5 clôture §10 — récapitulatif explicite avant toute écriture : l'utilisateur
            // voit exactement ce qui va être créé (un NOUVEAU plan indépendant), et peut
            // encore revenir ajuster le formulaire — jamais une duplication silencieuse.
            <View style={styles.modalCard} testID="plan-duplicate-recap">
              <Text style={styles.modalTitle}>Confirmer la duplication</Text>
              <Text style={styles.recapIntro}>Vous allez créer un NOUVEAU plan indépendant :</Text>
              <View style={styles.recapCard}>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Nom de la copie</Text>
                  <Text style={styles.recapValue}>{duplicateLabel.trim()}</Text>
                </View>
                <View style={styles.recapRow}>
                  <Text style={styles.recapLabel}>Enfant(s) bénéficiaire(s)</Text>
                  <Text style={styles.recapValue}>
                    {duplicateChildIds.length === 0
                      ? 'Aucun'
                      : children.filter((c) => duplicateChildIds.includes(c.id)).map((c) => `${c.firstName} ${c.lastName}`).join(', ')}
                  </Text>
                </View>
                <View style={[styles.recapRow, styles.recapRowLast]}>
                  <Text style={styles.recapLabel}>Échéances copiées</Text>
                  <Text style={styles.recapValue}>{detail.deadlinesCertain.length}</Text>
                </View>
              </View>
              <Text style={styles.help}>La copie ne reprend jamais les paiements ni l'historique — un échéancier neuf, indépendant de l'original.</Text>
              {duplicateError && <Text style={styles.error}>{duplicateError}</Text>}
              <View style={styles.modalActions}>
                <TouchableOpacity testID="plan-duplicate-back" style={styles.modalButtonSecondary} onPress={() => setDuplicateStep('form')}>
                  <Text style={styles.modalButtonSecondaryText}>Retour</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="plan-duplicate-confirm" style={styles.modalButton} onPress={onConfirmDuplicate} disabled={duplicating}>
                  {duplicating ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalButtonText}>Confirmer la duplication</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </Modal>
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
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20, paddingTop: 16 },
  title: { fontSize: 20, fontWeight: '700', color: '#172436' },
  completude: { fontSize: 12, color: '#B8860B', marginTop: 4, marginBottom: 16, fontStyle: 'italic' },
  figuresGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 12 },
  figure: { width: '50%', backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  figureLabel: { fontSize: 11, color: '#6B747C' },
  figureValue: { fontSize: 16, fontWeight: '700', color: '#172436', marginTop: 4 },
  figureValueHighlight: { color: '#B3261E' },
  coverageCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12 },
  coverageHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  coverageTitle: { fontSize: 11, fontWeight: '700', color: '#6B747C', letterSpacing: 0.5 },
  coveragePercent: { fontSize: 16, fontWeight: '800', color: '#172436' },
  coverageTrack: { height: 8, backgroundColor: '#EDEBE6', borderRadius: 4, overflow: 'hidden' },
  coverageFill: { height: '100%', backgroundColor: '#2E7D5B' },
  coverageSub: { fontSize: 11, color: '#6B747C', marginTop: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#172436', marginTop: 16, marginBottom: 8 },
  empty: { color: '#6B747C', fontSize: 13 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  rowSimple: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  rowLabel: { fontSize: 13, fontWeight: '600', color: '#172436' },
  rowMeta: { fontSize: 11, color: '#6B747C', marginTop: 2 },
  rowCoverage: { fontSize: 10, color: '#6B747C', marginTop: 2, fontStyle: 'italic' },
  rowAmount: { fontSize: 13, fontWeight: '700', color: '#172436' },
  payButton: { backgroundColor: '#172436', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginTop: 6 },
  payButtonText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  optionTotal: { fontSize: 11, color: '#6B747C', marginTop: 4, marginBottom: 4, fontStyle: 'italic' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  menuButton: { paddingHorizontal: 10, paddingVertical: 4 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  error: { color: colors.danger, fontSize: 12, marginTop: 8, marginBottom: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  modalSubLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginTop: 4, marginBottom: 6 },
  modalInput: {
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.md },
  modalButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: 18, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  modalButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  chip: { backgroundColor: colors.background, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.textPrimary },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  help: { fontSize: 11, color: colors.textSecondary, fontStyle: 'italic', marginTop: 4, marginBottom: 4 },
  recapIntro: { fontSize: 13, color: colors.textPrimary, fontWeight: '600', marginBottom: spacing.md },
  recapCard: { backgroundColor: colors.background, borderRadius: radius.sm, marginBottom: spacing.md },
  recapRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  recapRowLast: { borderBottomWidth: 0 },
  recapLabel: { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', fontWeight: '700' },
  recapValue: { fontSize: 14, color: colors.textPrimary, fontWeight: '600', marginTop: 3 },
});
