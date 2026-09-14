import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Équivalent Web de DateField.tsx (résolu automatiquement par Metro sur la
 * plateforme web via l'extension .web.tsx) — même API que le natif, pas de
 * branche Platform dans les écrans consommateurs. Le calendrier natif
 * (DateTimePicker) n'a pas d'équivalent web : on s'appuie sur le champ
 * <input type="date"> natif du navigateur, qui fournit déjà un calendrier.
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
  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <input
        type="date"
        value={value}
        min={minimumDate ? toIso(minimumDate) : undefined}
        placeholder={placeholder}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={webInputStyle}
      />
    </View>
  );
}

const webInputStyle: React.CSSProperties = {
  backgroundColor: '#fff',
  borderRadius: 10,
  paddingLeft: 14,
  paddingRight: 14,
  paddingTop: 12,
  paddingBottom: 12,
  marginBottom: 10,
  fontSize: 14,
  border: '1px solid #E3E1DC',
  color: '#172436',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const styles = StyleSheet.create({
  label: { fontSize: 11, color: '#6B747C', fontWeight: '600', marginBottom: 4 },
});
