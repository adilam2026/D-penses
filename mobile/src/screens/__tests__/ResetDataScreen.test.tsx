import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ResetDataScreen } from '../ResetDataScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const mockGetMyHousehold = jest.fn();
const mockResetHouseholdData = jest.fn();
jest.mock('../../api/client', () => ({
  getMyHousehold: () => mockGetMyHousehold(),
  resetHouseholdData: () => mockResetHouseholdData(),
  ApiError: class MockApiError extends Error {},
}));

const TEST_INSET_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function renderWithSafeArea(ui: React.ReactElement) {
  return render(<SafeAreaProvider initialMetrics={TEST_INSET_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMyHousehold.mockResolvedValue({ name: 'Famille Alami' });
});

// §17 — double confirmation explicite : le bouton final reste bloqué tant
// que le nom du foyer n'est pas retapé exactement.
it('le bouton final reste désactivé tant que le nom du foyer n\'est pas retapé exactement', async () => {
  await renderWithSafeArea(<ResetDataScreen />);
  await waitFor(() => screen.getByTestId('reset-data-continue'));
  fireEvent.press(screen.getByTestId('reset-data-continue'));

  await waitFor(() => screen.getByTestId('reset-data-confirm-input'));
  await waitFor(() => expect(screen.getByTestId('reset-data-confirm').props.accessibilityState?.disabled).toBe(true));

  fireEvent.changeText(screen.getByTestId('reset-data-confirm-input'), 'mauvais nom');
  await waitFor(() => expect(screen.getByTestId('reset-data-confirm').props.accessibilityState?.disabled).toBe(true));

  fireEvent.changeText(screen.getByTestId('reset-data-confirm-input'), 'Famille Alami');
  await waitFor(() => expect(screen.getByTestId('reset-data-confirm').props.accessibilityState?.disabled).toBe(false));
});

it('une fois confirmé, appelle resetHouseholdData() et affiche l\'écran de fin', async () => {
  mockResetHouseholdData.mockResolvedValue({});
  await renderWithSafeArea(<ResetDataScreen />);
  await waitFor(() => screen.getByTestId('reset-data-continue'));
  fireEvent.press(screen.getByTestId('reset-data-continue'));

  await waitFor(() => screen.getByTestId('reset-data-confirm-input'));
  fireEvent.changeText(screen.getByTestId('reset-data-confirm-input'), 'Famille Alami');
  await waitFor(() => expect(screen.getByTestId('reset-data-confirm').props.accessibilityState?.disabled).toBe(false));
  fireEvent.press(screen.getByTestId('reset-data-confirm'));

  await waitFor(() => expect(mockResetHouseholdData).toHaveBeenCalled());
  await waitFor(() => screen.getByText('Données réinitialisées'));
});
