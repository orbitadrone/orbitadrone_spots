import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import Purchases, { CustomerInfo } from 'react-native-purchases';
import { REMOVE_ADS_ENTITLEMENT_ID } from '../../src/constants/purchases';

interface AdContextType {
  areAdsDisabled: boolean;
  isPremium: boolean;
  disableAdsForSession: () => void;
}

const AdContext = createContext<AdContextType | undefined>(undefined);

export const AdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSessionAdsDisabled, setIsSessionAdsDisabled] = useState(false);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    let removeListener: (() => void) | undefined;

    const init = async () => {
      try {
        const customerInfo = await Purchases.getCustomerInfo();
        setIsPremium(Boolean(customerInfo.entitlements.active[REMOVE_ADS_ENTITLEMENT_ID]));
      } catch (err) {
        console.error('Error checking subscription status', err);
      }
      removeListener = Purchases.addCustomerInfoUpdateListener((customerInfo) => {
        setIsPremium(Boolean(customerInfo.entitlements.active[REMOVE_ADS_ENTITLEMENT_ID]));
      });
    };

    init();

    return () => {
      removeListener?.();
    };
  }, []);

  const disableAdsForSession = () => {
    console.log('Ads disabled for this session.');
    setIsSessionAdsDisabled(true);
  };

  const value = {
    areAdsDisabled: isPremium || isSessionAdsDisabled,
    isPremium,
    disableAdsForSession,
  };

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
};

export const useAds = (): AdContextType => {
  const context = useContext(AdContext);
  if (!context) {
    throw new Error('useAds must be used within an AdProvider');
  }
  return context;
};
