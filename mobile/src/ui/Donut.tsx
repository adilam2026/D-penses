import React from 'react';
import { Text, View } from 'react-native';
import { colors } from './theme';

/**
 * Donut de consommation (Home, Maquette 3 §3/§9 — extrait ici pour être
 * partagé, ex. BudgetsScreen) — aucune librairie de rendu vectoriel
 * disponible dans cet environnement (installation réseau bloquée) : reproduit
 * un anneau de progression à partir de Views pures (technique "deux
 * demi-cercles pivotants", standard pour ce cas sans SVG/dégradé conique
 * natif). `pct` est la valeur RÉELLE déjà calculée par l'appelant
 * (consommé/plafond) — seul l'anneau visuel est borné à [0,100] (un cercle ne
 * peut pas dépasser un tour plein), jamais le texte affiché, qui reste le
 * pourcentage réel.
 */
export function Donut({ size, pct, warn }: { size: number; pct: number; warn: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const angle = (clamped / 100) * 360;
  const rightAngle = Math.min(angle, 180);
  const leftAngle = Math.max(angle - 180, 0);
  const fill = warn ? colors.warning : colors.success;
  const track = warn ? colors.donutTrackWarn : colors.donutTrack;
  const r = size / 2;
  const hole = size * 0.68;

  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', top: 0, left: r, width: r, height: size, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: -r,
            width: size,
            height: size,
            borderRadius: r,
            overflow: 'hidden',
            transform: [{ rotate: `${rightAngle - 180}deg` }],
          }}
        >
          <View style={{ position: 'absolute', top: 0, left: r, width: r, height: size, backgroundColor: fill }} />
        </View>
      </View>
      <View style={{ position: 'absolute', top: 0, left: 0, width: r, height: size, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            borderRadius: r,
            overflow: 'hidden',
            transform: [{ rotate: `${leftAngle}deg` }],
          }}
        >
          <View style={{ position: 'absolute', top: 0, left: r, width: r, height: size, backgroundColor: fill }} />
        </View>
      </View>
      <View
        style={{
          position: 'absolute',
          top: (size - hole) / 2,
          left: (size - hole) / 2,
          width: hole,
          height: hole,
          borderRadius: hole / 2,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: '800', color: colors.textPrimary }}>{Math.round(pct)}%</Text>
      </View>
    </View>
  );
}
