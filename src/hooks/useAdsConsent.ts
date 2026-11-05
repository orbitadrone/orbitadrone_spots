import {useCallback, useSyncExternalStore} from 'react';

import {adsConsentService} from '../services/adsConsentService';

export const useAdsConsent = () => {
  const state = useSyncExternalStore(
    adsConsentService.subscribe,
    adsConsentService.getState,
    adsConsentService.getState,
  );

  const refreshConsent = useCallback(() => adsConsentService.refresh(), []);
  const openPrivacyOptions = useCallback(
    () => adsConsentService.openPrivacyOptions(),
    [],
  );

  return {
    ...state,
    refreshConsent,
    openPrivacyOptions,
  };
};
