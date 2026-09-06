import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';

interface Member {
  id: string;
  role: 'admin' | 'member' | 'read_only';
  user: { firstName: string; lastName: string; email: string };
}

const ROLE_LABEL: Record<Member['role'], string> = { admin: 'Administrateur', member: 'Membre', read_only: 'Lecture seule' };

/** Membres du foyer (☰ Mon foyer) — déplacé depuis l'accueil (§6/§29) pour désencombrer le cockpit. */
export function HouseholdMembersScreen() {
  const bottomInset = useBottomInset();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const household = await api.getMyHousehold();
      setMembers(household.memberships ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function onInvite() {
    setInviting(true);
    try {
      const res = await api.createInvite();
      setInvite(res.code);
    } finally {
      setInviting(false);
    }
  }

  if (loading && members.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.scroll, { paddingBottom: bottomInset }]}>
      <Text style={styles.intro}>Les adultes de votre foyer partagent les mêmes comptes, échéances et plans.</Text>
      {members.map((m) => (
        <View key={m.id} style={styles.card}>
          <Text style={styles.cardTitle}>
            {m.user.firstName} {m.user.lastName}
          </Text>
          <Text style={styles.cardMeta}>{m.user.email}</Text>
          <Text style={styles.roleBadge}>{ROLE_LABEL[m.role]}</Text>
        </View>
      ))}

      <TouchableOpacity style={styles.button} onPress={onInvite} disabled={inviting}>
        {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Inviter un second adulte</Text>}
      </TouchableOpacity>
      {invite ? <Text style={styles.inviteCode}>Code d'invitation : {invite}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  roleBadge: { fontSize: 11, color: '#2E7D5B', fontWeight: '700', marginTop: 6 },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  inviteCode: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#172436', letterSpacing: 1, textAlign: 'center' },
});
