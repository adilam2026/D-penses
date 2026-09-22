import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { ChoiceSheet } from '../../ui/ChoiceSheet';
import { FormField } from '../../ui/FormField';
import { Select } from '../../ui/Select';
import { colors, elevation, radius, spacing } from '../../ui/theme';
import { Account as BaseAccount, Reconciliation, n } from './accountDetailLogic';
import { AccountType, TYPE_LABEL } from './accountsLogic';
import { KIND_LABEL, LedgerEntry, formatDate, groupByMonth, initiatorColor } from '../transactions/transactionsLogic';

// Corrections consolidées §5/§6 — préférences purement visuelles, INDÉPENDANTES
// de includeInOperationalTreasury (pilotage) : extension LOCALE (jamais dans
// accountDetailLogic.ts, partagé avec le portail Web protégé WEB-V4.4A —
// aucune modification de ce fichier partagé).
type Account = BaseAccount & {
  hideBalanceByDefault?: boolean;
  showOnHome?: boolean;
  envelopes?: api.AccountEnvelope[];
  isDedicated?: boolean;
  dedicatedFeed?: { fromAccountName: string; amount: number; recurrenceRule: string } | null;
};

/**
 * Détail d'un compte (corrections UI/UX finales §4) — vue PRINCIPALE : nom +
 * solde + historique des transactions de ce compte, en réutilisant le même
 * registre que l'écran Transactions (api.listTransactions({accountId})) —
 * jamais un deuxième moteur d'historique. Rapprochement (constater un écart
 * entre le solde déclaré et le solde calculé), ajustement (corriger
 * explicitement, jamais automatiquement — RG-083), transfert vers un autre
 * compte, modification et archivage restent disponibles mais déplacés
 * derrière le menu "•••" (ils ne sont plus l'écran principal).
 */
