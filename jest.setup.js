// Global Jest setup to mock native dependencies that require native modules.
require('react-native-gesture-handler/jestSetup');

// Mock icon set to avoid ESM parsing issues from vector icons package.
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-vector-icons/FontAwesome', () => 'Icon');

// Mock AsyncStorage native module.
jest.mock(
  '@react-native-async-storage/async-storage',
  () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Mock Google Mobile Ads native module.
jest.mock('react-native-google-mobile-ads', () => {
  const mockInstance = {
    initialize: jest.fn().mockResolvedValue({}),
    setRequestConfiguration: jest.fn().mockResolvedValue({}),
  };
  const mobileAds = () => mockInstance;
  mobileAds.initialize = mockInstance.initialize;
    mobileAds.setRequestConfiguration = mockInstance.setRequestConfiguration;

  const createAdMock = () => ({
    load: jest.fn(),
    show: jest.fn(),
    addAdEventListener: jest.fn(() => jest.fn()),
  });

  const mockInterstitial = createAdMock();
  const mockRewarded = createAdMock();
  const mockConsentInfo = {
    status: 'NOT_REQUIRED',
    canRequestAds: true,
    privacyOptionsRequirementStatus: 'NOT_REQUIRED',
    isConsentFormAvailable: false,
  };

  return {
    __esModule: true,
    default: mobileAds,
    AdEventType: {
      LOADED: 'loaded',
      ERROR: 'error',
      CLOSED: 'closed',
    },
    RewardedAdEventType: {
      LOADED: 'loaded',
      EARNED_REWARD: 'earned_reward',
    },
    AdsConsentPrivacyOptionsRequirementStatus: {
      UNKNOWN: 'UNKNOWN',
      REQUIRED: 'REQUIRED',
      NOT_REQUIRED: 'NOT_REQUIRED',
    },
    AdsConsent: {
      requestInfoUpdate: jest.fn().mockResolvedValue(mockConsentInfo),
      loadAndShowConsentFormIfRequired: jest.fn().mockResolvedValue(mockConsentInfo),
      getConsentInfo: jest.fn().mockResolvedValue(mockConsentInfo),
      showPrivacyOptionsForm: jest.fn().mockResolvedValue(mockConsentInfo),
      reset: jest.fn(),
    },
    InterstitialAd: {
      createForAdRequest: jest.fn(() => mockInterstitial),
    },
    RewardedAd: {
      createForAdRequest: jest.fn(() => mockRewarded),
    },
    AppOpenAd: {
      createForAdRequest: jest.fn(() => createAdMock()),
    },
  };
});

// Mock Image Crop Picker (ESM/native).
jest.mock('react-native-image-crop-picker', () => ({
  __esModule: true,
  default: {
    openPicker: jest.fn().mockResolvedValue({path: '', mime: 'image/jpeg', width: 0, height: 0}),
    openCamera: jest.fn().mockResolvedValue({path: '', mime: 'image/jpeg', width: 0, height: 0}),
    clean: jest.fn().mockResolvedValue(undefined),
    cleanSingle: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock image viewing (ESM).
jest.mock('react-native-image-viewing', () => {
  const React = require('react');
  const Mock = (props) => React.createElement('ImageViewing', props, props.children);
  return {
    __esModule: true,
    default: Mock,
  };
});

// Mock Geocoder (ESM module) to avoid parse errors.
jest.mock('react-native-geocoding', () => ({
  __esModule: true,
  default: {
    init: jest.fn(),
    from: jest.fn().mockResolvedValue({}),
  },
}));

// Mock toast (ESM) to avoid module parsing issues.
jest.mock('react-native-toast-message', () => {
  const mockToast = {
    show: jest.fn(),
    hide: jest.fn(),
  };
  return {
    __esModule: true,
    default: mockToast,
  };
});

// Mock Firebase Messaging to avoid ESM/native issues.
jest.mock('@react-native-firebase/messaging', () => {
  const mockMessagingInstance = {
    onNotificationOpenedApp: jest.fn().mockReturnValue(() => {}),
    getInitialNotification: jest.fn().mockResolvedValue(null),
    onTokenRefresh: jest.fn().mockReturnValue(() => {}),
    onMessage: jest.fn().mockReturnValue(() => {}),
    setBackgroundMessageHandler: jest.fn(),
    requestPermission: jest.fn().mockResolvedValue(1),
    getToken: jest.fn().mockResolvedValue('test-token'),
    deleteToken: jest.fn().mockResolvedValue(undefined),
  };

  const messaging = () => mockMessagingInstance;
  const getMessaging = jest.fn(() => mockMessagingInstance);
  messaging.AuthorizationStatus = {
    AUTHORIZED: 1,
    DENIED: 2,
    PROVISIONAL: 3,
  };

  return {
    __esModule: true,
    default: messaging,
    getMessaging,
    onNotificationOpenedApp: jest.fn((_instance, listener) =>
      mockMessagingInstance.onNotificationOpenedApp(listener),
    ),
    getInitialNotification: jest.fn(() =>
      mockMessagingInstance.getInitialNotification(),
    ),
    onTokenRefresh: jest.fn((_instance, listener) =>
      mockMessagingInstance.onTokenRefresh(listener),
    ),
    onMessage: jest.fn((_instance, listener) =>
      mockMessagingInstance.onMessage(listener),
    ),
    setBackgroundMessageHandler: jest.fn((_instance, handler) =>
      mockMessagingInstance.setBackgroundMessageHandler(handler),
    ),
    requestPermission: jest.fn(() =>
      mockMessagingInstance.requestPermission(),
    ),
    getToken: jest.fn(() =>
      mockMessagingInstance.getToken(),
    ),
    deleteToken: jest.fn(() =>
      mockMessagingInstance.deleteToken(),
    ),
    AuthorizationStatus: messaging.AuthorizationStatus,
    FirebaseMessagingTypes: {},
  };
});

// Mock react-native-maps to avoid JSX in node_modules.
jest.mock('react-native-maps', () => {
  const React = require('react');
  const MockMapView = (props) => React.createElement('MapView', props, props.children);
  const MockMarker = (props) => React.createElement('Marker', props, props.children);
  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    PROVIDER_GOOGLE: 'google',
    MapView: MockMapView,
  };
});

// Mock ratings component (ESM).
jest.mock('react-native-ratings', () => {
  const React = require('react');
  const MockRating = (props) => React.createElement('Rating', props, props.children);
  return {
    __esModule: true,
    Rating: MockRating,
    AirbnbRating: MockRating,
  };
});

// Mock Firestore (ESM/native).
jest.mock('@react-native-firebase/firestore', () => {
  const noop = (..._args) => {};
  const mockGetDoc = jest.fn().mockResolvedValue({exists: false, data: () => ({})});
  const mockGetDocs = jest.fn().mockResolvedValue({docs: []});
  const GeoPoint = function(latitude, longitude) {
    this.latitude = latitude;
    this.longitude = longitude;
  };

  return {
    __esModule: true,
    default: () => ({}),
    getFirestore: jest.fn(() => ({})),
    collection: jest.fn(() => ({})),
    doc: jest.fn(() => ({})),
    getDoc: mockGetDoc,
    getDocs: mockGetDocs,
    query: jest.fn(() => ({})),
    where: jest.fn(() => ({})),
    orderBy: jest.fn(() => ({})),
    runTransaction: jest.fn((_db, fn) => fn()),
    addDoc: jest.fn(noop),
    updateDoc: jest.fn(noop),
    deleteDoc: jest.fn(noop),
    setDoc: jest.fn(noop),
    serverTimestamp: jest.fn(() => new Date()),
    GeoPoint,
    FirebaseFirestoreTypes: {},
  };
});

// Mock Firebase Auth.
jest.mock('@react-native-firebase/auth', () => {
  const authInstance = {currentUser: null};
  const getAuth = jest.fn(() => authInstance);
  const onAuthStateChanged = jest.fn((_auth, callback) => {
    // Immediately emit a null user to resolve loading state in tests.
    callback?.(null);
    return jest.fn();
  });
  return {
    __esModule: true,
    default: getAuth,
    getAuth,
    onAuthStateChanged,
  };
});

// Mock Firebase Storage.
jest.mock('@react-native-firebase/storage', () => {
  const mockStorage = {};
  const getStorage = jest.fn(() => mockStorage);
  return {
    __esModule: true,
    default: getStorage,
    getStorage,
  };
});

// Mock Firebase Crashlytics.
jest.mock('@react-native-firebase/crashlytics', () => {
  const crashlyticsInstance = {
    log: jest.fn(),
    recordError: jest.fn(),
    setUserId: jest.fn().mockResolvedValue(null),
    setAttributes: jest.fn().mockResolvedValue(null),
    setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(null),
  };
  return {
    __esModule: true,
    default: () => crashlyticsInstance,
    getCrashlytics: jest.fn(() => crashlyticsInstance),
    log: jest.fn((_instance, message) => crashlyticsInstance.log(message)),
    setUserId: jest.fn((_instance, userId) => crashlyticsInstance.setUserId(userId)),
    setCrashlyticsCollectionEnabled: jest.fn((_instance, enabled) =>
      crashlyticsInstance.setCrashlyticsCollectionEnabled(enabled),
    ),
  };
});

// Mock Firebase App module helpers.
jest.mock('@react-native-firebase/app', () => {
  const app = {name: '[DEFAULT]'};
  return {
    __esModule: true,
    getApp: jest.fn(() => app),
  };
});

// Mock Geolocation to avoid native module lookup.
jest.mock('@react-native-community/geolocation', () => ({
  __esModule: true,
  default: {
    requestAuthorization: jest.fn(),
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(),
    clearWatch: jest.fn(),
    stopObserving: jest.fn(),
  },
}));

// Short-circuit permission helpers to avoid async side effects in tests.
jest.mock('./src/utils/permissions', () => ({
  __esModule: true,
  requestEssentialPermissions: jest.fn().mockResolvedValue(undefined),
  requestLocationPermission: jest.fn().mockResolvedValue(true),
}));

// Stub App Open Ad manager to avoid async side-effects in tests.
jest.mock('./src/services/appOpenAdManager', () => {
  const defaultState = {
    isLoaded: false,
    isLoading: false,
    isShowing: false,
    hasAttemptedToShow: false,
    hasShown: false,
    lastError: null,
  };

  return {
    __esModule: true,
    appOpenAdManager: {
      configureRequestOptions: jest.fn().mockResolvedValue(undefined),
      initialize: jest.fn(),
      loadAd: jest.fn(),
      showAdIfAvailable: jest.fn(() => false),
      subscribe: jest.fn((listener) => {
        // useSyncExternalStore expects subscribe to return an unsubscribe.
        if (listener && typeof listener === 'function') {
          listener();
        }
        return () => {};
      }),
      getState: jest.fn(() => defaultState),
    },
  };
});

// Mock Firebase App Check (ESM/native).
jest.mock('@react-native-firebase/app-check', () => {
  class ReactNativeFirebaseAppCheckProvider {
    configure() {}
  }

  return {
    __esModule: true,
    default: () => ({
      activate: jest.fn().mockResolvedValue(undefined),
    }),
    initializeAppCheck: jest.fn().mockResolvedValue({}),
    ReactNativeFirebaseAppCheckProvider,
  };
});

// Mock react-native-fs to avoid Flow syntax parse errors in tests.
jest.mock('react-native-fs', () => {
  const mockRead = jest.fn().mockResolvedValue('{}');
  return {
    __esModule: true,
    default: {
      readFile: mockRead,
      readFileAssets: mockRead,
    },
  };
});

// Mock image picker (ESM/native).
jest.mock('react-native-image-picker', () => {
  const mockResponse = {assets: []};
  return {
    __esModule: true,
    launchImageLibrary: jest.fn((_options, cb) => cb?.(mockResponse)),
    launchCamera: jest.fn((_options, cb) => cb?.(mockResponse)),
  };
});

// Mock compressor (native).
jest.mock('react-native-compressor', () => {
  const Video = {
    compress: jest.fn(async (uri) => uri),
  };
  return {__esModule: true, Video};
});

// Mock react-native-dialog (ESM).
jest.mock('react-native-dialog', () => {
  const React = require('react');
  const Dialog = (props) => React.createElement('Dialog', props, props.children);
  Dialog.Container = (props) => React.createElement('DialogContainer', props, props.children);
  Dialog.Title = (props) => React.createElement('DialogTitle', props, props.children);
  Dialog.Description = (props) => React.createElement('DialogDescription', props, props.children);
  Dialog.Button = (props) => React.createElement('DialogButton', props, props.children);
  return {__esModule: true, default: Dialog, ...Dialog};
});
