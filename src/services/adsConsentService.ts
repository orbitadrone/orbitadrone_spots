import {
  AdsConsent,
  AdsConsentInfo,
  AdsConsentPrivacyOptionsRequirementStatus,
} from 'react-native-google-mobile-ads';

import {adsDiagnosticsService} from './adsDiagnosticsService';
import logger from '../utils/logger';

export type AdsConsentState = {
  canRequestAds: boolean;
  isConsentFormAvailable: boolean;
  isGatheringConsent: boolean;
  privacyOptionsRequirementStatus: string;
  status: string;
  error: Error | null;
  hasCompletedFirstSync: boolean;
};

const defaultState: AdsConsentState = {
  canRequestAds: false,
  isConsentFormAvailable: false,
  isGatheringConsent: false,
  privacyOptionsRequirementStatus: AdsConsentPrivacyOptionsRequirementStatus.UNKNOWN,
  status: 'UNKNOWN',
  error: null,
  hasCompletedFirstSync: false,
};

const getAdsConsentErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message || error.name || '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && typeof (error as {message?: unknown}).message === 'string') {
    return (error as {message: string}).message;
  }
  return '';
};

export const isAdsConsentPublisherMisconfigurationError = (error: unknown) => {
  const message = getAdsConsentErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }

  return (
    message.includes('publisher misconfiguration')
    || message.includes('failed to read publisher\'s account configuration')
    || message.includes('no form(s) configured for the input app id')
  );
};

export const isAdsConsentRefreshRetryable = (error: unknown) =>
  !isAdsConsentPublisherMisconfigurationError(error);

class AdsConsentService {
  private state: AdsConsentState = defaultState;
  private listeners = new Set<(state: AdsConsentState) => void>();
  private inflightSync: Promise<AdsConsentState> | null = null;

  getState = () => this.state;

  subscribe = (listener: (state: AdsConsentState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(next: Partial<AdsConsentState>) {
    this.state = {...this.state, ...next};
    adsDiagnosticsService.recordConsentState({
      canRequestAds: this.state.canRequestAds,
      hasCompletedFirstSync: this.state.hasCompletedFirstSync,
      isGatheringConsent: this.state.isGatheringConsent,
      privacyOptionsRequirementStatus: this.state.privacyOptionsRequirementStatus,
      status: this.state.status,
      error: this.state.error,
    });
    this.listeners.forEach(listener => listener(this.state));
  }

  private mapInfo(info: AdsConsentInfo): Partial<AdsConsentState> {
    return {
      canRequestAds: info.canRequestAds === true,
      isConsentFormAvailable: info.isConsentFormAvailable === true,
      privacyOptionsRequirementStatus: info.privacyOptionsRequirementStatus,
      status: info.status,
    };
  }

  private async getFallbackConsentInfo() {
    try {
      return await AdsConsent.getConsentInfo();
    } catch (fallbackError) {
      logger.warn('[AdsConsent] Failed to read fallback consent info', fallbackError);
      return null;
    }
  }

  refresh = async () => {
    if (this.inflightSync) {
      return this.inflightSync;
    }

    this.setState({
      isGatheringConsent: true,
      error: null,
    });

    this.inflightSync = (async () => {
      try {
        const cachedInfo = await this.getFallbackConsentInfo();
        if (cachedInfo) {
          this.setState(this.mapInfo(cachedInfo));
        }

        const infoAfterUpdate = await AdsConsent.requestInfoUpdate();
        this.setState(this.mapInfo(infoAfterUpdate));

        const infoAfterForm = await AdsConsent.loadAndShowConsentFormIfRequired();
        const latestInfo = await this.getFallbackConsentInfo();
        const finalInfo = latestInfo ?? infoAfterForm ?? infoAfterUpdate;

        this.setState({
          ...this.mapInfo(finalInfo),
          isGatheringConsent: false,
          error: null,
          hasCompletedFirstSync: true,
        });
        return this.state;
      } catch (error) {
        const normalizedError =
          error instanceof Error ? error : new Error(String(error));

        if (isAdsConsentPublisherMisconfigurationError(normalizedError)) {
          logger.info(
            '[AdsConsent] Privacy form is not configured for this AdMob app ID. Skipping automatic retries until configuration is fixed.',
          );
        } else {
          logger.warn('[AdsConsent] Consent refresh failed', normalizedError);
        }

        const latestInfo = await this.getFallbackConsentInfo();
        this.setState({
          ...(latestInfo ? this.mapInfo(latestInfo) : {}),
          isGatheringConsent: false,
          error: normalizedError,
          hasCompletedFirstSync: true,
        });
        return this.state;
      } finally {
        this.inflightSync = null;
      }
    })();

    return this.inflightSync;
  };

  openPrivacyOptions = async () => {
    try {
      this.setState({
        isGatheringConsent: true,
        error: null,
      });

      const infoAfterForm = await AdsConsent.showPrivacyOptionsForm();
      const latestInfo = await this.getFallbackConsentInfo();
      const finalInfo = latestInfo ?? infoAfterForm;

      this.setState({
        ...this.mapInfo(finalInfo),
        isGatheringConsent: false,
        error: null,
        hasCompletedFirstSync: true,
      });
      return this.state;
    } catch (error) {
      logger.warn('[AdsConsent] Failed to open privacy options form', error);
      const latestInfo = await this.getFallbackConsentInfo();
      this.setState({
        ...(latestInfo ? this.mapInfo(latestInfo) : {}),
        isGatheringConsent: false,
        error: error instanceof Error ? error : new Error(String(error)),
        hasCompletedFirstSync: true,
      });
      throw error;
    }
  };
}

export const adsConsentService = new AdsConsentService();
