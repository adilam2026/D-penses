import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { CreateIncomeScreen } from '../CreateIncomeScreen';
import * as api from '../../../api/client';

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

// R6.2 (§1) : DateField mocké par un champ texte contrôlé, comme dans les
// autres suites (SchoolWizardScreen) — déjà testé isolément.
jest.mock('../../../ui/DateField', () => {
  const { TextInput } = require('react-native');
  return {
    DateField: ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) => (
      <TextInput testID={label ? `date-${label}` : 'date-field'} value={value} onChangeText={onChange} />
    ),
  };
});

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return { ...actual, listAccounts: jest.fn(), listCategories: jest.fn(), createIncomeSource: jest.fn() };
});

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listAccounts.mockResolvedValue([{ id: 'acc1', name: 'CIH' }]);
  mockedApi.listCategories.mockResolvedValue([]);
});

it('compte via sélecteur compact et fréquence via sélecteur compact', async () => {
  mockedApi.createIncomeSource.mockResolvedValue({ id: 's1' });
  await render(<CreateIncomeScreen />);
  await waitFor(() => screen.getByTestId('income-account-select'));

  await fireEvent.changeText(screen.getByPlaceholderText('Ex. Salaire'), 'Salaire');
  await fireEvent.changeText(screen.getByPlaceholderText('Montant (DH)'), '10000');

  await fireEvent.press(screen.getByTestId('income-frequency-select'));
  await waitFor(() => screen.getByTestId('income-frequency-select-option-trimestriel'));
  await fireEvent.press(screen.getByTestId('income-frequency-select-option-trimestriel'));

  await fireEvent.changeText(screen.getByTestId('date-Prochain versement'), '2026-10-15');

  await fireEvent.press(screen.getByTestId('income-account-select'));
  await waitFor(() => screen.getByTestId('income-account-select-option-acc1'));
  await fireEvent.press(screen.getByTestId('income-account-select-option-acc1'));

  await fireEvent.press(screen.getByTestId('create-income-submit'));

  await waitFor(() =>
    expect(mockedApi.createIncomeSource).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'Salaire',
        usualAmount: 10000,
        recurrenceRule: 'trimestriel',
        recurrenceAnchorDate: '2026-10-15',
        defaultAccountId: 'acc1',
      }),
    ),
  );
  expect(mockGoBack).toHaveBeenCalled();
});
