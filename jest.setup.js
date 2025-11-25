// Global Jest setup to mock native dependencies that require native modules.
require('react-native-gesture-handler/jestSetup');

// Mock icon set to avoid ESM parsing issues from vector icons package.
jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'Icon');
jest.mock('react-native-vector-icons/FontAwesome', () => 'Icon');

// Mock Google Mobile Ads native module.
jest.mock('react-native-google-mobile-ads', () => {
  const mockInstance = {
    initialize: jest.fn().mockResolvedValue({}),
  };
  const mobileAds = () => mockInstance;
  mobileAds.initialize = mockInstance.initialize;

  const createAdMock = () => ({
    load: jest.fn(),
    show: jest.fn(),
    addAdEventListener: jest.fn(() => jest.fn()),
  });

  const mockInterstitial = createAdMock();
  const mockRewarded = createAdMock();

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
    InterstitialAd: {
      createForAdRequest: jest.fn(() => mockInterstitial),
    },
    RewardedAd: {
      createForAdRequest: jest.fn(() => mockRewarded),
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

// Mock RevenueCat purchases to avoid loading hybrid mappings (ESM) and native deps.
jest.mock('react-native-purchases', () => {
  const mockEntitlements = {active: {}};
  const defaultMock = {
    configure: jest.fn(),
    setLogLevel: jest.fn(),
    logIn: jest.fn(),
    logOut: jest.fn(),
    getOfferings: jest.fn().mockResolvedValue({current: {availablePackages: []}}),
    purchasePackage: jest.fn().mockResolvedValue({customerInfo: {entitlements: mockEntitlements}}),
    restorePurchases: jest.fn().mockResolvedValue({entitlements: mockEntitlements}),
  };
  return {
    __esModule: true,
    default: defaultMock,
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
  };

  const messaging = () => mockMessagingInstance;
  messaging.AuthorizationStatus = {
    AUTHORIZED: 1,
    DENIED: 2,
  };

  return {
    __esModule: true,
    default: messaging,
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
  const mockTransaction = jest.fn();
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
  return {
    __esModule: true,
    default: getAuth,
    getAuth,
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
