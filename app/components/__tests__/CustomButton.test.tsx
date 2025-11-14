import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import CustomButton from '../CustomButton';

// Agrupamos las pruebas para nuestro CustomButton
describe('<CustomButton />', () => {

  // Prueba 1: ¿Se renderiza con el título correcto?
  it('renders the correct title', () => {
    // Renderizamos el botón en un entorno de prueba virtual
    render(<CustomButton title="Click Me" onPress={() => {}} />);
    
    // Buscamos en la pantalla virtual si existe un texto que diga "Click Me"
    // y esperamos que el resultado sea verdadero.
    expect(screen.getByText('Click Me')).toBeTruthy();
  });

  // Prueba 2: ¿Llama a la función onPress cuando se presiona?
  it('calls onPress function when pressed', () => {
    // Creamos una "función espía". Es una función falsa que solo registra si ha sido llamada.
    const mockOnPress = jest.fn();

    // Renderizamos el botón pasándole nuestra función espía
    render(<CustomButton title="Click Me" onPress={mockOnPress} />);

    // Simulamos un "click" o "press" del usuario en el botón
    fireEvent.press(screen.getByText('Click Me'));

    // Esperamos que nuestra función espía haya sido llamada exactamente 1 vez.
    expect(mockOnPress).toHaveBeenCalledTimes(1);
  });
});
