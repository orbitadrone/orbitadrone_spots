import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {Linking, Platform} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {I18nextProvider} from 'react-i18next';
import mobileAds, {AppOpenAd, AdEventType} from 'react-native-google-mobile-ads';
import Geocoder from 'react-native-geocoding';
import Purchases from 'react-native-purchases';
import Toast from 'react-native-toast-message';
import messaging, {FirebaseMessagingTypes} from '@react-native-firebase/messaging';

import RootNavigator from './app/navigation/RootNavigator';
import {AdProvider} from './app/context/AdContext';
import {AuthProvider, useAuthContext} from './app/context/AuthContext';
import {MapProvider} from './app/context/MapContext';
import {appOpenAdUnitId} from './src/constants/adUnits';
import i18n from './src/i18n';
import {adManager} from './src/services/adManager';
import {requestEssentialPermissions} from './src/utils/permissions';
import {
  clearFcmTokenForUser,
  ensureFcmTokenForUser,
  registerForegroundNotificationHandler,
} from './src/services/messagingService';
import SplashFallback from './src/components/SplashFallback';
import {
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_API_KEY_ANDROID,
  GOOGLE_MAPS_API_KEY_IOS,
  PURCHASES_API_KEY,
  PURCHASES_API_KEY_ANDROID,
  PURCHASES_API_KEY_IOS,
} from '@env';
import appCheck from '@react-native-firebase/app-check';

const appOpenAd = AppOpenAd.createForAdRequest(appOpenAdUnitId);
let hasShownAppOpenAd = false;
let isAppOpenAdLoaded = false;

const AppContent: React.FC = () => {
  const {user, loading} = useAuthContext();
  const tokenRefreshUnsubscribeRef = useRef<(() => void) | null>(null);
  const lastRegisteredUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (user) {
        Purchases.logIn(user.uid);
      } else {
        Purchases.logOut();
      }
    }
  }, [user, loading]);

  const handleNotificationNavigation = useCallback((remoteMessage: FirebaseMessagingTypes.RemoteMessage | null) => {
    if (!remoteMessage) {
      return;
    }
    const deepLink = remoteMessage.data?.link
      || (remoteMessage.data?.spotId ? `orbitadrone://spot/${remoteMessage.data.spotId}` : null);
    if (deepLink) {
      Linking.openURL(deepLink).catch(error => {
        console.warn('[Messaging] Failed to open notification link', error);
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribeForeground = registerForegroundNotificationHandler();
    const unsubscribeOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      handleNotificationNavigation(remoteMessage);
    });

    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        if (remoteMessage) {
          handleNotificationNavigation(remoteMessage);
        }
      })
      .catch(error => console.warn('[Messaging] getInitialNotification failed', error));

    return () => {
      unsubscribeForeground();
      unsubscribeOpened();
    };
  }, [handleNotificationNavigation]);

  useEffect(() => {
    const registerToken = async () => {
      if (user) {
        const result = await ensureFcmTokenForUser(user.uid);
        lastRegisteredUserIdRef.current = user.uid;
        if (result?.unsubscribeTokenRefresh) {
          tokenRefreshUnsubscribeRef.current?.();
          tokenRefreshUnsubscribeRef.current = result.unsubscribeTokenRefresh;
        }
      } else {
        tokenRefreshUnsubscribeRef.current?.();
        tokenRefreshUnsubscribeRef.current = null;

        if (lastRegisteredUserIdRef.current) {
          await clearFcmTokenForUser(lastRegisteredUserIdRef.current);
          lastRegisteredUserIdRef.current = null;
        }
      }
    };

    // Evitar ejecutar mientras la autenticación aún está cargando
    if (!loading) {
      registerToken();
    }
  }, [user, loading]);

  useEffect(() => {
    return () => {
      tokenRefreshUnsubscribeRef.current?.();
      tokenRefreshUnsubscribeRef.current = null;
    };
  }, []);

  if (loading) {
    return <SplashFallback />;
  }

  return <RootNavigator user={user} />;
};

