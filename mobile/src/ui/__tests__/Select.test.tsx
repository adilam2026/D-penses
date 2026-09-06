import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Select } from '../Select';

/**
 * Recette post-Vague 3 (§2/§3) — sélecteur compact remplaçant les longues
 * listes de chips permanentes. Vérifie : affichage du champ, ouverture de la
 * liste, sélection, recherche au-delà du seuil.
 */
const OPTIONS = [
  { value: 'a', label: 'Abonnements' },
  { value: 'b', label: 'Alimentation' },
  { value: 'c', label: 'Transport' },
];

it('affiche le placeholder quand rien n\'est sélectionné, puis le libellé une fois choisi', async () => {
  const onChange = jest.fn();
  const { rerender } = await render(
    <Select testID="cat" label="Catégorie" placeholder="Sélectionner une catégorie" value={null} options={OPTIONS} onChange={onChange} />,
  );
  expect(screen.getByText('Sélectionner une catégorie')).toBeTruthy();

  await rerender(<Select testID="cat" label="Catégorie" placeholder="Sélectionner une catégorie" value="b" options={OPTIONS} onChange={onChange} />);
  expect(screen.getByText('Alimentation')).toBeTruthy();
});

it('ouvre la liste au tap et sélectionne une option', async () => {
  const onChange = jest.fn();
  await render(<Select testID="cat" label="Catégorie" value={null} options={OPTIONS} onChange={onChange} />);

  await fireEvent.press(screen.getByTestId('cat'));
  await waitFor(() => screen.getByTestId('cat-option-b'));
  await fireEvent.press(screen.getByTestId('cat-option-b'));

  expect(onChange).toHaveBeenCalledWith('b');
});

it('n\'affiche pas de recherche sous le seuil, l\'affiche au-delà', async () => {
  const onChange = jest.fn();
  await render(<Select testID="short" value={null} options={OPTIONS} onChange={onChange} searchThreshold={8} />);
  await fireEvent.press(screen.getByTestId('short'));
  expect(screen.queryByTestId('short-search')).toBeNull();

  const many = Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: `Option ${i}` }));
  await render(<Select testID="long" value={null} options={many} onChange={onChange} searchThreshold={8} />);
  await fireEvent.press(screen.getByTestId('long'));
  expect(screen.getByTestId('long-search')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('long-search'), 'Option 3');
  expect(screen.getByText('Option 3')).toBeTruthy();
});
