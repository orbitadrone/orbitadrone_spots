import {useCallback, useEffect, useSyncExternalStore} from 'react';

import {
  AppOpenAdState,
  appOpenAdManager,
} from '../services/appOpenAdManager';

export const useAppOpenAd = (): AppOpenAdState & {
  loadAd: (options?: {force?: boolean}) => void;
  showAdIfAvailable: () => boolean;
} => {
  const state = useSyncExternalStore<AppOpenAdState>(
    appOpenAdManager.subscribe,
    appOpenAdManager.getState,
    appOpenAdManager.getState,
  );

  useEffect(() => {
    appOpenAdManager.initialize();
  }, []);

  const loadAd = useCallback(
    (options?: {force?: boolean}) => appOpenAdManager.loadAd(options),
    [],
  );

  const showAdIfAvailable = useCallback(
    () => appOpenAdManager.showAdIfAvailable(),
    [],
  );

  return {
    ...state,
    loadAd,
    showAdIfAvailable,
  };
};
