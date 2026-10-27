import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as api from '../../api/client';
import { useBottomInset } from '../../ui/useBottomInset';
import { ColorPickerModal } from '../../ui/ColorPickerModal';
import { PERSON_COLOR_OPTIONS, personColor } from '../../ui/personPalette';

interface Member {
  id: string;
  userId?: string;
  role: 'admin' | 'member' | 'read_only';
  user: { firstName: string; lastName: string; email: string; color?: string | null };
}

const ROLE_LABEL: Record<Member['role'], string> = { admin: 'Administrateur', member: 'Membre', read_only: 'Lecture seule' };

/** Membres du foyer (☰ Mon foyer) — déplacé depuis l'accueil (§6/§29) pour désencombrer le cockpit. */
export function HouseholdMembersScreen() {
  const bottomInset = useBottomInset();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  // Couleur d'une personne : modifiable par un admin du foyer uniquement
  // (même règle que paramètres / invitations, vérifiée aussi côté backend).
  const [isAdmin, setIsAdmin] = useState(false);
  const [colorTarget, setColorTarget] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [household, me] = await Promise.all([api.getMyHousehold(), api.getMe()]);
      const list: Member[] = household.memberships ?? [];
      setMembers(list);
      setIsAdmin(list.some((m) => m.userId === me?.sub && m.role === 'admin'));
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
      {members.map((m) => {
        const color = personColor(m.user.color);
        return (
          <View key={m.id} style={styles.card} testID={`member-${m.id}`}>
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>
                  {m.user.firstName} {m.user.lastName}
                </Text>
                <Text style={styles.cardMeta}>{m.user.email}</Text>
                <Text style={styles.roleBadge}>{ROLE_LABEL[m.role]}</Text>
              </View>
              <View style={styles.colorCol}>
                <View style={[styles.colorDot, color ? { backgroundColor: color } : styles.colorDotEmpty]} testID={`member-color-dot-${m.id}`} />
                {isAdmin ? (
                  <TouchableOpacity onPress={() => setColorTarget(m)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`member-color-edit-${m.id}`}>
                    <Text style={styles.colorEdit}>{color ? 'Couleur' : 'Choisir une couleur'}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          </View>
        );
      })}

      <TouchableOpacity style={styles.button} onPress={onInvite} disabled={inviting}>
        {inviting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Inviter un second adulte</Text>}
      </TouchableOpacity>
      {invite ? <Text style={styles.inviteCode}>Code d'invitation : {invite}</Text> : null}

      <ColorPickerModal
        visible={!!colorTarget}
        title={colorTarget ? `Couleur de ${colorTarget.user.firstName}` : ''}
        initialColorKey={colorTarget?.user.color ?? null}
        options={PERSON_COLOR_OPTIONS}
        testIDPrefix="person-color"
        onClose={() => setColorTarget(null)}
        onSubmit={async (key) => {
          if (!colorTarget) return;
          await api.updateMemberColor(colorTarget.id, key);
          await load();
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F5F2' },
  scroll: { padding: 20 },
  intro: { color: '#6B747C', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#172436' },
  colorCol: { alignItems: 'center', marginLeft: 12 },
  colorDot: { width: 22, height: 22, borderRadius: 11 },
  colorDotEmpty: { borderWidth: 1.5, borderColor: '#C9CFD4', borderStyle: 'dashed' },
  colorEdit: { fontSize: 11, fontWeight: '700', color: '#2E7D5B', marginTop: 4 },
  cardMeta: { fontSize: 12, color: '#6B747C', marginTop: 2 },
  roleBadge: { fontSize: 11, color: '#2E7D5B', fontWeight: '700', marginTop: 6 },
  button: { backgroundColor: '#172436', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  inviteCode: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#172436', letterSpacing: 1, textAlign: 'center' },
});
