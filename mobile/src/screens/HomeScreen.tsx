import React, { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { checkHealth } from '../api/client';
import * as api from '../api/client';

/**
 * Accueil (Dashboard, document 03 §J.3) — le tableau de bord complet
 * (trésorerie opérationnelle / disponible libre / actions à traiter) arrivera
 * avec les lots Trésorerie (5) et Projection (7).
 */
export function HomeScreen() {
  const navigation = useNavigation<any>();
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'down'>('checking');
  const [invite, setInvite] = useState<string | null>(null);
  const [invitingLoading, setInvitingLoading] = useState(false);

  useEffect(() => {
    checkHealth()
      .then(() => setApiStatus('ok'))
      .catch(() => setApiStatus('down'));
  }, []);

  async function onInvite() {
    setInvitingLoading(true);
    try {
      const res = await api.createInvite();
      setInvite(res.code);
    } finally {
      setInvitingLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Accueil</Text>
      <Text style={styles.subtitle}>Dashboard — arrivera avec les lots Comptes / Trésorerie / Projection.</Text>
      <View style={[styles.badge, apiStatus === 'ok' ? styles.badgeOk : styles.badgeWarn]}>
        <Text style={styles.badgeText}>
          {apiStatus === 'checking' && 'Connexion au serveur…'}
          {apiStatus === 'ok' && 'Serveur connecté'}
          {apiStatus === 'down' && 'Serveur injoignable'}
        </Text>
      </View>

      <TouchableOpacity style={styles.addButton} onPress={() => navigation.getParent()?.navigate('QuickAdd')}>
        <Text style={styles.addButtonText}>+ Ajouter un revenu ou un paiement</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.inviteButton} onPress={onInvite} disabled={invitingLoading}>
        {invitingLoading ? <ActivityIndicator /> : <Text style={styles.inviteButtonText}>Inviter un second adulte</Text>}
      </TouchableOpacity>
      {invite ? <Text style={styles.inviteCode}>Code d'invitation : {invite}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
  title: { fontSize: 20, fontWeight: '600', color: '#172436', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B747C', textAlign: 'center', marginBottom: 24 },
  badge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginBottom: 32 },
  badgeOk: { backgroundColor: '#E3EFE9' },
  badgeWarn: { backgroundColor: '#F4E1DA' },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#172436' },
  addButton: { backgroundColor: '#172436', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 14, marginBottom: 16 },
  addButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  inviteButton: { paddingVertical: 8 },
  inviteButtonText: { color: '#172436', fontSize: 13, fontWeight: '600' },
  inviteCode: { marginTop: 8, fontSize: 16, fontWeight: '700', color: '#172436', letterSpacing: 1 },
});
