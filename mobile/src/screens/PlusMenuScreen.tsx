import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';

/** Menu « Plus » (docs/03 §J.4) — Comptes et Budgets restent des écrans secondaires, jamais en navigation principale (§37 risque L.3). */
export function PlusMenuScreen() {
  const navigation = useNavigation<any>();
  const { signOut } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Plus</Text>

      <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('Accounts')}>
        <Text style={styles.rowText}>Comptes</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('Budgets')}>
        <Text style={styles.rowText}>Budgets variables</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('Children')}>
        <Text style={styles.rowText}>Enfants</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('FinancialPlans')}>
        <Text style={styles.rowText}>Plans financiers</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.row} onPress={() => navigation.getParent()?.navigate('Projection')}>
        <Text style={styles.rowText}>Projection</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.logout} onPress={signOut}>
        <Text style={styles.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F2', paddingTop: 56, paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#172436', marginBottom: 20 },
  row: { backgroundColor: '#fff', borderRadius: 10, padding: 16, marginBottom: 10 },
  rowText: { fontSize: 15, fontWeight: '600', color: '#172436' },
  logout: { marginTop: 24, alignItems: 'center' },
  logoutText: { color: '#B3261E', fontSize: 13, fontWeight: '600' },
});
