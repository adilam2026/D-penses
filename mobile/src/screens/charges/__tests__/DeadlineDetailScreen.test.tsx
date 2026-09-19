import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DeadlineDetailScreen } from '../DeadlineDetailScreen';
import * as api from '../../../api/client';

/**
 * R6 clôture §5 — le parcours de paiement est désormais unique dans l'app :
 * sélecteur de compte compact (jamais un mur de chips), récapitulatif avant
 * confirmation (montant payé / compte / solde actuel / solde après / reste à
 * payer après opération), paiement partiel explicite.
 */
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: { id: 'dl1' } }),
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(cb, []);
  },
}));

jest.mock('../../../ui/useBottomInset', () => ({ useBottomInset: () => 16 }));
jest.mock('../../../ui/useKeyboardAwareScroll', () => ({
  useKeyboardAwareScroll: () => ({ scrollRef: { current: null }, handleFocus: jest.fn() }),
}));

jest.mock('../../../api/client', () => {
  const actual = jest.requireActual('../../../api/client');
  return {
    ...actual,
    getDeadline: jest.fn(),
    listPayments: jest.fn(),
    listAccounts: jest.fn(),
    getProvision: jest.fn(),
    createPayment: jest.fn(),
    payDeadlineWithProvision: jest.fn(),
    updateDeadline: jest.fn(),
    closeDeadline: jest.fn(),
    cancelDeadline: jest.fn(),
    getMyHousehold: jest.fn(),
  };
});

const mockedApi = api as jest.Mocked<typeof api>;

const DEADLINE = {
  id: 'dl1',
  dueDate: '2026-10-15',
  amountCurrent: 1000,
  amountStatus: 'confirme' as const,
  financialStatus: 'ouverte' as const,
  resteAPayer: 1000,
  provisionId: null,
  chargePlan: { label: 'Loyer' },
};

const ACCOUNTS = [
  { id: 'acc1', name: 'Compte principal', soldeCourant: 5000 },
  { id: 'acc2', name: 'Épargne', soldeCourant: 2000 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.listPayments.mockResolvedValue([]);
  mockedApi.listAccounts.mockResolvedValue(ACCOUNTS);
  mockedApi.getMyHousehold.mockResolvedValue({ settings: { seuilAPayerDays: 7 } } as any);
});

it('affiche un sélecteur compact pour le compte à débiter (jamais un mur de chips)', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  // Le second compte n'est jamais affiché en permanence (pas de mur de chips) — seulement via le modal du sélecteur.
  expect(screen.queryByText('Épargne')).toBeNull();

  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
});

it('affiche le récapitulatif (solde actuel/après, reste à payer) avant confirmation, paiement total', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));

  await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '1000');

  await waitFor(() => expect(screen.getByTestId('payment-recap')).toBeTruthy());
  expect(screen.getByText('5 000 DH')).toBeTruthy(); // solde actuel
  expect(screen.getByText('4 000 DH')).toBeTruthy(); // solde après paiement
  expect(screen.getByText('0 DH')).toBeTruthy(); // reste à payer après opération

  // Corrections consolidées §2 — un montant qui couvre le reste actuel propose
  // explicitement de clôturer, jamais un simple "confirmer" ambigu.
  await waitFor(() => expect(screen.getByText("PAYÉ — CLÔTURER L'ÉCHÉANCE")).toBeTruthy());
  await fireEvent.press(screen.getByTestId('deadline-pay-button'));
  await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 1000, accountId: 'acc1', paidDate: expect.any(String) }));
  // Paiement total → l'app appelle EXPLICITEMENT close(), jamais une clôture implicite backend.
  await waitFor(() => expect(mockedApi.closeDeadline).toHaveBeenCalledWith('dl1'));
});

