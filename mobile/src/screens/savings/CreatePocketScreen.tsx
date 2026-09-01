import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';

interface Account {
  id: string;
  name: string;
}

interface Child {
  id: string;
  firstName: string;
}

/**
 * Création SavingsPocket/Provision (§9/§28). backed_by_account exige un compte
 * dédié existant — jamais un montant qui apparaîtrait par magie (RG-074/H-15) :
 * l'utilisateur crée d'abord le compte (écran Comptes) puis le lie ici.
 */
export function CreatePocketScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const kind = (route.params?.kind as 'pocket' | 'provision') ?? 'pocket';

  const [name, setName] = useState('');
  const [allocationMode, setAllocationMode] = useState<'virtual_allocation' | 'backed_by_account'>('virtual_allocation');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [targetAmount, setTargetAmount] = useState('');
  const [children, setChildren] = useState<Child[]>([]);
  const [beneficiaryChildId, setBeneficiaryChildId] = useState<string | null>(null);
  const [hasRecurringContribution, setHasRecurringContribution] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listAccounts().then(setAccounts);
    if (kind === 'pocket') api.listChildren().then(setChildren);
  }, [kind]);

  async function onSubmit() {
    setError(null);
    if (!name.trim()) {
      setError('Nom requis');
      return;
    }
    if (allocationMode === 'backed_by_account' && !linkedAccountId) {
      setError('Choisissez le compte dédié');
      return;
    }
    setSubmitting(true);
    try {
      if (kind === 'provision') {
        await api.createProvision({ name: name.trim(), allocationMode, linkedAccountId: linkedAccountId ?? undefined });
      } else {
        await api.createPocket({
          name: name.trim(),
          allocationMode,
          linkedAccountId: linkedAccountId ?? undefined,
          targetAmount: targetAmount ? Number(targetAmount.replace(',', '.')) : undefined,
          beneficiaryChildId: beneficiaryChildId ?? undefined,
          hasRecurringContribution: beneficiaryChildId ? hasRecurringContribution : undefined,
        });
      }
      navigation.goBack();
    } catch (err) {
      setError(err instanceof api.ApiError ? err.message : 'Création impossible');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>{kind === 'provision' ? 'Nouvelle provision' : 'Nouvelle poche d\'épargne'}</Text>

      <Text style={styles.sectionLabel}>Nom</Text>
      <TextInput style={styles.input} placeholder="ex. Provision École" value={name} onChangeText={setName} />

      <Text style={styles.sectionLabel}>Mode</Text>
      <View style={styles.segment}>
        <TouchableOpacity style={[styles.segmentItem, allocationMode === 'virtual_allocation' && styles.segmentActive]} onPress={() => setAllocationMode('virtual_allocation')}>
          <Text style={[styles.segmentText, allocationMode === 'virtual_allocation' && styles.segmentTextActive]}>Réservation virtuelle</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.segmentItem, allocationMode === 'backed_by_account' && styles.segmentActive]} onPress={() => setAllocationMode('backed_by_account')}>
          <Text style={[styles.segmentText, allocationMode === 'backed_by_account' && styles.segmentTextActive]}>Compte dédié</Text>
        </TouchableOpacity>
      </View>
      {allocationMode === 'virtual_allocation' ? (
        <Text style={styles.help}>Cette somme reste sur votre compte mais n'est plus considérée comme disponible.</Text>
      ) : (
        <>
          <Text style={styles.help}>L'argent est physiquement transféré vers un compte qui lui est exclusivement dédié.</Text>
          <View style={styles.chipRow}>
            {accounts.map((a) => (
              <TouchableOpacity key={a.id} style={[styles.chip, linkedAccountId === a.id && styles.chipActive]} onPress={() => setLinkedAccountId(a.id)}>
                <Text style={[styles.chipText, linkedAccountId === a.id && styles.chipTextActive]}>{a.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      {kind === 'pocket' && (
        <>
          <Text style={styles.sectionLabel}>Montant cible (optionnel)</Text>
          <TextInput style={styles.input} placeholder="Montant (DH)" keyboardType="decimal-pad" value={targetAmount} onChangeText={setTargetAmount} />

          <Text style={styles.sectionLabel}>Bénéficiaire (optionnel)</Text>
          <View style={styles.chipRow}>
            {children.map((c) => (
              <TouchableOpacity key={c.id} style={[styles.chip, beneficiaryChildId === c.id && styles.chipActive]} onPress={() => setBeneficiaryChildId(beneficiaryChildId === c.id ? null : c.id)}>
                <Text style={[styles.chipText, beneficiaryChildId === c.id && styles.chipTextActive]}>{c.firstName}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {beneficiaryChildId && (
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Versement récurrent déclaré (protège cette épargne, RG-047)</Text>
              <Switch value={hasRecurringContribution} onValueChange={setHasRecurringContribution} />
            </View>
          )}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Créer</Text>}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Text style={styles.cancel}>Annuler</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  scroll: { padding: 24, paddingTop: 16 },
  title: { fontSize: 18, fontWeight: '700', color: '#172436', marginBottom: 16 },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#172436', marginBottom: 8, marginTop: 4 },
  help: { fontSize: 11, color: '#6B747C', marginBottom: 12, fontStyle: 'italic' },
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
  segment: { flexDirection: 'row', backgroundColor: '#EDEBE6', borderRadius: 10, padding: 4, marginBottom: 8 },
  segmentItem: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { fontSize: 12, color: '#6B747C', fontWeight: '600' },
  segmentTextActive: { color: '#172436' },
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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  switchLabel: { fontSize: 12, color: '#172436', flex: 1, marginRight: 8 },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  cancel: { color: '#6B747C', textAlign: 'center', marginTop: 16, fontSize: 13, marginBottom: 24 },
  error: { color: '#B3261E', fontSize: 13, marginBottom: 8 },
});
