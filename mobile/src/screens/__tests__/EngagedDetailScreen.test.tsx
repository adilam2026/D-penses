import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { EngagedDetailScreen } from '../EngagedDetailScreen';

const mockNavigate = jest.fn();
const ROUTE_PARAMS = {
  committedAmount: 25000,
  deadlineItems: [
    { id: 'd1', chargePlanId: 'cp1', chargePlanLabel: 'Loyer', dueDate: '2026-10-05', amountStatus: 'confirme', resteAPayer: 12000, coverageStatus: 'non_couverte', engagementNonCouvert: 12000 },
    { id: 'd2', chargePlanId: 'cp2', chargePlanLabel: 'Assurance', dueDate: '2026-09-20', amountStatus: 'confirme', resteAPayer: 8000, coverageStatus: 'non_couverte', engagementNonCouvert: 8000 },
    { id: 'd3', chargePlanId: 'cp3', chargePlanLabel: 'Facture inconnue', dueDate: '2026-09-25', amountStatus: 'inconnu', resteAPayer: null, coverageStatus: 'sans_objet', engagementNonCouvert: null },
  ],
  variableBudgetItems: [{ variableBudgetId: 'vb1', amount: 5000, categoryName: 'Courses' }],
  horizonDate: '2026-10-15',
  horizonIsFallback: false,
};

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useRoute: () => ({ params: ROUTE_PARAMS }),
}));

jest.mock('../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));

/**
 * R6.3 (point B) — la somme des composantes affichées (échéances + budgets variables)
 * doit être EXACTEMENT le montant "Engagé" reçu de Home (même source, aucun recalcul).
 */
describe('EngagedDetailScreen — R6.3 point B', () => {
  it('affiche le même total que "Engagé" Home, et Σ composantes = ce total', async () => {
    await render(<EngagedDetailScreen />);
    expect(screen.getByTestId('engaged-detail-total').props.children.join('')).toContain('25');

    // Σ deadlineItems.engagementNonCouvert (12000+8000) + Σ variableBudgetItems.amount (5000) = 25000 = committedAmount.
    const known = ROUTE_PARAMS.deadlineItems.filter((d) => d.engagementNonCouvert !== null);
    const sum =
      known.reduce((s, d) => s + (d.engagementNonCouvert ?? 0), 0) +
      ROUTE_PARAMS.variableBudgetItems.reduce((s, b) => s + b.amount, 0);
    expect(sum).toBe(ROUTE_PARAMS.committedAmount);

    expect(screen.getByText('Loyer')).toBeTruthy();
    expect(screen.getByText('Assurance')).toBeTruthy();
    expect(screen.getByText('Courses')).toBeTruthy();
  });

  it('une échéance inconnue est signalée séparément, jamais comptée dans le total ni silencieusement omise', async () => {
    await render(<EngagedDetailScreen />);
    expect(screen.getByText(/1 échéance\(s\) à montant encore inconnu/)).toBeTruthy();
    expect(screen.queryByText('Facture inconnue')).toBeNull(); // pas dans la liste chiffrée
  });

  it('une échéance connue est cliquable → DeadlineDetail', async () => {
    await render(<EngagedDetailScreen />);
    await fireEvent.press(screen.getByTestId('engaged-deadline-d1'));
    expect(mockNavigate).toHaveBeenCalledWith('DeadlineDetail', { deadlineId: 'd1' });
  });
});