// Corrections UI/UX finales §3 — le bloc "Confirmer la facture" (montant réel
// + bouton "Confirmer" séparé) est retiré, y compris pour une échéance dont
// amountStatus n'est pas "confirme" (l'ancien déclencheur du bloc) : le
// paiement (total ou partiel) reste le seul parcours pour agir sur l'échéance.
it('ne montre jamais le bloc "Confirmer la facture" (retiré), le parcours Payer reste présent', async () => {
  mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, amountStatus: 'estime' as const });
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  expect(screen.queryByText('Confirmer la facture')).toBeNull();
  expect(screen.queryByTestId('confirm-amount-input')).toBeNull();
  expect(screen.queryByText('Confirmer')).toBeNull();
  expect(screen.getByText('Payer (total ou partiel)')).toBeTruthy();
  expect(screen.getByTestId('deadline-pay-amount-input')).toBeTruthy();
});

it('paiement partiel : affiche explicitement le reste à payer après opération', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));

  await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '400');

  await waitFor(() => expect(screen.getByTestId('payment-recap')).toBeTruthy());
  expect(screen.getByText('600 DH')).toBeTruthy(); // reste à payer après opération
  expect(screen.getByText(/Paiement partiel — il restera 600 DH à payer/)).toBeTruthy();
  // Corrections consolidées §2 — un montant inférieur au reste actuel reste une
  // action "paiement partiel" explicite, jamais assimilée à une clôture.
  expect(screen.getByText('ENREGISTRER LE PAIEMENT PARTIEL')).toBeTruthy();

  mockedApi.createPayment.mockResolvedValue({} as any);
  await fireEvent.press(screen.getByTestId('deadline-pay-button'));
  await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 400, accountId: 'acc1', paidDate: expect.any(String) }));
  // Paiement partiel → jamais d'appel à close() : l'échéance reste ouverte (RG-014).
  expect(mockedApi.closeDeadline).not.toHaveBeenCalled();
});

/**
 * Corrections consolidées §2 — orchestration explicite paiement partiel/total
 * (backend RG-014 ne clôture jamais seul) : Cas 1/2/3 imposés par la revue de
 * cohérence fonctionnelle.
 */
describe('Corrections consolidées §2 — orchestration paiement partiel/total (Cas 1/2/3)', () => {
  it('Cas 1 : prévu 200, paiement 100 → paiement enregistré, reste 100, échéance toujours ouverte (jamais de close())', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, amountCurrent: 200, resteAPayer: 200 });
    mockedApi.createPayment.mockResolvedValue({} as any);
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
    fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));
    await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '100');

    await waitFor(() => expect(screen.getByText('ENREGISTRER LE PAIEMENT PARTIEL')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-button'));

    await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 100, accountId: 'acc1', paidDate: expect.any(String) }));
    expect(mockedApi.closeDeadline).not.toHaveBeenCalled();
  });

  it("Cas 2 : même échéance, second paiement de 100 (reste 100 → 0) → paiement enregistré ET close() appelé explicitement", async () => {
    // Après le premier paiement partiel (Cas 1), le reste à payer réel est désormais 100.
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, amountCurrent: 200, resteAPayer: 100, financialStatus: 'partiellement_payee' });
    mockedApi.createPayment.mockResolvedValue({} as any);
    mockedApi.closeDeadline.mockResolvedValue({} as any);
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
    fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));
    await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '100');

    await waitFor(() => expect(screen.getByText("PAYÉ — CLÔTURER L'ÉCHÉANCE")).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-button'));

    await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 100, accountId: 'acc1', paidDate: expect.any(String) }));
    await waitFor(() => expect(mockedApi.closeDeadline).toHaveBeenCalledWith('dl1'));
    // L'ordre compte : le paiement est créé AVANT la clôture explicite.
    const paymentCallOrder = mockedApi.createPayment.mock.invocationCallOrder[0];
    const closeCallOrder = mockedApi.closeDeadline.mock.invocationCallOrder[0];
    expect(paymentCallOrder).toBeLessThan(closeCallOrder);
  });

  it('Cas 3 : prévu 200, paiement direct de 200 → paiement enregistré ET close() appelé explicitement', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, amountCurrent: 200, resteAPayer: 200 });
    mockedApi.createPayment.mockResolvedValue({} as any);
    mockedApi.closeDeadline.mockResolvedValue({} as any);
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
    fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));
    await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '200');

    await waitFor(() => expect(screen.getByText("PAYÉ — CLÔTURER L'ÉCHÉANCE")).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-button'));

    await waitFor(() => expect(mockedApi.createPayment).toHaveBeenCalledWith('dl1', { amount: 200, accountId: 'acc1', paidDate: expect.any(String) }));
    await waitFor(() => expect(mockedApi.closeDeadline).toHaveBeenCalledWith('dl1'));
  });

  it("Cas 4 (corrections §2bis) : prévu/reste 200, montant saisi 250 (> reste) → validation bloquée, message clair, aucun appel API", async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, amountCurrent: 200, resteAPayer: 200 });
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
    fireEvent.press(screen.getByTestId('deadline-pay-account-select'));
    await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select-option-acc1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-pay-account-select-option-acc1'));
    await fireEvent.changeText(screen.getByTestId('deadline-pay-amount-input'), '250');

    // Jamais le récapitulatif normal (qui aurait masqué le trop-payé derrière un
    // "reste 0" via clamp) — un message d'erreur explicite avec le reste maximal à la place.
    await waitFor(() => expect(screen.getByTestId('payment-overpayment-error')).toBeTruthy());
    expect(screen.queryByTestId('payment-recap')).toBeNull();
    expect(screen.getByText(/restent dus sur cette échéance/)).toBeTruthy();

    // Le bouton de confirmation est désactivé — aucun paiement ne peut être déclenché.
    const button = screen.getByTestId('deadline-pay-button');
    expect(button.props.accessibilityState?.disabled ?? button.props.disabled).toBeTruthy();
    fireEvent.press(button);

    expect(mockedApi.createPayment).not.toHaveBeenCalled();
    expect(mockedApi.closeDeadline).not.toHaveBeenCalled();
  });
});