export function AccountDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const accountId = route.params?.id as string;

  const [account, setAccount] = useState<Account | null>(null);
  const [reconciliations, setReconciliations] = useState<Reconciliation[]>([]);
  const [otherAccounts, setOtherAccounts] = useState<Account[]>([]);
  const [history, setHistory] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Corrections UI/UX finales §4 — Rapprochement et Transfert quittent la vue
  // principale : accessibles depuis le menu "•••" de la carte héro, chacun dans
  // sa propre modale (mêmes fonctions/états qu'avant, seul l'emplacement change).
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const [declaredBalance, setDeclaredBalance] = useState('');
  const [reconciling, setReconciling] = useState(false);
  const [reconcileError, setReconcileError] = useState<string | null>(null);

  const [adjustReason, setAdjustReason] = useState('');
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // R5 clôture §2 — menu "..." (Modifier/Archiver), pattern réutilisable (§19).
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<AccountType>('courant');
  const [editIncludeInPilotage, setEditIncludeInPilotage] = useState(true);
  // Corrections consolidées §5/§6 — préférences indépendantes du pilotage :
  // masquage du solde par défaut à l'ouverture, visibilité sur l'Accueil.
  const [editHideBalanceByDefault, setEditHideBalanceByDefault] = useState(false);
  const [editShowOnHome, setEditShowOnHome] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // R5 clôture §2 — getAccount() n'est jamais filtré par statut (un compte
      // archivé doit rester consultable) ; les comptes proposés comme
      // destination de transfert restent listAccounts() (actifs uniquement).
      const [found, all, recon, tx] = await Promise.all([
        api.getAccount(accountId),
        api.listAccounts(),
        api.listReconciliations(accountId),
        api.listTransactions({ accountId }),
      ]);
      setAccount(found);
      setOtherAccounts(all.filter((a: Account) => a.id !== accountId));
      setReconciliations(recon);
      setHistory(tx);
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
    } catch (err) {
      setReconcileError(err instanceof api.ApiError ? err.message : 'Rapprochement impossible');
    } finally {
      setReconciling(false);
    }
  }

  async function onAdjust(reconciliationId: string) {
    setAdjustError(null);
    setAdjustingId(reconciliationId);
    try {
      await api.adjustReconciliation(accountId, reconciliationId, adjustReason.trim() ? { reason: adjustReason.trim() } : {});
      setAdjustReason('');
      await load();
    } catch (err) {
      setAdjustError(err instanceof api.ApiError ? err.message : 'Ajustement impossible');
    } finally {
      setAdjustingId(null);
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
    setEditHideBalanceByDefault(account.hideBalanceByDefault ?? false);
    setEditShowOnHome(account.showOnHome ?? true);
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
      await api.updateAccount(accountId, {
        name: editName.trim(),
        type: editType,
        includeInOperationalTreasury: editIncludeInPilotage,
        hideBalanceByDefault: editHideBalanceByDefault,
        showOnHome: editShowOnHome,
      });
      setEditOpen(false);
      await load();
    } catch (err) {
      setEditError(err instanceof api.ApiError ? err.message : 'Modification impossible');
    } finally {
      setEditSaving(false);
    }
  }

  function onRequestArchive() {
    setMenuOpen(false);
    setArchiveError(null);
    Alert.alert(
      'Archiver ce compte ?',
      "L'historique reste intact et consultable — ce compte ne sera plus proposé pour une nouvelle transaction ou un nouveau transfert.",
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Archiver',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.updateAccount(accountId, { status: 'archive' });
              await load();
            } catch (err) {
              setArchiveError(err instanceof api.ApiError ? err.message : 'Archivage impossible');
            }
          },
        },
      ],
    );
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
  const sections = groupByMonth(history);

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        keyExtractor={(e) => `${e.kind}-${e.id}`}
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListHeaderComponent={
          <>
            <View style={styles.heroCard}>
              <View style={styles.heroHeaderRow}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.heroLabel}>
                    {account.name}
                    {account.status === 'archive' ? ' · Archivé' : ''}
                  </Text>
                  {/* R6.1 §10 — badge discret, jamais un masquage : un compte hors pilotage
                      reste visible avec son solde, seulement exclu des calculs. */}
                  {!account.includeInOperationalTreasury && <Text style={styles.offPilotBadge}>Hors pilotage</Text>}
                </View>
                <TouchableOpacity testID="account-menu-button" style={styles.menuButton} onPress={() => setMenuOpen(true)}>
                  <Text style={styles.menuButtonText}>•••</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.heroValue}>{account.soldeCourant.toLocaleString('fr-FR')} DH</Text>
              {account.status === 'archive' && (
                <TouchableOpacity testID="account-reactivate" style={styles.reactivateButton} onPress={onReactivate}>
                  <Text style={styles.reactivateButtonText}>Réactiver ce compte</Text>
                </TouchableOpacity>
              )}
              {archiveError && <Text style={styles.error}>{archiveError}</Text>}
              {account.status === 'actif' && (
                <TouchableOpacity
                  testID="account-add-transaction"
                  style={styles.addTransactionButton}
                  onPress={() => navigation.navigate('QuickAdd', { mode: 'depense', accountId: account.id })}
                >
                  <Text style={styles.addTransactionButtonText}>+ Ajouter une transaction</Text>
                </TouchableOpacity>
              )}
            </View>

            {account.reservedByEnvelopes > 0 && (
              <View style={[styles.card, account.reservedByEnvelopes > account.soldeCourant && styles.cardWarning]}>
                <Text style={styles.cardTitle}>Répartition — enveloppes localisées sur ce compte</Text>
                {(account.envelopes ?? []).map((e) => (
                  <View key={e.id} style={styles.envelopeRow}>
                    <Text style={styles.envelopeName}>{e.name}</Text>
                    <Text style={styles.envelopeAmount}>{e.amount.toLocaleString('fr-FR')} DH</Text>
                  </View>
                ))}
                <View style={styles.envelopeDivider} />
                {account.reservedByEnvelopes > account.soldeCourant ? (
                  <Text style={styles.warningText}>
                    ⚠ Réservations insuffisamment couvertes : il manque {(account.reservedByEnvelopes - account.soldeCourant).toLocaleString('fr-FR')} DH
                    sur ce compte.
                  </Text>
                ) : (
                  <Text style={styles.cardMeta}>
                    Libre non affecté sur ce compte : {(account.soldeCourant - account.reservedByEnvelopes).toLocaleString('fr-FR')} DH
                  </Text>
                )}
              </View>
            )}

            {account.isDedicated && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Compte dédié</Text>
                <Text style={styles.cardMeta}>
                  {account.dedicatedFeed
                    ? `Alimenté depuis ${account.dedicatedFeed.fromAccountName} • ${account.dedicatedFeed.amount.toLocaleString('fr-FR')} DH / mois`
                    : "Aucun virement récurrent d'alimentation configuré."}
                </Text>
              </View>
            )}

            {/* Corrections UI/UX finales §4 — historique des transactions de ce
                compte, réutilise le registre Transactions filtré par accountId. */}
            <Text style={styles.sectionTitle}>Historique des transactions de ce compte</Text>
          </>
        }
        ListEmptyComponent={<Text style={styles.help}>Aucune transaction pour ce compte pour l'instant.</Text>}
        renderItem={({ item }) => {
          const positive = item.amount >= 0;
          const initColor = initiatorColor(item.createdByUserId);
          return (
            <TouchableOpacity
              testID={`account-history-row-${item.kind}-${item.id}`}
              style={[styles.historyRow, { borderLeftWidth: 4, borderLeftColor: initColor }]}
              onPress={() => navigation.navigate('TransactionDetail', { kind: item.kind, id: item.id })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.historyLabel}>{item.label ?? KIND_LABEL[item.displayKind] ?? item.kind}</Text>
                <Text style={styles.historyMeta}>
                  {formatDate(item.occurredAt)} · {KIND_LABEL[item.displayKind] ?? item.displayKind}
                  {item.createdByName ? ` · ${item.createdByName}` : ''}
                </Text>
              </View>
              <Text style={[styles.historyAmount, positive ? styles.amountPositive : styles.amountNegative]}>
                {positive ? '+' : ''}
                {item.amount.toLocaleString('fr-FR')} DH
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      <ChoiceSheet
        testID="account-menu"
        visible={menuOpen}
        title={account.name}
        onClose={() => setMenuOpen(false)}
        options={[
          { key: 'modifier', label: 'Modifier', icon: 'create-outline', onPress: openEdit },
          { key: 'rapprochement', label: 'Rapprochement', icon: 'checkmark-done-outline', onPress: () => { setMenuOpen(false); setReconcileOpen(true); } },
          {
            key: 'transfert',
            label: 'Transfert',
            icon: 'swap-horizontal-outline',
            onPress: () => { setMenuOpen(false); setTransferOpen(true); },
          },
          account.status === 'actif'
            ? { key: 'archiver', label: 'Archiver', icon: 'archive-outline', onPress: onRequestArchive }
            : { key: 'reactiver', label: 'Réactiver', icon: 'refresh-outline', onPress: onReactivate },
        ]}
      />

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard} testID="account-edit-form">
            <Text style={styles.modalTitle}>Modifier le compte</Text>
            <FormField label="Nom" value={editName} onChangeText={setEditName} placeholder="Nom du compte" testID="account-edit-name" />
            <View style={styles.chipRow}>
              {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
                <TouchableOpacity
                  key={t}
                  testID={`account-edit-type-${t}`}
                  style={[styles.chip, editType === t && styles.chipActive]}
                  onPress={() => setEditType(t)}
                >
                  <Text style={[styles.chipText, editType === t && styles.chipTextActive]}>{TYPE_LABEL[t]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {/* R6.1 §8 — bascule accessible aussi en modification. */}
            <View style={styles.pilotageRow}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.pilotageLabel}>Inclure ce compte dans ma situation financière</Text>
                <Text style={styles.pilotageHelp}>
                  Si désactivé, ce compte reste visible mais n'est pas pris en compte dans les calculs de trésorerie et de projection.
                </Text>
              </View>
              <Switch testID="account-edit-pilotage-switch" value={editIncludeInPilotage} onValueChange={setEditIncludeInPilotage} />
            </View>
            {/* Corrections consolidées §5 — masquage du solde par défaut à l'ouverture,
                purement visuel, indépendant du pilotage ci-dessus. */}
            <View style={styles.pilotageRow}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.pilotageLabel}>Affichage du solde à l'ouverture</Text>
                <Text style={styles.pilotageHelp}>
                  Si masqué, le solde de ce compte est caché par défaut (révélable à tout moment avec l'œil), sans effet sur les calculs.
                </Text>
              </View>
              <Switch testID="account-edit-hide-balance-switch" value={editHideBalanceByDefault} onValueChange={setEditHideBalanceByDefault} />
            </View>
            {/* Corrections consolidées §6 — visibilité sur l'Accueil, indépendante du
                pilotage et du masquage du solde ci-dessus. */}
            <View style={styles.pilotageRow}>
              <View style={{ flex: 1, marginRight: spacing.sm }}>
                <Text style={styles.pilotageLabel}>Afficher ce compte sur l'accueil</Text>
                <Text style={styles.pilotageHelp}>Si désactivé, ce compte n'apparaît plus dans "Mes comptes" en Accueil, mais reste inchangé partout ailleurs.</Text>
              </View>
              <Switch testID="account-edit-show-on-home-switch" value={editShowOnHome} onValueChange={setEditShowOnHome} />
            </View>
            {editError && <Text style={styles.error}>{editError}</Text>}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setEditOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="account-edit-save" style={styles.modalButton} onPress={onSaveEdit} disabled={editSaving}>
                {editSaving ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.modalButtonText}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Corrections UI/UX finales §4 — Rapprochement déplacé derrière le menu
          "•••", même logique/état qu'avant (onReconcile/onAdjust inchangés). */}
      <Modal visible={reconcileOpen} transparent animationType="fade" onRequestClose={() => setReconcileOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <View style={styles.modalCard} testID="account-reconcile-form">
              <Text style={styles.modalTitle}>Rapprochement</Text>
              <Text style={styles.help}>Saisissez le solde constaté (ex. sur votre relevé bancaire) pour vérifier s'il correspond au solde calculé.</Text>
              <View style={styles.row}>
                <FormField
                  testID="account-reconcile-balance-input"
                  containerStyle={styles.rowField}
                  placeholder="Solde constaté (DH)"
                  keyboardType="decimal-pad"
                  value={declaredBalance}
                  onChangeText={setDeclaredBalance}
                />
                <TouchableOpacity style={styles.button} onPress={onReconcile} disabled={reconciling}>
                  {reconciling ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonText}>Vérifier</Text>}
                </TouchableOpacity>
              </View>
              {reconcileError ? <Text style={styles.error}>{reconcileError}</Text> : null}

              {reconciliations.map((r) => (
                <View key={r.id} style={styles.card}>
                  <Text style={styles.cardTitle}>Solde constaté : {n(r.declaredBalance).toLocaleString('fr-FR')} DH</Text>
                  <Text style={styles.cardMeta}>
                    Écart : {n(r.discrepancy).toLocaleString('fr-FR')} DH · {r.status === 'resolue' ? 'Résolu' : 'En attente'}
                  </Text>
                  {r.status === 'pending' && n(r.discrepancy) !== 0 && (
                    <View style={styles.adjustBox}>
                      <FormField
                        testID="account-adjust-reason-input"
                        placeholder="Raison (facultatif, ex. Frais bancaires)"
                        value={pendingReconciliation?.id === r.id ? adjustReason : ''}
                        onChangeText={setAdjustReason}
                      />
                      <TouchableOpacity style={styles.buttonSecondary} onPress={() => onAdjust(r.id)} disabled={adjustingId === r.id}>
                        {adjustingId === r.id ? (
                          <ActivityIndicator color={colors.textPrimary} />
                        ) : (
                          <Text style={styles.buttonSecondaryText}>Ajuster le solde à {n(r.declaredBalance).toLocaleString('fr-FR')} DH</Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
              {adjustError ? <Text style={styles.error}>{adjustError}</Text> : null}

              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setReconcileOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

      {/* Corrections UI/UX finales §4 — Transfert déplacé derrière le menu "•••",
          même logique/état qu'avant (onTransfer inchangé). */}
      <Modal visible={transferOpen} transparent animationType="fade" onRequestClose={() => setTransferOpen(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <View style={styles.modalCard} testID="account-transfer-form">
              <Text style={styles.modalTitle}>Transfert vers un autre compte</Text>
              {account.status === 'archive' ? (
                <Text style={styles.help}>Ce compte est archivé — réactivez-le pour transférer de l'argent depuis ce compte.</Text>
              ) : otherAccounts.length === 0 ? (
                <Text style={styles.help}>Créez un second compte pour pouvoir y transférer de l'argent.</Text>
              ) : (
                <>
                  <Select
                    testID="account-transfer-dest-select"
                    label="Compte destination"
                    placeholder="Choisir le compte destination"
                    value={toAccountId}
                    onChange={setToAccountId}
                    options={otherAccounts.map((a) => ({ value: a.id, label: a.name, sublabel: `${a.soldeCourant.toLocaleString('fr-FR')} DH` }))}
                  />
                  <FormField
                    testID="account-transfer-amount-input"
                    label="Montant"
                    placeholder="Montant (DH)"
                    keyboardType="decimal-pad"
                    value={transferAmount}
                    onChangeText={setTransferAmount}
                  />
                  {(() => {
                    const numericAmount = Number(transferAmount.replace(',', '.'));
                    const to = otherAccounts.find((a) => a.id === toAccountId);
                    if (!to || !numericAmount || numericAmount <= 0) return null;
                    return (
                      <View style={styles.transferPreview} testID="account-transfer-preview">
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
                  <TouchableOpacity style={styles.buttonConfirm} onPress={onTransfer} disabled={transferring}>
                    {transferring ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.buttonConfirmText}>CONFIRMER LE TRANSFERT</Text>}
                  </TouchableOpacity>
                  {transferError ? <Text style={styles.error}>{transferError}</Text> : null}
                </>
              )}
              <TouchableOpacity style={styles.modalButtonSecondary} onPress={() => setTransferOpen(false)}>
                <Text style={styles.modalButtonSecondaryText}>Fermer</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scroll: { padding: spacing.xl },
  modalScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sectionHeader: { fontSize: 11, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: spacing.sm },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  historyLabel: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  historyMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  historyAmount: { fontSize: 14, fontWeight: '700', marginLeft: spacing.sm },
  amountPositive: { color: colors.success },
  amountNegative: { color: colors.danger },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: 18,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.raised,
  },
  heroHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroLabel: { fontSize: 13, color: colors.textSecondary, fontWeight: '600', flexShrink: 1 },
  heroValue: { fontSize: 28, fontWeight: '800', color: colors.textPrimary, marginTop: 4 },
  offPilotBadge: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  menuButton: { paddingHorizontal: 10, paddingVertical: 2 },
  menuButtonText: { fontSize: 18, fontWeight: '700', color: colors.textSecondary },
  reactivateButton: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  reactivateButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  addTransactionButton: { backgroundColor: colors.surfaceActive, borderRadius: radius.sm, paddingVertical: 10, alignItems: 'center', marginTop: 12 },
  addTransactionButtonText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(23,36,54,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  // Point 6b — même correction que FinancialPlanDetailScreen : le ScrollView
  // a besoin d'une largeur propre (pas seulement via contentContainerStyle),
  // sinon la carte se réduit au shrink-to-fit sous un parent en centre.
  modalScroll: { width: '100%', alignSelf: 'stretch' },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, width: '100%' },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
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
  modalButtonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  modalButtonSecondary: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  modalButtonSecondaryText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.textPrimary, marginTop: 12, marginBottom: 6 },
  help: { fontSize: 12, color: colors.textSecondary, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rowField: { flex: 1, marginBottom: 0, marginRight: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
    marginBottom: 8,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 13 },
  transferPreview: { backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  transferPreviewTitle: { fontSize: 10, fontWeight: '700', color: colors.textSecondary, letterSpacing: 0.5, marginBottom: spacing.sm },
  transferPreviewRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  transferPreviewName: { fontSize: 13, color: colors.textPrimary, fontWeight: '600' },
  transferPreviewValue: { fontSize: 13, color: colors.textPrimary, fontWeight: '700' },
  buttonConfirm: { backgroundColor: colors.success, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  buttonConfirmText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
  buttonSecondary: { backgroundColor: colors.surfaceActive, borderRadius: radius.md, paddingVertical: 10, alignItems: 'center' },
  buttonSecondaryText: { color: colors.textPrimary, fontWeight: '600', fontSize: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    ...elevation.card,
  },
  cardWarning: { borderColor: colors.danger, backgroundColor: colors.dangerLight },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.textPrimary },
  cardMeta: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  envelopeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  envelopeName: { fontSize: 12, color: colors.textPrimary },
  envelopeAmount: { fontSize: 12, fontWeight: '700', color: colors.textPrimary },
  envelopeDivider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  warningText: { fontSize: 12, color: colors.danger, fontWeight: '600', marginTop: 4 },
  adjustBox: { marginTop: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
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
  pilotageRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  pilotageLabel: { fontSize: 12, fontWeight: '600', color: colors.textPrimary },
  pilotageHelp: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
