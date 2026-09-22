import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as api from '../../api/client';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { ConfirmDialog } from '../../web/ui/ConfirmDialog.web';
import { PageHeader } from '../../web/ui/PageHeader.web';
import { TwoColumnLayout } from '../../web/ui/TwoColumnLayout.web';
import { MAX_CONTENT_WIDTH, webColors, webRadius, webSpacing } from '../../web/webTheme';
import { KIND_LABEL, LedgerEntry, formatDate } from '../transactions/transactionsLogic';
import { Account, Reconciliation, n } from './accountDetailLogic';
import { AccountType, TYPE_LABEL } from './accountsLogic';

type Section = 'reconciliation' | 'ajustement' | 'transfert' | null;
const ACTIVITY_LIMIT = 5;

/**
 * Portail Web v4 (WEB-V4.4A) — AccountDetail desktop : solde/statut en tête +
 * activité récente à gauche ; panneau d'action sticky à droite avec 3
 * sections en accordéon (Réconciliation / Ajustement / Transfert), un seul
 * bloc ouvert à la fois pour rester lisible ; édition/archivage via menu
 * "•••" (ConfirmDialog pour l'archivage — Alert.alert est un no-op sur Web).
 */
export function AccountDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const accountId = route.params?.id as string;

  const [account, setAccount] = useState<Account | null>(null);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [otherAccounts, setOtherAccounts] = useState<Account[]>([]);
  const [activity, setActivity] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const [openSection, setOpenSection] = useState<Section>('reconciliation');

  const [declaredBalance, setDeclaredBalance] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [adjustReason, setAdjustReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<AccountType>('courant');
  const [editIncludeInPilotage, setEditIncludeInPilotage] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [found, all, recon] = await Promise.all([api.getAccount(accountId), api.listAccounts(), api.listReconciliations(accountId)]);
      setAccount(found);
      setOtherAccounts(all.filter((a: Account) => a.id !== accountId));
      setReconciliations(recon);
      const tx = await api.listTransactions({ accountId, limit: ACTIVITY_LIMIT }).catch(() => []);
      setActivity(tx);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onReconcile() {
    setReconcileError(null);
    const value = Number(declaredBalance.replace(',', '.'));
    if (Number.isNaN(value)) {
      setReconcileError('Solde constaté invalide');
      return;
    }
    setReconciling(true);
    try {
      await api.createReconciliation(accountId, { declaredBalance: value });
      setDeclaredBalance('');
      await load();
      setOpenSection('ajustement');
    } catch (err) {
      setReconcileError(err instanceof api.ApiError ? err.message : 'Rapprochement impossible');
    } finally {
      setReconciling(false);
    }
  }

  async function onAdjust(reconciliationId: string) {
    setAdjustError(null);
    setAdjusting(true);
    try {
      await api.adjustReconciliation(accountId, reconciliationId, adjustReason.trim() ? { reason: adjustReason.trim() } : {});
      setAdjustReason('');
      await load();
    } catch (err) {
      setAdjustError(err instanceof api.ApiError ? err.message : 'Ajustement impossible');
    } finally {
      setAdjusting(false);
    }
  }

  async function onTransfer() {
    setTransferError(null);
    const value = Number(transferAmount.replace(',', '.'));
    if (!toAccountId) {
      setTransferError('Choisissez un compte destination');
      return;
    }
    if (!value || value <= 0) {
      setTransferError('Montant invalide');
      return;
    }
    setTransferring(true);
    try {
      await api.createTransfer({ fromAccountId: accountId, toAccountId, amount: value });
      setTransferAmount('');
      await load();
    } catch (err) {
      setTransferError(err instanceof api.ApiError ? err.message : 'Transfert impossible');
    } finally {
      setTransferring(false);
    }
  }

  function openEdit() {
    if (!account) return;
    setMenuOpen(false);
    setEditName(account.name);
    setEditType(account.type as AccountType);
    setEditIncludeInPilotage(account.includeInOperationalTreasury);
    setEditError(null);
    setEditOpen(true);
  }

  async function onSaveEdit() {
    if (!editName.trim()) {
      setEditError('Le nom du compte est obligatoire');
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      await api.updateAccount(accountId, { name: editName.trim(), type: editType, includeInOperationalTreasury: editIncludeInPilotage });
      setEditOpen(false);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  async function onConfirmArchive() {
    setArchiveError(null);
    setArchiving(true);
    try {
      await api.updateAccount(accountId, { status: 'archive' });
      setArchiveConfirmOpen(false);
      await load();
    } catch (err) {
      setArchiveError(err instanceof api.ApiError ? err.message : 'Archivage impossible');
    } finally {
      setArchiving(false);
    }
  }

  async function onReactivate() {
    setArchiveError(null);
    try {
      await api.updateAccount(accountId, { status: 'actif' });
      await load();
    } catch (err) {
      setArchiveError(err instanceof api.ApiError ? err.message : 'Réactivation impossible');
    }
  }

  if (loading && !account) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }
  if (!account) return null;

  const pendingReconciliation = reconciliations.find((r) => r.status === 'pending' && n(r.discrepancy) !== 0);

  const mainContent = (
    <>
      <View style={styles.heroCard}>
        <View style={styles.heroHeaderRow}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.heroLabel}>
              {account.name}
              {account.status === 'archive' ? ' · Archivé' : ''}
            </Text>
            {!account.includeInOperationalTreasury && <Text style={styles.offPilotBadge}>Hors pilotage</Text>}
          </View>
          <View>
            <TouchableOpacity testID="web-account-menu-button" style={styles.menuButton} onPress={() => setMenuOpen((v) => !v)}>
              <Text style={styles.menuButtonText}>•••</Text>
            </TouchableOpacity>
            {menuOpen && (
              <View style={styles.menuDropdown}>
                <TouchableOpacity testID="web-account-menu-edit" style={styles.menuItem} onPress={openEdit}>
                  <Ionicons name="create-outline" size={16} color={webColors.textPrimary} />
                  <Text style={styles.menuItemText}>Modifier</Text>
                </TouchableOpacity>
                {account.status === 'actif' ? (
                  <TouchableOpacity
                    testID="web-account-menu-archive"
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      setArchiveConfirmOpen(true);
                    }}
                  >
                    <Ionicons name="archive-outline" size={16} color={webColors.textPrimary} />
                    <Text style={styles.menuItemText}>Archiver</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    testID="web-account-menu-reactivate"
                    style={styles.menuItem}
                    onPress={() => {
                      setMenuOpen(false);
                      onReactivate();
                    }}
                  >
                    <Ionicons name="refresh-outline" size={16} color={webColors.textPrimary} />
                    <Text style={styles.menuItemText}>Réactiver</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
        <Text style={styles.heroValue}>{account.soldeCourant.toLocaleString('fr-FR')} DH</Text>
        {archiveError && <Text style={styles.error}>{archiveError}</Text>}
      </View>

      {account.reservedByEnvelopes > 0 && (
        <View style={[styles.card, account.reservedByEnvelopes > account.soldeCourant && styles.cardWarning]}>
          <Text style={styles.cardTitle}>Enveloppes localisées sur ce compte</Text>
          <Text style={styles.cardMeta}>Réservé : {account.reservedByEnvelopes.toLocaleString('fr-FR')} DH</Text>
          {account.reservedByEnvelopes > account.soldeCourant ? (
            <Text style={styles.warningText}>⚠ Réservations insuffisamment couvertes : il manque {(account.reservedByEnvelopes - account.soldeCourant).toLocaleString('fr-FR')} DH.</Text>
          ) : (
            <Text style={styles.cardMeta}>Libre non affecté sur ce compte : {(account.soldeCourant - account.reservedByEnvelopes).toLocaleString('fr-FR')} DH</Text>
          )}
        </View>
      )}

      <Text style={styles.sectionTitle}>Activité récente</Text>
      {activity.length === 0 ? (
        <Text style={styles.empty}>Aucune opération récente.</Text>
      ) : (
        <View style={styles.table}>
          {activity.map((item) => {
            const positive = item.amount >= 0;
            return (
              <TouchableOpacity
                key={`${item.kind}-${item.id}`}
                testID={`web-account-activity-${item.kind}-${item.id}`}
                style={styles.tableRow}
                onPress={() => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id })}
              >
                <Text style={styles.activityDate}>{formatDate(item.occurredAt)}</Text>
                <Text style={styles.activityLabel} numberOfLines={1}>
                  {item.label ?? KIND_LABEL[item.displayKind] ?? item.kind}
                </Text>
                <Text style={[styles.activityAmount, positive ? styles.amountPositive : styles.amountNegative]}>
                  {positive ? '+' : ''}
                  {item.amount.toLocaleString('fr-FR')} DH
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </>
  );

  const panel = (
    <View style={{ gap: webSpacing.sm }}>
      <AccordionSection title="Réconciliation" open={openSection === 'reconciliation'} onToggle={() => setOpenSection(openSection === 'reconciliation' ? null : 'reconciliation')}>
        <Text style={styles.help}>Saisissez le solde constaté (ex. relevé bancaire) pour vérifier s'il correspond au solde calculé.</Text>
        <FormField testID="web-account-reconcile-balance-input" placeholder="Solde constaté (DH)" keyboardType="decimal-pad" value={declaredBalance} onChangeText={setDeclaredBalance} />
        <TouchableOpacity testID="web-account-reconcile-submit" style={styles.button} onPress={onReconcile} disabled={reconciling}>
          {reconciling ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonText}>Vérifier</Text>}
        </TouchableOpacity>
        {reconcileError && <Text style={styles.error}>{reconcileError}</Text>}
        {reconciliations.length > 0 && (
          <View style={styles.reconList}>
            {reconciliations.map((r) => (
              <View key={r.id} style={styles.reconRow}>
                <Text style={styles.reconLabel}>Solde constaté {n(r.declaredBalance).toLocaleString('fr-FR')} DH</Text>
                <Text style={styles.reconMeta}>
                  Écart {n(r.discrepancy).toLocaleString('fr-FR')} DH · {r.status === 'resolue' ? 'Résolu' : 'En attente'}
                </Text>
              </View>
            ))}
          </View>
        )}
      </AccordionSection>

      <AccordionSection title="Ajustement" open={openSection === 'ajustement'} onToggle={() => setOpenSection(openSection === 'ajustement' ? null : 'ajustement')}>
        {!pendingReconciliation ? (
          <Text style={styles.help}>Aucun ajustement en attente.</Text>
        ) : (
          <>
            <Text style={styles.help}>
              Écart constaté : {n(pendingReconciliation.discrepancy).toLocaleString('fr-FR')} DH (solde constaté {n(pendingReconciliation.declaredBalance).toLocaleString('fr-FR')} DH).
            </Text>
            <FormField testID="web-account-adjust-reason-input" placeholder="Raison (facultatif, ex. Frais bancaires)" value={adjustReason} onChangeText={setAdjustReason} />
            <TouchableOpacity testID="web-account-adjust-submit" style={styles.buttonSecondary} onPress={() => onAdjust(pendingReconciliation.id)} disabled={adjusting}>
              {adjusting ? <ActivityIndicator color={webColors.textPrimary} /> : <Text style={styles.buttonSecondaryText}>Ajuster le solde à {n(pendingReconciliation.declaredBalance).toLocaleString('fr-FR')} DH</Text>}
            </TouchableOpacity>
            {adjustError && <Text style={styles.error}>{adjustError}</Text>}
          </>
        )}
      </AccordionSection>

      <AccordionSection title="Transfert" open={openSection === 'transfert'} onToggle={() => setOpenSection(openSection === 'transfert' ? null : 'transfert')}>
        {account.status === 'archive' ? (
          <Text style={styles.help}>Ce compte est archivé — réactivez-le pour transférer depuis ce compte.</Text>
        ) : otherAccounts.length === 0 ? (
          <Text style={styles.help}>Créez un second compte pour pouvoir y transférer de l'argent.</Text>
        ) : (
          <>
            <Select
              testID="web-account-transfer-dest-select"
              label="Compte destination"
              placeholder="Choisir le compte destination"
              value={toAccountId}
              onChange={setToAccountId}
              options={otherAccounts.map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
            />
            <FormField testID="web-account-transfer-amount-input" label="Montant" placeholder="Montant (DH)" keyboardType="decimal-pad" value={transferAmount} onChangeText={setTransferAmount} />
            {(() => {
              const numericAmount = Number(transferAmount.replace(',', '.'));
              const to = otherAccounts.find((a) => a.id === toAccountId);
              if (!to || !numericAmount || numericAmount <= 0) return null;
              return (
                <View style={styles.transferPreview} testID="web-account-transfer-preview">
                  <Text style={styles.transferPreviewTitle}>APRÈS TRANSFERT</Text>
                  <View style={styles.transferPreviewRow}>
                    <Text style={styles.transferPreviewName}>{account.name}</Text>
                    <Text style={styles.transferPreviewValue}>
                      {account.soldeCourant.toLocaleString('fr-FR')} → {(account.soldeCourant - numericAmount).toLocaleString('fr-FR')} DH
                    </Text>
                  </View>
                  <View style={styles.transferPreviewRow}>
                    <Text style={styles.transferPreviewName}>{to.name}</Text>
                    <Text style={styles.transferPreviewValue}>
                      {to.soldeCourant.toLocaleString('fr-FR')} → {(to.soldeCourant + numericAmount).toLocaleString('fr-FR')} DH
                    </Text>
                  </View>
                </View>
              );
            })()}
            <TouchableOpacity testID="web-account-transfer-submit" style={styles.buttonConfirm} onPress={onTransfer} disabled={transferring}>
              {transferring ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.buttonConfirmText}>CONFIRMER LE TRANSFERT</Text>}
            </TouchableOpacity>
            {transferError && <Text style={styles.error}>{transferError}</Text>}
          </>
        )}
      </AccordionSection>
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <PageHeader title="Compte" />
      <TwoColumnLayout main={mainContent} panel={panel} />

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="web-account-edit-form">
            <Text style={styles.modalTitle}>Modifier le compte</Text>
            <FormField label="Nom" value={editName} onChangeText={setEditName} placeholder="Nom du compte" testID="web-account-edit-name" />
            <View style={styles.chipRow}>
              {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
                <TouchableOpacity key={t} testID={`web-account-edit-type-${t}`} style={[styles.chip, editType === t && styles.chipActive]} onPress={() => setEditType(t)}>
                  <Text style={[styles.chipText, editType === t && styles.chipTextActive]}>{TYPE_LABEL[t]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.pilotageRow}>
              <View style={{ flex: 1, marginRight: webSpacing.sm }}>
                <Text style={styles.pilotageLabel}>Inclure ce compte dans ma situation financière</Text>
                <Text style={styles.pilotageHelp}>Si désactivé, ce compte reste visible mais n'est pas pris en compte dans les calculs.</Text>
              </View>
              <Switch testID="web-account-edit-pilotage-switch" value={editIncludeInPilotage} onValueChange={setEditIncludeInPilotage} />
            </View>
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="web-account-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={webColors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        testID="web-account-archive-confirm"
        visible={archiveConfirmOpen}
        title="Archiver ce compte ?"
        message="L'historique reste intact et consultable — ce compte ne sera plus proposé pour une nouvelle transaction ou un nouveau transfert."
        confirmLabel="Archiver"
        destructive
        loading={archiving}
        onConfirm={onConfirmArchive}
        onCancel={() => setArchiveConfirmOpen(false)}
      />
    </ScrollView>
  );
}

function AccordionSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.accordion}>
      <TouchableOpacity testID={`web-account-accordion-${title}`} style={styles.accordionHeader} onPress={onToggle}>
        <Text style={styles.accordionTitle}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={webColors.textSecondary} />
      </TouchableOpacity>
      {open && <View style={styles.accordionBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: webColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: webColors.background },
  scroll: { padding: webSpacing.xl, maxWidth: MAX_CONTENT_WIDTH, width: '100%', alignSelf: 'center' },

  heroCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.lg, marginBottom: webSpacing.md, borderWidth: 1, borderColor: webColors.borderStrong },
  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { fontSize: 14, color: webColors.textSecondary, fontWeight: '600' },
  heroValue: { fontSize: 30, fontWeight: '800', color: webColors.textPrimary, marginTop: 4 },
  offPilotBadge: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.pill, paddingHorizontal: 8, paddingVertical: 2, marginTop: webSpacing.xs, alignSelf: 'flex-start' },
  menuButton: { paddingHorizontal: 10, paddingVertical: 2 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: webColors.textSecondary },
  menuDropdown: { position: 'absolute', top: 30, right: 0, backgroundColor: webColors.surface, borderRadius: webRadius.md, borderWidth: 1, borderColor: webColors.border, minWidth: 160, zIndex: 10 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: webSpacing.md, paddingVertical: 10 },
  menuItemText: { fontSize: 13, color: webColors.textPrimary, fontWeight: '600' },

  card: { backgroundColor: webColors.surface, borderRadius: webRadius.md, padding: webSpacing.md, marginBottom: webSpacing.sm, borderWidth: 1, borderColor: webColors.borderStrong },
  cardWarning: { borderColor: webColors.danger, backgroundColor: webColors.dangerLight },
  cardTitle: { fontSize: 13, fontWeight: '700', color: webColors.textPrimary },
  cardMeta: { fontSize: 12, color: webColors.textSecondary, marginTop: 2 },
  warningText: { fontSize: 12, color: webColors.danger, fontWeight: '600', marginTop: 4 },

  sectionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary, marginTop: webSpacing.md, marginBottom: webSpacing.sm },
  empty: { color: webColors.textSecondary, fontSize: 13 },
  table: { backgroundColor: webColors.surface, borderRadius: webRadius.lg, borderWidth: 1, borderColor: webColors.border, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: webSpacing.md, paddingVertical: 10, borderTopWidth: 1, borderTopColor: webColors.tableRowBorder },
  activityDate: { fontSize: 11, color: webColors.textSecondary, width: 90 },
  activityLabel: { fontSize: 12, color: webColors.textPrimary, flex: 1, paddingRight: webSpacing.sm },
  activityAmount: { fontSize: 12, fontWeight: '700', width: 100, textAlign: 'right' },
  amountPositive: { color: webColors.success },
  amountNegative: { color: webColors.danger },

  accordion: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, borderWidth: 1, borderColor: webColors.borderStrong, overflow: 'hidden' },
  accordionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: webSpacing.lg, paddingVertical: webSpacing.md },
  accordionTitle: { fontSize: 14, fontWeight: '700', color: webColors.textPrimary },
  accordionBody: { paddingHorizontal: webSpacing.lg, paddingBottom: webSpacing.lg, borderTopWidth: 1, borderTopColor: webColors.border, paddingTop: webSpacing.md },

  help: { fontSize: 11, color: webColors.textSecondary, marginBottom: webSpacing.sm, fontStyle: 'italic' },
  button: { backgroundColor: webColors.primary, borderRadius: webRadius.md, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  buttonSecondary: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.md, paddingVertical: 10, alignItems: 'center' },
  buttonSecondaryText: { color: webColors.textPrimary, fontWeight: '600', fontSize: 12, textAlign: 'center' },
  buttonConfirm: { backgroundColor: webColors.success, borderRadius: webRadius.md, paddingVertical: 13, alignItems: 'center' },
  buttonConfirmText: { color: webColors.textOnPrimary, fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },

  reconList: { marginTop: webSpacing.md, gap: webSpacing.xs },
  reconRow: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.sm, padding: webSpacing.sm },
  reconLabel: { fontSize: 12, fontWeight: '700', color: webColors.textPrimary },
  reconMeta: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },

  transferPreview: { backgroundColor: webColors.background, borderRadius: webRadius.md, padding: webSpacing.md, marginBottom: webSpacing.sm },
  transferPreviewTitle: { fontSize: 10, fontWeight: '700', color: webColors.textSecondary, letterSpacing: 0.5, marginBottom: webSpacing.sm },
  transferPreviewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  transferPreviewName: { fontSize: 13, color: webColors.textPrimary, fontWeight: '600' },
  transferPreviewValue: { fontSize: 13, color: webColors.textPrimary, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,26,41,0.45)', alignItems: 'center', justifyContent: 'center', padding: webSpacing.xl },
  modalCard: { backgroundColor: webColors.surface, borderRadius: webRadius.xl, padding: webSpacing.xl, width: 420, maxWidth: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: webColors.textPrimary, marginBottom: webSpacing.md },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: webSpacing.md, gap: webSpacing.sm },
  modalButton: { backgroundColor: webColors.primary, borderRadius: webRadius.sm, paddingHorizontal: 18, paddingVertical: 10 },
  modalButtonText: { color: webColors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10 },
  modalButtonSecondaryText: { color: webColors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: webSpacing.sm, gap: webSpacing.xs },
  chip: { backgroundColor: webColors.surfaceMuted, borderRadius: webRadius.pill, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: webColors.border },
  chipActive: { backgroundColor: webColors.primary, borderColor: webColors.primary },
  chipText: { fontSize: 12, color: webColors.textPrimary },
  chipTextActive: { color: webColors.textOnPrimary, fontWeight: '600' },
  pilotageRow: { flexDirection: 'row', alignItems: 'center', marginTop: webSpacing.xs, marginBottom: webSpacing.sm },
  pilotageLabel: { fontSize: 12, fontWeight: '600', color: webColors.textPrimary },
  pilotageHelp: { fontSize: 11, color: webColors.textSecondary, marginTop: 2 },
  error: { color: webColors.danger, fontSize: 12, marginTop: 4, marginBottom: webSpacing.sm },
});
