import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid, DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { colors, radius, spacing, typography } from './theme';

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
  label: { ...typography.caption, fontWeight: '600', marginBottom: spacing.xs },
  field: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  value: { ...typography.body },
  placeholder: { fontSize: 14, color: colors.textPlaceholder },
  icon: { fontSize: 14 },
});
