import {
  AdEventType,
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
} from 'react-native-google-mobile-ads';

import {adsDiagnosticsService} from './adsDiagnosticsService';
import {interstitialAdUnitId, rewardedAdUnitId} from '../constants/adUnits';
import logger from '../utils/logger';

const MIN_TIME_BETWEEN_ADS = 90_000;
const LOAD_WAIT_TIMEOUT_MS = 2_500;
const LOAD_RETRY_DELAY_MS = 15_000;

type LoadWaiter = (ready: boolean) => void;

let lastAdShownTimestamp = 0;

const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);
const rewarded = RewardedAd.createForAdRequest(rewardedAdUnitId);

let isInitialized = false;

let isInterstitialLoaded = false;
let isInterstitialLoading = false;
let isInterstitialShowing = false;
let interstitialRetryTimeout: ReturnType<typeof setTimeout> | null = null;
const interstitialWaiters = new Set<LoadWaiter>();

let isRewardedLoaded = false;
let isRewardedLoading = false;
let isRewardedShowing = false;
let rewardedRetryTimeout: ReturnType<typeof setTimeout> | null = null;
const rewardedWaiters = new Set<LoadWaiter>();

const notifyWaiters = (waiters: Set<LoadWaiter>, ready: boolean) => {
  waiters.forEach(waiter => waiter(ready));
  waiters.clear();
};

const clearInterstitialRetry = () => {
  if (interstitialRetryTimeout) {
    clearTimeout(interstitialRetryTimeout);
    interstitialRetryTimeout = null;
  }
};

const clearRewardedRetry = () => {
  if (rewardedRetryTimeout) {
    clearTimeout(rewardedRetryTimeout);
    rewardedRetryTimeout = null;
  }
};

const scheduleInterstitialRetry = () => {
  if (interstitialRetryTimeout) {
    return;
  }
  interstitialRetryTimeout = setTimeout(() => {
    interstitialRetryTimeout = null;
    requestInterstitialLoad();
  }, LOAD_RETRY_DELAY_MS);
};

const scheduleRewardedRetry = () => {
  if (rewardedRetryTimeout) {
    return;
  }
  rewardedRetryTimeout = setTimeout(() => {
    rewardedRetryTimeout = null;
    requestRewardedLoad();
  }, LOAD_RETRY_DELAY_MS);
};

const requestInterstitialLoad = () => {
  if (isInterstitialLoaded || isInterstitialLoading) {
    return;
  }

  isInterstitialLoading = true;
  adsDiagnosticsService.recordLoadRequested('interstitial');
  try {
    interstitial.load();
  } catch (error) {
    isInterstitialLoading = false;
    logger.warn('AdManager: Interstitial load request failed', error);
    notifyWaiters(interstitialWaiters, false);
    scheduleInterstitialRetry();
  }
};

const requestRewardedLoad = () => {
  if (isRewardedLoaded || isRewardedLoading) {
    return;
  }

  isRewardedLoading = true;
  adsDiagnosticsService.recordLoadRequested('rewarded');
  try {
    rewarded.load();
  } catch (error) {
    isRewardedLoading = false;
    logger.warn('AdManager: Rewarded load request failed', error);
    notifyWaiters(rewardedWaiters, false);
    scheduleRewardedRetry();
  }
};

const waitForLoad = (
  isLoaded: () => boolean,
  requestLoad: () => void,
  waiters: Set<LoadWaiter>,
  timeoutMs: number = LOAD_WAIT_TIMEOUT_MS,
) =>
  new Promise<boolean>(resolve => {
    if (isLoaded()) {
      resolve(true);
      return;
    }

    const waiter: LoadWaiter = ready => {
      clearTimeout(timeoutId);
      waiters.delete(waiter);
      resolve(ready);
    };

    const timeoutId = setTimeout(() => {
      waiters.delete(waiter);
      resolve(isLoaded());
    }, timeoutMs);

    waiters.add(waiter);
    requestLoad();
  });

const initialize = () => {
  if (isInitialized) {
    return;
  }

  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    clearInterstitialRetry();
    isInterstitialLoading = false;
    isInterstitialLoaded = true;
    adsDiagnosticsService.recordLoaded('interstitial');
    logger.info('AdManager: Interstitial Ad loaded and ready.');
    notifyWaiters(interstitialWaiters, true);
  });

  interstitial.addAdEventListener(AdEventType.ERROR, error => {
    isInterstitialLoading = false;
    isInterstitialLoaded = false;
    adsDiagnosticsService.recordFailed('interstitial', error);
    logger.warn('AdManager: Interstitial Ad failed to load', error);
    notifyWaiters(interstitialWaiters, false);
    if (!isInterstitialShowing) {
      scheduleInterstitialRetry();
    }
  });

  interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    isInterstitialShowing = false;
    isInterstitialLoaded = false;
    requestInterstitialLoad();
  });

  rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
    clearRewardedRetry();
    isRewardedLoading = false;
    isRewardedLoaded = true;
    adsDiagnosticsService.recordLoaded('rewarded');
    logger.info('AdManager: Rewarded Ad loaded and ready.');
    notifyWaiters(rewardedWaiters, true);
  });

  rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, reward => {
    logger.info('AdManager: User earned reward of', reward.amount, reward.type);
  });

  rewarded.addAdEventListener(AdEventType.ERROR, error => {
    isRewardedLoading = false;
    isRewardedLoaded = false;
    isRewardedShowing = false;
    adsDiagnosticsService.recordFailed('rewarded', error);
    logger.warn('AdManager: Rewarded Ad failed to load', error);
    notifyWaiters(rewardedWaiters, false);
    scheduleRewardedRetry();
  });

  rewarded.addAdEventListener(AdEventType.CLOSED, () => {
    isRewardedShowing = false;
    isRewardedLoaded = false;
    requestRewardedLoad();
  });

  requestInterstitialLoad();
  requestRewardedLoad();
  isInitialized = true;
};

