import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { FormActions, FormContainer, FormGrid, FormGridItem } from '../FormLayout';

const mockUseResponsiveLayout = jest.fn();
jest.mock('../useResponsiveLayout', () => ({
  useResponsiveLayout: () => mockUseResponsiveLayout(),
}));

function flatStyle(style: any) {
  return Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : style;
}

describe('FormLayout', () => {
  beforeEach(() => {
    mockUseResponsiveLayout.mockReset();
  });

  it('FormContainer plafonne la largeur (défaut 850, jamais 100% brut du viewport)', async () => {
    const { getByTestId } = await render(
      <FormContainer>
        <Text testID="child">contenu</Text>
      </FormContainer>,
    );
    const container = getByTestId('child').parent as any;
    const style = flatStyle(container.props.style);
    expect(style.maxWidth).toBe(850);
    expect(style.width).toBe('100%');
  });

  it('FormContainer accepte un maxWidth explicite (formulaire "réellement complexe")', async () => {
    const { getByTestId } = await render(
      <FormContainer maxWidth={1000}>
        <Text testID="child2">contenu</Text>
      </FormContainer>,
    );
    const container = getByTestId('child2').parent as any;
    const style = flatStyle(container.props.style);
    expect(style.maxWidth).toBe(1000);
  });

  it.each([
    ['mobile', 1],
    ['tablet', 2],
    ['desktop', 3],
  ] as const)('FormGrid attribue %s colonnes -> %i colonne(s) par défaut', async (deviceClass, expectedCols) => {
    mockUseResponsiveLayout.mockReturnValue({ deviceClass });
    const { getByTestId } = await render(
      <FormGrid>
        <FormGridItem>
          <Text testID="item">x</Text>
        </FormGridItem>
      </FormGrid>,
    );
    const cell = getByTestId('item').parent as any;
    const style = flatStyle(cell.props.style);
    expect(style.flexBasis).toBe(`${100 / expectedCols}%`);
  });

  it('FormGridItem span est plafonné au nombre de colonnes courant (donc 100% sur mobile, où columns=1)', async () => {
    mockUseResponsiveLayout.mockReturnValue({ deviceClass: 'mobile' });
    const { getByTestId } = await render(
      <FormGrid>
        <FormGridItem span={2}>
          <Text testID="note">Note</Text>
        </FormGridItem>
      </FormGrid>,
    );
    const cell = getByTestId('note').parent as any;
    const style = flatStyle(cell.props.style);
    expect(style.flexBasis).toBe('100%');
  });

  it('FormGridItem span=2 sur 3 colonnes desktop occupe 2/3 de la largeur', async () => {
    mockUseResponsiveLayout.mockReturnValue({ deviceClass: 'desktop' });
    const { getByTestId } = await render(
      <FormGrid>
        <FormGridItem span={2}>
          <Text testID="note">Note</Text>
        </FormGridItem>
      </FormGrid>,
    );
    const cell = getByTestId('note').parent as any;
    const style = flatStyle(cell.props.style);
    expect(style.flexBasis).toBe(`${(100 * 2) / 3}%`);
  });

  it('FormActions aligne à gauche par défaut (jamais un bouton isolé loin à droite)', async () => {
    const { getByTestId } = await render(
      <FormActions>
        <Text testID="btn">Enregistrer</Text>
      </FormActions>,
    );
    const row = getByTestId('btn').parent as any;
    const style = flatStyle(row.props.style);
    expect(style.justifyContent).toBe('flex-start');
  });

  it('FormActions align="right" justifie à droite quand demandé explicitement', async () => {
    const { getByTestId } = await render(
      <FormActions align="right">
        <Text testID="btn2">Enregistrer</Text>
      </FormActions>,
    );
    const row = getByTestId('btn2').parent as any;
    const style = flatStyle(row.props.style);
    expect(style.justifyContent).toBe('flex-end');
  });
});