const App: React.FC = () => {
  const [isAppReady, setIsAppReady] = useState(false);

  // Request runtime permissions on first mount
  useEffect(() => {
    requestEssentialPermissions();
  }, []);

  // Enable Firebase App Check on Android (Play Integrity)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const activate = async () => {
      try {
        await appCheck().activate('playIntegrity');
        console.log('Firebase App Check (Android) activated');
      } catch (error) {
        console.warn('Firebase App Check activation failed (Android):', error);
      }
    };
    activate();
  }, []);

  useEffect(() => {
    const resolveMapsKey = () => {
      if (Platform.OS === 'android') {
        return GOOGLE_MAPS_API_KEY_ANDROID || GOOGLE_MAPS_API_KEY;
      }
      if (Platform.OS === 'ios') {
        return GOOGLE_MAPS_API_KEY_IOS || GOOGLE_MAPS_API_KEY;
      }
      return GOOGLE_MAPS_API_KEY;
    };

    const mapsApiKey = resolveMapsKey();
    if (!mapsApiKey) {
      console.warn(
        `[Orbitadrone] ${Platform.OS} Google Maps API key is missing. Reverse geocoding will fail.`,
      );
    } else {
      Geocoder.init(mapsApiKey);
    }

    Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    const resolvePurchasesKey = () => {
      if (Platform.OS === 'android') {
        return PURCHASES_API_KEY_ANDROID || PURCHASES_API_KEY;
      }
      if (Platform.OS === 'ios') {
        return PURCHASES_API_KEY_IOS || PURCHASES_API_KEY;
      }
      return PURCHASES_API_KEY;
    };

    const purchasesApiKey = resolvePurchasesKey();
    if (!purchasesApiKey) {
      console.warn(
        `[Orbitadrone] RevenueCat API key missing for platform ${Platform.OS}. Purchases will not be configured.`,
      );
    } else {
      Purchases.configure({apiKey: purchasesApiKey});
    }

    mobileAds()
      .initialize()
      .then(adapterStatuses => {
        console.log('Mobile Ads SDK initialized!', adapterStatuses);
        adManager.initialize();
        hasShownAppOpenAd = false;
        isAppOpenAdLoaded = false;
        appOpenAd.load();
      });

    const handleAppReady = () => {
      if (!isAppReady) {
        setIsAppReady(true);
      }
    };

    const unsubscribeLoaded = appOpenAd.addAdEventListener(
      AdEventType.LOADED,
      () => {
        console.log('App Open Ad loaded');
        isAppOpenAdLoaded = true;
        if (isAppReady && !hasShownAppOpenAd) {
          try {
            appOpenAd.show();
            hasShownAppOpenAd = true;
            isAppOpenAdLoaded = false;
          } catch (error) {
            console.warn('App Open Ad show failed on load', error);
          }
        }
      },
    );

    const unsubscribeClosed = appOpenAd.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        console.log('App Open Ad closed');
        hasShownAppOpenAd = true;
        isAppOpenAdLoaded = false;
        handleAppReady();
      },
    );

    const unsubscribeError = appOpenAd.addAdEventListener(
      AdEventType.ERROR,
      error => {
        console.warn('App Open Ad failed to load, proceeding with app.', error);
        isAppOpenAdLoaded = false;
        handleAppReady();
        appOpenAd.load();
      },
    );

    const timer = setTimeout(() => {
      console.log('App Open Ad timed out. Proceeding with app.');
      handleAppReady();
    }, 5000);

    return () => {
      unsubscribeLoaded();
      unsubscribeClosed();
      unsubscribeError();
      clearTimeout(timer);
    };
  }, [isAppReady]);

  useEffect(() => {
    if (isAppReady && isAppOpenAdLoaded && !hasShownAppOpenAd) {
      try {
        appOpenAd.show();
        hasShownAppOpenAd = true;
        isAppOpenAdLoaded = false;
      } catch (error) {
        console.warn('App Open Ad show failed', error);
      }
    }
  }, [isAppReady]);

  if (!isAppReady) {
    return <SplashFallback />;
  }

  return (
    <SafeAreaProvider>
      <Suspense fallback={<SplashFallback />}>
        <I18nextProvider i18n={i18n}>
          <AuthProvider>
            <AdProvider>
              <MapProvider>
                <AppContent />
                <Toast />
              </MapProvider>
            </AdProvider>
          </AuthProvider>
        </I18nextProvider>
      </Suspense>
    </SafeAreaProvider>
  );
};

export default App;
