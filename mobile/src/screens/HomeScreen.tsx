import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { checkHealth } from '../api/client';

/**
 * Accueil (Dashboard, document 03 §J.3) — vide en Lot 0. La trésorerie
 * opérationnelle / disponible libre / actions à traiter arriveront avec
 * les lots Comptes (1), Trésorerie (5) et Projection (7).
 */
export function HomeScreen() {
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'down'>('checking');

  useEffect(() => {
    checkHealth()
      .then(() => setApiStatus('ok'))
      .catch(() => setApiStatus('down'));
  }, []);

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F5F2' },
  title: { fontSize: 20, fontWeight: '600', color: '#172436', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#6B747C', textAlign: 'center', marginBottom: 24 },
  badge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  badgeOk: { backgroundColor: '#E3EFE9' },
  badgeWarn: { backgroundColor: '#F4E1DA' },
  badgeText: { fontSize: 12, fontWeight: '600', color: '#172436' },
});
