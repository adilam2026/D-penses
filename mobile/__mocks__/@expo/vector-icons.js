// Mock de test pour @expo/vector-icons — évite de charger la chaîne réelle
// expo-font/expo-asset (non nécessaire en environnement de test, aucun rendu
// de police réel n'est requis pour vérifier le comportement des écrans).
const React = require('react');
const { Text } = require('react-native');

function makeIconSet(setName) {
  function Icon({ name, testID, ...props }) {
    return React.createElement(Text, { testID: testID ?? `icon-${setName}-${name}`, ...props }, name);
  }
  Icon.displayName = setName;
  Icon.glyphMap = new Proxy({}, { get: () => true });
  return Icon;
}

module.exports = new Proxy(
  {},
  {
    get: (_target, prop) => makeIconSet(String(prop)),
  },
);
