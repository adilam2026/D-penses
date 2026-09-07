import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MultiSelect } from '../MultiSelect';

const OPTIONS = [
  { value: 'c1', label: 'Wael' },
  { value: 'c2', label: 'Dina' },
  { value: 'c3', label: 'Adam' },
];

it('affiche "Sélectionner…" tant que rien n\'est coché, jamais une liste de chips permanente', async () => {
  await render(<MultiSelect testID="children" value={[]} options={OPTIONS} onChange={jest.fn()} />);
  expect(screen.getByText('Sélectionner…')).toBeTruthy();
  expect(screen.queryByText('Wael')).toBeNull();
});

it('coche/décoche une option sans fermer le sheet, résumé "N sélectionné(s)" au-delà de 2', async () => {
  const onChange = jest.fn();
  const { rerender } = await render(<MultiSelect testID="children" value={[]} options={OPTIONS} onChange={onChange} />);

  fireEvent.press(screen.getByTestId('children'));
  await fireEvent.press(await screen.findByTestId('children-option-c1'));
  expect(onChange).toHaveBeenCalledWith(['c1']);

  await rerender(<MultiSelect testID="children" value={['c1', 'c2', 'c3']} options={OPTIONS} onChange={onChange} />);
  expect(screen.getByText('3 sélectionné(s)')).toBeTruthy();
});

it('résumé court (noms) pour 1 ou 2 sélections', async () => {
  await render(<MultiSelect testID="children" value={['c1', 'c2']} options={OPTIONS} onChange={jest.fn()} />);
  expect(screen.getByText('Wael, Dina')).toBeTruthy();
});
