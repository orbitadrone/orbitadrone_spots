import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import LanguageSelector from '../LanguageSelector';
import { useTranslation } from 'react-i18next';

// Mock a la librería react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

const mockUseTranslation = useTranslation as jest.Mock;

describe('<LanguageSelector />', () => {
  
  it('renders in Spanish and calls changeLanguage with "en" on press', () => {
    const changeLanguageMock = jest.fn();
    mockUseTranslation.mockReturnValue({
      t: key => {
        if (key === 'languageSelector.switchToEnglish') return 'Switch to English';
        return key;
      },
      i18n: {
        changeLanguage: changeLanguageMock,
        language: 'es',
      },
    });
    
    render(<LanguageSelector />);

    const button = screen.getByText('Switch to English');
    fireEvent.press(button);

    expect(changeLanguageMock).toHaveBeenCalledWith('en');
  });

  it('renders in English and calls changeLanguage with "es" on press', () => {
    const changeLanguageMock = jest.fn();
    mockUseTranslation.mockReturnValue({
      t: key => {
        if (key === 'languageSelector.switchToSpanish') return 'Cambiar a Español';
        return key;
      },
      i18n: {
        changeLanguage: changeLanguageMock,
        language: 'en',
      },
    });

    render(<LanguageSelector />);

    const button = screen.getByText('Cambiar a Español');
    fireEvent.press(button);

    expect(changeLanguageMock).toHaveBeenCalledWith('es');
  });

});
