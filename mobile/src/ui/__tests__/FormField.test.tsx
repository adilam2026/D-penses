import React from 'react';
import { render } from '@testing-library/react-native';
import { FormField } from '../FormField';

describe('FormField', () => {
  it('affiche le label quand fourni', async () => {
    const { getByText } = await render(<FormField label="Nom du compte" testID="f" value="" onChangeText={() => {}} />);
    expect(getByText('Nom du compte')).toBeTruthy();
  });

  it("n'affiche aucun label quand absent", async () => {
    const { queryByText } = await render(<FormField testID="f" value="" onChangeText={() => {}} />);
    expect(queryByText('Nom du compte')).toBeNull();
  });

  it("affiche l'erreur et masque le helperText quand une erreur est présente", async () => {
    const { getByTestId, queryByText } = await render(
      <FormField testID="f" error="Montant invalide" helperText="Un texte d'aide" value="" onChangeText={() => {}} />,
    );
    expect(getByTestId('f-error').props.children).toBe('Montant invalide');
    expect(queryByText("Un texte d'aide")).toBeNull();
  });

  it('affiche le helperText en l\'absence d\'erreur', async () => {
    const { getByText } = await render(<FormField testID="f" helperText="Un texte d'aide" value="" onChangeText={() => {}} />);
    expect(getByText("Un texte d'aide")).toBeTruthy();
  });

  it('applique editable=false quand disabled', async () => {
    const { getByTestId } = await render(<FormField testID="f" editable={false} value="" onChangeText={() => {}} />);
    expect(getByTestId('f').props.editable).toBe(false);
  });
});
