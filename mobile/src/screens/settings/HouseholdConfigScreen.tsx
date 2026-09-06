import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface HouseholdInfo {
  name: string;
  currency: string;
  createdAt: string;
  memberships: unknown[];
  children: unknown[];
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** ☰ Paramètres → Configuration du foyer. Vue d'ensemble, renvoie vers Membres/Préférences pour agir. */
export function HouseholdConfigScreen() {
  const navigation = useNavigation<any>();
  const bottomInset = useBottomInset();
  const [household, setHousehold] = useState<HouseholdInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHousehold(await api.getMyHousehold());
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading || !household) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{household.name}</Text>
        <Text style={styles.cardMeta}>Devise : {household.currency}</Text>
        <Text style={styles.cardMeta}>Créé le {formatDate(household.createdAt)}</Text>
        <Text style={styles.cardMeta}>{household.memberships.length} adulte(s) · {household.children.length} enfant(s)</Text>
      </View>

      <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('HouseholdMembers')}>
        <Text style={styles.rowText}>Gérer les membres du foyer</Text>
        <Text style={styles.rowChevron}>→</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Preferences')}>
        <Text style={styles.rowText}>Préférences financières</Text>
        <Text style={styles.rowChevron}>→</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  rowText: { fontSize: 14, fontWeight: '600', color: '#172436' },
  rowChevron: { color: '#9AA0A6' },
});
