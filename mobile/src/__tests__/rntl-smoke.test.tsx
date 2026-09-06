import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';

function Counter() {
  const [value, setValue] = useState('');
  return (
    <View>
      <TextInput testID="amount" value={value} onChangeText={setValue} />
      <Text testID="echo">{value}</Text>
    </View>
  );
}

it('rend un composant RN et gère un onChangeText contrôlé', async () => {
  await render(<Counter />);
  const input = screen.getByTestId('amount');
  await fireEvent.changeText(input, '6');
  await fireEvent.changeText(input, '60');
  await fireEvent.changeText(input, '600');
  await fireEvent.changeText(input, '6000');
  expect(screen.getByTestId('echo').props.children).toBe('6000');
});
