import React, { createContext, useState, useContext, ReactNode, useCallback, useMemo } from 'react';
import logger from '../../src/utils/logger';
import {useAdsConsent} from '../../src/hooks/useAdsConsent';
import {isAdsConsentRefreshRetryable} from '../../src/services/adsConsentService';

interface AdContextType {
  areAdsDisabled: boolean;
  canRequestAds: boolean;
  isConsentReady: boolean;
  isGatheringConsent: boolean;
  isPrivacyOptionsRequired: boolean;
  consentError: Error | null;
  isConsentErrorRetryable: boolean;
  disableAdsForSession: () => void;
  refreshConsent: () => Promise<unknown>;
  openPrivacyOptions: () => Promise<unknown>;
}

const AdContext = createContext<AdContextType | undefined>(undefined);

export const AdProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSessionAdsDisabled, setIsSessionAdsDisabled] = useState(false);
  const {
    canRequestAds,
    error,
    hasCompletedFirstSync,
    isGatheringConsent,
    privacyOptionsRequirementStatus,
    refreshConsent,
    openPrivacyOptions,
  } = useAdsConsent();

  const disableAdsForSession = useCallback(() => {
    logger.info('Ads disabled for this session.');
    setIsSessionAdsDisabled(true);
  }, []);

  const value = useMemo(() => ({
    areAdsDisabled: isSessionAdsDisabled || !canRequestAds,
    canRequestAds,
    isConsentReady: hasCompletedFirstSync,
    isGatheringConsent,
    isPrivacyOptionsRequired: privacyOptionsRequirementStatus === 'REQUIRED',
    consentError: error,
    isConsentErrorRetryable: isAdsConsentRefreshRetryable(error),
    disableAdsForSession,
    refreshConsent,
    openPrivacyOptions,
  }), [
    canRequestAds,
    error,
    disableAdsForSession,
    hasCompletedFirstSync,
    isGatheringConsent,
    isSessionAdsDisabled,
    openPrivacyOptions,
    privacyOptionsRequirementStatus,
    refreshConsent,
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
