import React, { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

/**
 * Preuve comportementale du mécanisme derrière le bug de focus (Vague 1B §3) :
 * un composant enfant redéfini À CHAQUE RENDER du parent (nested function
 * component) est démonté/remonté par React à chaque frappe, alors que le
 * même composant déclaré une seule fois au niveau module ne l'est jamais.
 *
 * On ne peut pas simuler un vrai clavier Android en Jest, mais le mécanisme
 * exact qui causait la fermeture du clavier — le démontage/remontage du
 * TextInput — est ici directement observable via les hooks de cycle de vie.
 */

const mountLog: string[] = [];

// Composant STABLE — déclaré une seule fois, au niveau module (le pattern
// correct, utilisé partout dans l'app après la correction Vague 1).
function StableField({ value, onChangeText }: { value: string; onChangeText: (v: string) => void }) {
  useEffect(() => {
    mountLog.push('stable-mount');
    return () => { mountLog.push('stable-unmount'); };
  }, []);
  return <TextInput testID="stable-input" value={value} onChangeText={onChangeText} />;
}

function ParentWithStableChild() {
  const [value, setValue] = useState('');
  return (
    <View>
      <StableField value={value} onChangeText={setValue} />
    </View>
  );
}

// Composant BUGGÉ — reproduit fidèlement l'ancien SchoolWizardScreen : une
// fonction composant redéclarée À L'INTÉRIEUR du render du parent.
function ParentWithNestedChild() {
  const [value, setValue] = useState('');

  // eslint-disable-next-line react/no-unstable-nested-components -- reproduction intentionnelle du bug d'origine
  function NestedField({ value: v, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
    useEffect(() => {
      mountLog.push('nested-mount');
      return () => { mountLog.push('nested-unmount'); };
    }, []);
    return <TextInput testID="nested-input" value={v} onChangeText={onChangeText} />;
  }

  return (
    <View>
      <NestedField value={value} onChangeText={setValue} />
    </View>
  );
}

beforeEach(() => {
  mountLog.length = 0;
});

it('un composant déclaré au niveau module ne remonte jamais quand le parent change de state', async () => {
  await render(<ParentWithStableChild />);
  const input = screen.getByTestId('stable-input');

  await fireEvent.changeText(input, '6');
  await fireEvent.changeText(input, '60');
  await fireEvent.changeText(input, '600');
  await fireEvent.changeText(input, '6000');

  expect(input.props.value).toBe('6000');
  // Un seul montage, jamais de démontage : aucune perte de focus possible.
  expect(mountLog).toEqual(['stable-mount']);
});

it('un composant redéfini dans le render du parent démonte/remonte à chaque frappe (mécanisme exact du bug corrigé)', async () => {
  await render(<ParentWithNestedChild />);

  await fireEvent.changeText(screen.getByTestId('nested-input'), '6');
  await fireEvent.changeText(screen.getByTestId('nested-input'), '60');
  await fireEvent.changeText(screen.getByTestId('nested-input'), '600');
  await fireEvent.changeText(screen.getByTestId('nested-input'), '6000');

  expect(screen.getByTestId('nested-input').props.value).toBe('6000');
  // Chaque frappe provoque un démontage puis un remontage — exactement le
  // comportement qui fermait le clavier Android sur le vrai appareil.
  expect(mountLog.filter((e) => e === 'nested-mount').length).toBeGreaterThan(1);
  expect(mountLog.filter((e) => e === 'nested-unmount').length).toBeGreaterThan(0);
});
