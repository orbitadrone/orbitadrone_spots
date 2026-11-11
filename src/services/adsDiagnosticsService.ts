type AdPlacementKey = 'feedBanner' | 'interstitial' | 'rewarded' | 'appOpen';

type AdPlacementDiagnostics = {
  requestCount: number;
  loadedCount: number;
  shownCount: number;
  failedCount: number;
  lastEventAt: number | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type AdsDiagnosticsState = {
  consent: {
    canRequestAds: boolean;
    hasCompletedFirstSync: boolean;
    isGatheringConsent: boolean;
    privacyOptionsRequirementStatus: string;
    status: string;
    errorMessage: string | null;
    updatedAt: number | null;
  };
  sdk: {
    initialized: boolean;
    initErrorMessage: string | null;
    updatedAt: number | null;
  };
  placements: Record<AdPlacementKey, AdPlacementDiagnostics>;
};

const createPlacementState = (): AdPlacementDiagnostics => ({
  requestCount: 0,
  loadedCount: 0,
  shownCount: 0,
  failedCount: 0,
  lastEventAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
});

const defaultState: AdsDiagnosticsState = {
  consent: {
    canRequestAds: false,
    hasCompletedFirstSync: false,
    isGatheringConsent: false,
    privacyOptionsRequirementStatus: 'UNKNOWN',
    status: 'UNKNOWN',
    errorMessage: null,
    updatedAt: null,
  },
  sdk: {
    initialized: false,
    initErrorMessage: null,
    updatedAt: null,
  },
  placements: {
    feedBanner: createPlacementState(),
    interstitial: createPlacementState(),
    rewarded: createPlacementState(),
    appOpen: createPlacementState(),
  },
};

const normalizeError = (error: unknown) => {
  if (error instanceof Error) {
    return {
      code:
        typeof (error as Error & {code?: unknown}).code === 'string'
          ? (error as Error & {code: string}).code
          : null,
      message: error.message || error.name || 'Unknown ad error',
    };
  }

  if (error && typeof error === 'object') {
    const candidate = error as {code?: unknown; message?: unknown};
    return {
      code: typeof candidate.code === 'string' ? candidate.code : null,
      message:
        typeof candidate.message === 'string' && candidate.message.trim()
          ? candidate.message
          : 'Unknown ad error',
    };
  }

  if (typeof error === 'string' && error.trim()) {
    return {
      code: null,
      message: error.trim(),
    };
  }

  return {
    code: null,
    message: 'Unknown ad error',
  };
};

class AdsDiagnosticsService {
  private state: AdsDiagnosticsState = defaultState;
  private listeners = new Set<(state: AdsDiagnosticsState) => void>();

  getState = () => this.state;

  subscribe = (listener: (state: AdsDiagnosticsState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(next: Partial<AdsDiagnosticsState>) {
    this.state = {
      ...this.state,
      ...next,
    };
    this.listeners.forEach(listener => listener(this.state));
  }

  private updatePlacementState(
    placement: AdPlacementKey,
    updater: (current: AdPlacementDiagnostics) => AdPlacementDiagnostics,
  ) {
    this.setState({
      placements: {
        ...this.state.placements,
        [placement]: updater(this.state.placements[placement]),
      },
    });
  }

  recordConsentState(input: {
    canRequestAds: boolean;
    hasCompletedFirstSync: boolean;
    isGatheringConsent: boolean;
    privacyOptionsRequirementStatus: string;
    status: string;
    error: Error | null;
  }) {
    this.setState({
      consent: {
        canRequestAds: input.canRequestAds,
        hasCompletedFirstSync: input.hasCompletedFirstSync,
        isGatheringConsent: input.isGatheringConsent,
        privacyOptionsRequirementStatus: input.privacyOptionsRequirementStatus,
        status: input.status,
        errorMessage: input.error?.message ?? null,
        updatedAt: Date.now(),
      },
    });
  }

  recordSdkInitialized() {
    this.setState({
      sdk: {
        initialized: true,
        initErrorMessage: null,
        updatedAt: Date.now(),
      },
    });
  }

  recordSdkInitializationFailed(error: unknown) {
    const details = normalizeError(error);
    this.setState({
      sdk: {
        initialized: false,
        initErrorMessage: details.message,
        updatedAt: Date.now(),
      },
    });
  }

  recordLoadRequested(placement: AdPlacementKey) {
    this.updatePlacementState(placement, current => ({
      ...current,
      requestCount: current.requestCount + 1,
      lastEventAt: Date.now(),
    }));
  }

  recordLoaded(placement: AdPlacementKey) {
    this.updatePlacementState(placement, current => ({
      ...current,
      loadedCount: current.loadedCount + 1,
      lastEventAt: Date.now(),
      lastErrorCode: null,
      lastErrorMessage: null,
    }));
  }

  recordShown(placement: AdPlacementKey) {
    this.updatePlacementState(placement, current => ({
      ...current,
      shownCount: current.shownCount + 1,
      lastEventAt: Date.now(),
    }));
  }

  recordFailed(placement: AdPlacementKey, error: unknown) {
    const details = normalizeError(error);
    this.updatePlacementState(placement, current => ({
      ...current,
      failedCount: current.failedCount + 1,
      lastEventAt: Date.now(),
      lastErrorCode: details.code,
      lastErrorMessage: details.message,
    }));
  }
}

export const adsDiagnosticsService = new AdsDiagnosticsService();
