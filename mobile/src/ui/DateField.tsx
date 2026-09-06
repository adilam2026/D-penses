import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIso(iso: string): Date {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function formatFr(iso: string): string {
  return parseIso(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Champ date obligatoirement au calendrier natif (§3 vague 1) — jamais une
 * saisie manuelle AAAA-MM-JJ. Sur Android, le picker natif est lui-même une
 * boîte de dialogue modale : elle ne peut jamais être « recouverte » par le
 * clavier, contrairement à un TextInput texte libre.
 */
export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  placeholder = 'Choisir une date',
}: {
  label?: string;
  value: string;
  onChange: (iso: string) => void;
  minimumDate?: Date;
  placeholder?: string;
}) {
  const [showIOS, setShowIOS] = useState(false);
  const isSet = value.trim() !== '';

  function openAndroid() {
    // API impérative sur Android (DateTimePickerAndroid) pour éviter tout
    // remount de composant pendant l'ouverture — cf. bug focus (§2 vague 1).
    DateTimePickerAndroid.open({
      value: isSet ? parseIso(value) : new Date(),
      mode: 'date',
      minimumDate,
      onChange: (event: DateTimePickerEvent, selected?: Date) => {
        if (event.type === 'set' && selected) onChange(toIso(selected));
      },
    });
  }

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.field} onPress={() => (Platform.OS === 'android' ? openAndroid() : setShowIOS(true))}>
        <Text style={isSet ? styles.value : styles.placeholder}>{isSet ? formatFr(value) : placeholder}</Text>
        <Text style={styles.icon}>📅</Text>
      </TouchableOpacity>
      {Platform.OS === 'ios' && showIOS && (
        <DateTimePicker
          value={isSet ? parseIso(value) : new Date()}
          mode="date"
          display="inline"
          minimumDate={minimumDate}
          onChange={(event, selected) => {
            setShowIOS(false);
            if (event.type === 'set' && selected) onChange(toIso(selected));
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, color: '#6B747C', fontWeight: '600', marginBottom: 4 },
  field: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#E3E1DC',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  value: { fontSize: 14, color: '#172436' },
  placeholder: { fontSize: 14, color: '#9AA0A6' },
  icon: { fontSize: 14 },
});
