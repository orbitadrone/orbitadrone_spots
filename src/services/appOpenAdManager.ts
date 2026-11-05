import mobileAds, {AdEventType, AppOpenAd} from 'react-native-google-mobile-ads';

import {appOpenAdUnitId} from '../constants/adUnits';
import {adsDiagnosticsService} from './adsDiagnosticsService';
import logger from '../utils/logger';

const MIN_REQUEST_INTERVAL_MS = 15_000; // Prevents request spam
const BASE_RETRY_DELAY_MS = 10_000;
const MAX_RETRY_DELAY_MS = 60_000;
const TEST_DEVICE_IDS = ['EMULATOR', '75B9C99EB105B03B59838C2ABE87FF14'];

export type AppOpenAdState = {
  isLoaded: boolean;
  isLoading: boolean;
  isShowing: boolean;
  hasAttemptedToShow: boolean;
  hasShown: boolean;
  lastError: Error | null;
};

class AppOpenAdManager {
  private ad = AppOpenAd.createForAdRequest(appOpenAdUnitId);
  private listeners = new Set<(state: AppOpenAdState) => void>();
  private state: AppOpenAdState = {
    isLoaded: false,
    isLoading: false,
    isShowing: false,
    hasAttemptedToShow: false,
    hasShown: false,
    lastError: null,
  };
  private lastRequestTime = 0;
  private retryDelayMs = BASE_RETRY_DELAY_MS;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  getState = () => this.state;

  subscribe = (listener: (state: AppOpenAdState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(updates: Partial<AppOpenAdState>) {
    this.state = {...this.state, ...updates};
    this.listeners.forEach(listener => listener(this.state));
  }

  async configureRequestOptions() {
    if (!__DEV__) {
      return;
    }

    try {
      await mobileAds().setRequestConfiguration({
        testDeviceIdentifiers: TEST_DEVICE_IDS,
      });
      logger.info(
        '[AppOpenAd] Using AdMob test device IDs in development environment.',
      );
    } catch (error) {
      logger.warn('[AppOpenAd] Failed to set test device IDs', error);
    }
  }

  initialize() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    this.ad.addAdEventListener(AdEventType.LOADED, () => {
      this.clearRetryTimeout();
      this.retryDelayMs = BASE_RETRY_DELAY_MS;
      adsDiagnosticsService.recordLoaded('appOpen');
      this.setState({
        isLoaded: true,
        isLoading: false,
        lastError: null,
      });
    });

    this.ad.addAdEventListener(AdEventType.CLOSED, () => {
      this.setState({
        isShowing: false,
        hasShown: this.state.hasShown || this.state.hasAttemptedToShow,
      });
      // Reload after a delay so we do not hammer the network.
      this.scheduleLoadAfterDelay(MIN_REQUEST_INTERVAL_MS);
    });

    this.ad.addAdEventListener(AdEventType.ERROR, error => {
      logger.warn('[AppOpenAd] Failed to load', error);
      adsDiagnosticsService.recordFailed('appOpen', error);
      this.setState({
        isLoaded: false,
        isLoading: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      this.scheduleRetry();
    });
  }

  private clearRetryTimeout() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  private scheduleRetry() {
    this.clearRetryTimeout();
    const delay = this.retryDelayMs;
    this.retryTimeout = setTimeout(() => {
      this.loadAd();
    }, delay);
    this.retryDelayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      this.retryDelayMs + BASE_RETRY_DELAY_MS,
    );
    logger.info(`[AppOpenAd] Scheduling retry in ${delay}ms`);
  }

  private scheduleLoadAfterDelay(delay: number) {
    this.clearRetryTimeout();
    this.retryTimeout = setTimeout(() => this.loadAd(), delay);
  }

  loadAd(options?: {force?: boolean}) {
    const now = Date.now();
    if (!options?.force && now - this.lastRequestTime < MIN_REQUEST_INTERVAL_MS) {
      logger.info(
        `[AppOpenAd] Skipping load; last request was ${
          now - this.lastRequestTime
        }ms ago.`,
      );
      return;
    }

    this.lastRequestTime = now;
    adsDiagnosticsService.recordLoadRequested('appOpen');
    this.setState({
      isLoading: true,
      isLoaded: false,
      lastError: null,
    });

    try {
      this.ad.load();
    } catch (error) {
      logger.warn('[AppOpenAd] Unexpected load error', error);
      this.setState({
        isLoading: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      this.scheduleRetry();
    }
  }

  showAdIfAvailable() {
    if (this.state.isShowing) {
      logger.info('[AppOpenAd] Ad is already showing.');
      return false;
    }

    if (!this.state.isLoaded) {
      logger.info('[AppOpenAd] No loaded App Open Ad available, skipping show.');
      return false;
    }

    try {
      this.setState({
        isShowing: true,
        isLoaded: false,
        hasAttemptedToShow: true,
      });
      adsDiagnosticsService.recordShown('appOpen');
      this.ad.show();
      return true;
    } catch (error) {
      logger.warn('[AppOpenAd] Failed to show', error);
      this.setState({
        isShowing: false,
        lastError: error instanceof Error ? error : new Error(String(error)),
      });
      this.scheduleRetry();
      return false;
    }
  }
}

export const appOpenAdManager = new AppOpenAdManager();