const showInterstitialAd = (onAdClosed?: () => void, areAdsDisabled?: boolean) => {
  initialize();

  if (areAdsDisabled) {
    logger.info('AdManager: Ads are disabled, skipping interstitial.');
    onAdClosed?.();
    return;
  }

  if (isInterstitialShowing) {
    logger.info('AdManager: Interstitial already showing, skipping duplicate request.');
    onAdClosed?.();
    return;
  }

  const now = Date.now();
  if (now - lastAdShownTimestamp < MIN_TIME_BETWEEN_ADS) {
    logger.info('AdManager: Interstitial ad not shown, too recent.');
    onAdClosed?.();
    return;
  }

  let hasCompleted = false;
  const complete = () => {
    if (hasCompleted) {
      return;
    }
    hasCompleted = true;
    onAdClosed?.();
  };

  const run = async () => {
    const isReady = await waitForLoad(
      () => isInterstitialLoaded,
      requestInterstitialLoad,
      interstitialWaiters,
    );

    if (!isReady || isInterstitialShowing) {
      logger.info('AdManager: Interstitial not ready in time, continuing without ad.');
      complete();
      return;
    }

    let closedListener = () => {};
    let errorListener = () => {};
    const cleanup = () => {
      closedListener();
      errorListener();
    };

    closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      logger.info('AdManager: Interstitial ad closed.');
      cleanup();
      complete();
    });

    errorListener = interstitial.addAdEventListener(AdEventType.ERROR, error => {
      logger.warn('AdManager: Interstitial ad failed to show', error);
      cleanup();
      isInterstitialShowing = false;
      requestInterstitialLoad();
      complete();
    });

    try {
      isInterstitialLoaded = false;
      isInterstitialShowing = true;
      lastAdShownTimestamp = Date.now();
      adsDiagnosticsService.recordShown('interstitial');
      interstitial.show();
    } catch (error) {
      logger.warn('AdManager: Interstitial show threw unexpectedly', error);
      cleanup();
      isInterstitialShowing = false;
      requestInterstitialLoad();
      complete();
    }
  };

  run();
};

const showRewardedAd = (
  onRewardEarned: () => void,
  onUnavailable?: () => void,
) => {
  initialize();

  if (isRewardedShowing) {
    logger.info('AdManager: Rewarded already showing, ignoring duplicate request.');
    onUnavailable?.();
    return;
  }

  const run = async () => {
    const isReady = await waitForLoad(
      () => isRewardedLoaded,
      requestRewardedLoad,
      rewardedWaiters,
    );

    if (!isReady || isRewardedShowing) {
      logger.info('AdManager: Rewarded ad not ready in time.');
      onUnavailable?.();
      return;
    }

    let rewardEarned = false;
    let rewardListener = () => {};
    let closedListener = () => {};
    let errorListener = () => {};
    const cleanup = () => {
      rewardListener();
      closedListener();
      errorListener();
    };

    rewardListener = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        rewardEarned = true;
        onRewardEarned();
      },
    );

    closedListener = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      cleanup();
      if (!rewardEarned) {
        logger.info('AdManager: Rewarded ad closed before reward was earned.');
      }
    });

    errorListener = rewarded.addAdEventListener(AdEventType.ERROR, error => {
      logger.warn('AdManager: Rewarded ad failed to show', error);
      cleanup();
      isRewardedShowing = false;
      requestRewardedLoad();
      onUnavailable?.();
    });

    try {
      isRewardedLoaded = false;
      isRewardedShowing = true;
      adsDiagnosticsService.recordShown('rewarded');
      rewarded.show();
    } catch (error) {
      logger.warn('AdManager: Rewarded show threw unexpectedly', error);
      cleanup();
      isRewardedShowing = false;
      requestRewardedLoad();
      onUnavailable?.();
    }
  };

  run();
};

const preloadInterstitialAd = () => {
  initialize();
  requestInterstitialLoad();
};

const preloadRewardedAd = () => {
  initialize();
  requestRewardedLoad();
};

export const adManager = {
  initialize,
  preloadInterstitialAd,
  preloadRewardedAd,
  showInterstitialAd,
  showRewardedAd,
};
