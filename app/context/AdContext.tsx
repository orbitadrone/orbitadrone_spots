import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback, useMemo } from 'react';
import Purchases from 'react-native-purchases';
import type { CustomerInfoUpdateListener } from 'react-native-purchases';
import logger from '../../src/utils/logger';
import {useAdsConsent} from '../../src/hooks/useAdsConsent';
import {isAdsConsentRefreshRetryable} from '../../src/services/adsConsentService';
import {hasRemoveAdsEntitlement} from '../../src/utils/purchases';

interface AdContextType {
  areAdsDisabled: boolean;
  isPremium: boolean;
  canRequestAds: boolean;
  isConsentReady: boolean;
  isGatheringConsent: boolean;
  isPrivacyOptionsRequired: boolean;
  consentError: Error | null;
  isConsentErrorRetryable: boolean;
  disableAdsForSession: () => void;
  refreshCustomerInfo: () => Promise<void>;
  refreshConsent: () => Promise<unknown>;
  openPrivacyOptions: () => Promise<unknown>;
}

const AdContext = createContext<AdContextType | undefined>(undefined);

export const AdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSessionAdsDisabled, setIsSessionAdsDisabled] = useState(false);
  const [isPremium, setIsPremium] = useState(false);
  const {
    canRequestAds,
    error,
    hasCompletedFirstSync,
    isGatheringConsent,
    privacyOptionsRequirementStatus,
    refreshConsent,
    openPrivacyOptions,
  } = useAdsConsent();

  const refreshCustomerInfo = useCallback(async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      setIsPremium(hasRemoveAdsEntitlement(customerInfo));
    } catch (err) {
      logger.error('Error checking subscription status', err);
    }
  }, []);

  useEffect(() => {
    let listener: CustomerInfoUpdateListener | undefined;

    const init = async () => {
      await refreshCustomerInfo();
      listener = (customerInfo) => {
        setIsPremium(hasRemoveAdsEntitlement(customerInfo));
      };
      Purchases.addCustomerInfoUpdateListener(listener);
    };

    init();

    return () => {
      if (listener) {
        Purchases.removeCustomerInfoUpdateListener(listener);
      }
    };
  }, [refreshCustomerInfo]);

  const disableAdsForSession = useCallback(() => {
    logger.info('Ads disabled for this session.');
    setIsSessionAdsDisabled(true);
  }, []);

  const value = useMemo(() => ({
    areAdsDisabled: isPremium || isSessionAdsDisabled || !canRequestAds,
    isPremium,
    canRequestAds,
    isConsentReady: hasCompletedFirstSync,
    isGatheringConsent,
    isPrivacyOptionsRequired: privacyOptionsRequirementStatus === 'REQUIRED',
    consentError: error,
    isConsentErrorRetryable: isAdsConsentRefreshRetryable(error),
    disableAdsForSession,
    refreshCustomerInfo,
    refreshConsent,
    openPrivacyOptions,
  }), [
    canRequestAds,
    error,
    disableAdsForSession,
    hasCompletedFirstSync,
    isGatheringConsent,
    isPremium,
    isSessionAdsDisabled,
    openPrivacyOptions,
    privacyOptionsRequirementStatus,
    refreshConsent,
    refreshCustomerInfo,
  ]);

  return <AdContext.Provider value={value}>{children}</AdContext.Provider>;
};

export const useAds = (): AdContextType => {
  const context = useContext(AdContext);
  if (!context) {
    throw new Error('useAds must be used within an AdProvider');
  }
  return context;
};
