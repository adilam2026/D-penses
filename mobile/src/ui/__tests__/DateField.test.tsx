import React from 'react';
import { Platform } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

/**
 * Tests DateField (Vague 1B §4). Le preset jest-expo par défaut simule un
 * runtime iOS (cf. jest-expo/README « for legacy purposes, runs in the
 * standard React Native environment (iOS) ») — passer par le mock Android
 * officiel du package (@react-native-community/datetimepicker/jest) exige de
 * basculer tout le projet sur le preset jest-expo/android, ce qui dépasserait
 * le périmètre de cette vague. On mocke donc directement le module natif au
 * niveau de son contrat (l'API DateTimePickerAndroid.open({value, onChange}))
 * — une technique standard pour tester un composant au-dessus d'un module
 * natif, sans jamais prétendre exercer le vrai runtime Android (cf. §10 du
 * rapport : le rendu natif réel reste à vérifier sur appareil).
 */
let lastOpenOptions: { value: Date; onChange: (event: { type: string }, date?: Date) => void } | null = null;

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: (props: any) => React.createElement('DateTimePicker', props),
    DateTimePickerAndroid: {
      open: jest.fn((options: any) => {
        lastOpenOptions = options;
      }),
    },
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DateField } = require('../DateField');

describe('DateField (Android)', () => {
  const originalOS = Platform.OS;

  beforeAll(() => {
    Platform.OS = 'android';
  });

  afterAll(() => {
    Platform.OS = originalOS;
  });

  beforeEach(() => {
    lastOpenOptions = null;
  });

  it('affiche la date formatée en français quand une valeur est fournie', async () => {
    await render(<DateField label="Échéance" value="2026-09-30" onChange={jest.fn()} />);
    expect(screen.getByText('30 sept. 2026')).toBeTruthy();
  });

  it("affiche un texte de remplacement quand aucune date n'est encore choisie", async () => {
    await render(<DateField value="" onChange={jest.fn()} placeholder="Aucune date choisie" />);
    expect(screen.getByText('Aucune date choisie')).toBeTruthy();
  });

  it('un clic ouvre le calendrier natif avec la date actuelle pré-sélectionnée', async () => {
    await render(<DateField value="2026-09-05" onChange={jest.fn()} />);
    await fireEvent.press(screen.getByText('05 sept. 2026'));

    expect(lastOpenOptions).not.toBeNull();
    expect(lastOpenOptions!.value.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('sélectionner une date dans le calendrier transmet la bonne valeur via onChange', async () => {
    const onChange = jest.fn();
    await render(<DateField value="2026-09-05" onChange={onChange} />);
    await fireEvent.press(screen.getByText('05 sept. 2026'));

    // Simule le callback natif tel qu'il serait invoqué par Android après sélection.
    lastOpenOptions!.onChange({ type: 'set' }, new Date('2027-01-28T00:00:00'));

    expect(onChange).toHaveBeenCalledWith('2027-01-28');
  });

  it("une annulation du calendrier (dismissed) ne modifie jamais la valeur", async () => {
    const onChange = jest.fn();
    await render(<DateField value="2026-09-05" onChange={onChange} />);
    await fireEvent.press(screen.getByText('05 sept. 2026'));

    lastOpenOptions!.onChange({ type: 'dismissed' }, undefined);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('05 sept. 2026')).toBeTruthy();
  });
});
