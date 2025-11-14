import React from 'react';
import { render, fireEvent, screen, waitFor } from '@testing-library/react-native';
import RemoveAdsModal from '../RemoveAdsModal';
import { useTranslation } from 'react-i18next';
import Purchases from 'react-native-purchases';
import { REMOVE_ADS_ENTITLEMENT_ID } from '../../../src/constants/purchases';

// Mock a la librería react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: jest.fn(),
}));

const mockUseTranslation = useTranslation as jest.Mock;
const mockPurchases = Purchases as jest.Mocked<typeof Purchases>;

describe('<RemoveAdsModal />', () => {
  const mockOnClose = jest.fn();
  const mockOnWatchAd = jest.fn();

  beforeEach(() => {
    // Reiniciamos los mocks antes de cada prueba
    jest.clearAllMocks();
    
    mockUseTranslation.mockReturnValue({
      t: key => key, // Devolvemos la clave misma para simplificar la prueba
      i18n: {
        changeLanguage: jest.fn(),
      },
    });

    // Mock de la respuesta de getOfferings
    mockPurchases.getOfferings.mockResolvedValue({
      current: {
        availablePackages: [{
          product: {
            priceString: '€2.99',
          },
        }],
      },
    } as any);
  });

  it('renders correctly when visible and fetches offerings', async () => {
    render(<RemoveAdsModal isVisible={true} onClose={mockOnClose} onWatchAd={mockOnWatchAd} />);

    // Esperamos a que los textos aparezcan después de la carga
    await waitFor(() => {
      expect(screen.getByText('removeAds.title')).toBeTruthy();
      expect(screen.getByText('removeAds.rewardOptionTitle')).toBeTruthy();
      expect(screen.getByText('removeAds.premiumOptionTitle')).toBeTruthy();
      // Verificamos que se llamó a la función para obtener las ofertas
      expect(mockPurchases.getOfferings).toHaveBeenCalledTimes(1);
    });
  });

  it('does not render when not visible', () => {
    render(<RemoveAdsModal isVisible={false} onClose={mockOnClose} onWatchAd={mockOnWatchAd} />);
    
    // Verificamos que los textos NO están presentes
    expect(screen.queryByText('removeAds.title')).toBeNull();
  });

  it('calls onWatchAd when the watch ad button is pressed', async () => {
    render(<RemoveAdsModal isVisible={true} onClose={mockOnClose} onWatchAd={mockOnWatchAd} />);

    const watchAdButton = await screen.findByText('removeAds.watchAdButton');
    fireEvent.press(watchAdButton);

    expect(mockOnWatchAd).toHaveBeenCalledTimes(1);
  });

  it('calls restorePurchases and shows success message', async () => {
    mockPurchases.restorePurchases.mockResolvedValue({
      entitlements: { active: { [REMOVE_ADS_ENTITLEMENT_ID]: true } },
    } as any);

    render(<RemoveAdsModal isVisible={true} onClose={mockOnClose} onWatchAd={mockOnWatchAd} />);
    
    const restoreButton = await screen.findByText('iap.restorePurchases');
    fireEvent.press(restoreButton);

    await waitFor(() => {
      expect(mockPurchases.restorePurchases).toHaveBeenCalledTimes(1);
      // Aquí también probaríamos que el Toast.show fue llamado, pero requiere un mock adicional
      expect(mockOnClose).toHaveBeenCalledTimes(1); // Se cierra al restaurar con éxito
    });
  });

  it('calls purchasePackage when subscribe button is pressed', async () => {
    mockPurchases.purchasePackage.mockResolvedValue({
      customerInfo: { entitlements: { active: { [REMOVE_ADS_ENTITLEMENT_ID]: true } } },
    } as any);

    render(<RemoveAdsModal isVisible={true} onClose={mockOnClose} onWatchAd={mockOnWatchAd} />);

    const subscribeButton = await screen.findByText('removeAds.subscribeButton - €2.99');
    fireEvent.press(subscribeButton);

    await waitFor(() => {
      expect(mockPurchases.purchasePackage).toHaveBeenCalledTimes(1);
      expect(mockOnClose).toHaveBeenCalledTimes(1); // Se cierra al comprar con éxito
    });
  });
});