it('le bouton CONFIRMER LE PAIEMENT est désactivé tant qu\'aucun montant n\'est saisi', async () => {
  mockedApi.getDeadline.mockResolvedValue(DEADLINE);
  await render(<DeadlineDetailScreen />);

  await waitFor(() => expect(screen.getByTestId('deadline-pay-account-select')).toBeTruthy());
  expect(screen.queryByTestId('payment-recap')).toBeNull();
  const button = screen.getByText('CONFIRMER LE PAIEMENT').parent;
  expect(button?.props.accessibilityState?.disabled ?? true).toBeTruthy();
});

/**
 * Mini-lot Paiements/Échéances — badge temporel (statut partagé, cf.
 * temporalStatus) + accès direct Corriger/Annuler depuis un paiement.
 */
describe('Mini-lot Paiements/Échéances — badge temporel + accès direct aux paiements', () => {
  it('une échéance soldée n\'affiche jamais de badge "En retard", même avec une date largement dépassée', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, dueDate: '2020-01-01', financialStatus: 'soldee', resteAPayer: 0 });
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByText('Soldée')).toBeTruthy());
    expect(screen.queryByTestId('deadline-temporal-badge')).toBeNull();
    expect(screen.queryByText('En retard')).toBeNull();
  });

  it('une échéance ouverte en retard affiche le badge "En retard"', async () => {
    mockedApi.getDeadline.mockResolvedValue({ ...DEADLINE, dueDate: '2020-01-01' });
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-temporal-badge')).toBeTruthy());
    expect(screen.getByText('En retard')).toBeTruthy();
  });

  it('tap sur une ligne "Paiement enregistré" → navigation directe vers TransactionDetailScreen (Corriger/Annuler existants réutilisés)', async () => {
    mockedApi.getDeadline.mockResolvedValue(DEADLINE);
    mockedApi.listPayments.mockResolvedValue([
      { id: 'pay1', amount: 400, paidDate: '2026-10-01', type: 'paiement', accountId: 'acc1', provisionId: null },
    ]);
    await render(<DeadlineDetailScreen />);

    await waitFor(() => expect(screen.getByTestId('deadline-payment-row-pay1')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('deadline-payment-row-pay1'));

    expect(mockNavigate).toHaveBeenCalledWith('TransactionDetail', { kind: 'payment', id: 'pay1' });
  });
});
