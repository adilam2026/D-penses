import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PinDots, PinPad } from '../PinPad';

function Controlled({ maxLength = 6 }: { maxLength?: number }) {
  const [value, setValue] = useState('');
  return (
    <>
      <PinDots length={6} filled={value.length} />
      <PinPad value={value} onChange={setValue} maxLength={maxLength} />
    </>
  );
}

it('pavé strictement numérique : 0-9 + effacer, aucun champ texte (donc jamais de clavier avec lettres)', async () => {
  await render(<Controlled />);
  expect(JSON.stringify(screen.toJSON())).not.toContain('"type":"TextInput"');
  for (const d of '0123456789') expect(screen.getByTestId(`pin-key-${d}`)).toBeTruthy();
  expect(screen.getByTestId('pin-key-del')).toBeTruthy();
});

it('ronds remplis au fil de la saisie, chiffres jamais affichés, longueur maximale respectée', async () => {
  await render(<Controlled />);
  for (const d of '7305') await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
  expect(screen.getByTestId('pin-dots-3-filled')).toBeTruthy();
  expect(screen.queryByTestId('pin-dots-4-filled')).toBeNull();
  expect(screen.queryByText('7305')).toBeNull();
  for (const d of '18999') await fireEvent.press(screen.getByTestId(`pin-key-${d}`));
  expect(screen.getByTestId('pin-dots-5-filled')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('pin-key-del'));
  expect(screen.queryByTestId('pin-dots-5-filled')).toBeNull();
});
