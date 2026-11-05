import React, {Suspense, useCallback, useEffect, useRef, useState} from 'react';
import {AppState, Linking, Platform, StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {I18nextProvider} from 'react-i18next';
import mobileAds from 'react-native-google-mobile-ads';
import Geocoder from 'react-native-geocoding';
import Purchases from 'react-native-purchases';
import Toast from 'react-native-toast-message';
import {
  FirebaseMessagingTypes,
  getInitialNotification,
  getMessaging,
  onNotificationOpenedApp,
} from '@react-native-firebase/messaging';
import {getApp} from '@react-native-firebase/app';

import RootNavigator from './app/navigation/RootNavigator';
import {AdProvider} from './app/context/AdContext';
import {AuthProvider, useAuthContext} from './app/context/AuthContext';
import {MapProvider} from './app/context/MapContext';
import i18n from './src/i18n';
import {adManager} from './src/services/adManager';
import {
  getCrashlytics,
  log as logCrashlytics,
  setCrashlyticsCollectionEnabled,
  setUserId as setCrashlyticsUserId,
} from '@react-native-firebase/crashlytics';
import {useAppOpenAd} from './src/hooks/useAppOpenAd';
import {
  clearFcmTokenForUser,
  ensureFcmTokenForUser,
  registerForegroundNotificationHandler,
  stopFcmTokenRefreshSync,
} from './src/services/messagingService';
import SplashFallback from './src/components/SplashFallback';
import {appOpenAdManager} from './src/services/appOpenAdManager';
import {useAdsConsent} from './src/hooks/useAdsConsent';
import {isAdsConsentRefreshRetryable} from './src/services/adsConsentService';
import logger from './src/utils/logger';
import {hasRemoveAdsEntitlement} from './src/utils/purchases';
import {adsDiagnosticsService} from './src/services/adsDiagnosticsService';
import {
  APP_CHECK_DEBUG_TOKEN,
  GOOGLE_MAPS_API_KEY,
  GOOGLE_MAPS_API_KEY_ANDROID,
  GOOGLE_MAPS_API_KEY_IOS,
  PURCHASES_API_KEY,
  PURCHASES_API_KEY_ANDROID,
  PURCHASES_API_KEY_IOS,
} from '@env';
import {initializeAppCheck, ReactNativeFirebaseAppCheckProvider} from '@react-native-firebase/app-check';

const messagingInstance = getMessaging();
const crashlyticsInstance = getCrashlytics();

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const AppContent: React.FC = () => {
  const {user, loading} = useAuthContext();
  const lastRegisteredUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (user) {
        Purchases.logIn(user.uid).catch(error => {
          logger.warn('[Purchases] logIn failed', error);
        });
      } else {
        Purchases.logOut().catch(error => {
          logger.warn('[Purchases] logOut failed', error);
        });
      }
    }
  }, [user, loading]);

  const handleNotificationNavigation = useCallback((remoteMessage: FirebaseMessagingTypes.RemoteMessage | null) => {
    if (!remoteMessage) {
      return;
    }
    const deepLink = remoteMessage.data?.link
      || (remoteMessage.data?.spotId
        ? `orbitadrone://spot/${remoteMessage.data.spotId}`
        : remoteMessage.data?.eventId
          ? `orbitadrone://event/${remoteMessage.data.eventId}`
        : remoteMessage.data?.postId
          ? `orbitadrone://feed?postId=${remoteMessage.data.postId}`
          : null);
    if (typeof deepLink === 'string' && deepLink.length > 0) {
      Linking.openURL(deepLink).catch(error => {
        logger.warn('[Messaging] Failed to open notification link', error);
      });
    }
  }, []);

  useEffect(() => {
    const unsubscribeForeground = registerForegroundNotificationHandler();
    const unsubscribeOpened = onNotificationOpenedApp(messagingInstance, remoteMessage => {
      handleNotificationNavigation(remoteMessage);
    });

    getInitialNotification(messagingInstance)
      .then(remoteMessage => {
        if (remoteMessage) {
          handleNotificationNavigation(remoteMessage);
        }
      })
      .catch(error => logger.warn('[Messaging] getInitialNotification failed', error));

    return () => {
      unsubscribeForeground();
      unsubscribeOpened();
    };
  }, [handleNotificationNavigation]);

  useEffect(() => {
    const registerToken = async () => {
      if (user) {
        if (
          lastRegisteredUserIdRef.current &&
          lastRegisteredUserIdRef.current !== user.uid
        ) {
          await clearFcmTokenForUser(lastRegisteredUserIdRef.current);
        }

        lastRegisteredUserIdRef.current = user.uid;
        await ensureFcmTokenForUser(user.uid, {promptIfNeeded: false});
      } else {
        stopFcmTokenRefreshSync();

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
      stopFcmTokenRefreshSync();
    };
  }, []);

  useEffect(() => {
    // Enable Crashlytics early and tag current user
    setCrashlyticsCollectionEnabled(crashlyticsInstance, true).catch(() => {});
    logCrashlytics(crashlyticsInstance, 'app_start');
  }, []);

  useEffect(() => {
    if (user?.uid) {
      setCrashlyticsUserId(crashlyticsInstance, user.uid).catch(() => {});
    } else {
      setCrashlyticsUserId(crashlyticsInstance, 'anonymous').catch(() => {});
    }
  }, [user?.uid]);

  if (loading) {
    return <SplashFallback />;
  }

  return <RootNavigator user={user} />;
};

const App: React.FC = () => {
  const [isAppReady, setIsAppReady] = useState(false);
  const appCheckInitAttemptedRef = useRef(false);
  const consentRefreshStartedRef = useRef(false);
  const adsSdkInitializationStartedRef = useRef(false);
  const consentRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    isLoaded: isAppOpenAdLoaded,
    isShowing: isAppOpenAdShowing,
    hasShown: hasShownAppOpenAd,
    lastError: appOpenAdError,
    showAdIfAvailable,
    loadAd: loadAppOpenAd,
  } = useAppOpenAd();
  const {
    canRequestAds,
    error: consentError,
    hasCompletedFirstSync,
    refreshConsent,
  } = useAdsConsent();

  const resolvePurchasesKey = useCallback(() => {
    if (Platform.OS === 'android') {
      return PURCHASES_API_KEY_ANDROID || PURCHASES_API_KEY;
    }
    if (Platform.OS === 'ios') {
      return PURCHASES_API_KEY_IOS || PURCHASES_API_KEY;
    }
    return PURCHASES_API_KEY;
  }, []);

  // Enable Firebase App Check on Android (Play Integrity)
  useEffect(() => {
    if (Platform.OS !== 'android' || appCheckInitAttemptedRef.current) {
      return;
    }
    appCheckInitAttemptedRef.current = true;

    const activate = async () => {
      try {
        const provider = new ReactNativeFirebaseAppCheckProvider();
        const androidAppCheckProvider = __DEV__ ? 'debug' : 'playIntegrity';
        provider.configure({
          android: {
            provider: androidAppCheckProvider,
            ...(androidAppCheckProvider === 'debug' && APP_CHECK_DEBUG_TOKEN
              ? {debugToken: APP_CHECK_DEBUG_TOKEN}
              : {}),
          },
        });
        await initializeAppCheck(getApp(), {
          provider,
          isTokenAutoRefreshEnabled: true,
        });
        logger.info('Firebase App Check (Android) activated', {
          provider: androidAppCheckProvider,
          hasDebugToken: Boolean(APP_CHECK_DEBUG_TOKEN),
        });
      } catch (error) {
        if (String((error as any)?.message ?? '').toLowerCase().includes('already')) {
          return;
        }
        logger.warn('Firebase App Check activation failed (Android):', error);
      }
    };
    activate();
  }, []);

  useEffect(() => {
    const resolveGeocodingKey = () => {
      // Prefer a dedicated cross-platform Geocoding key.
      if (GOOGLE_MAPS_API_KEY) {
        return GOOGLE_MAPS_API_KEY;
      }

      // Fallback to platform-specific keys only if no generic key is provided.
      if (Platform.OS === 'android') {
        return GOOGLE_MAPS_API_KEY_ANDROID;
      }
      if (Platform.OS === 'ios') {
        return GOOGLE_MAPS_API_KEY_IOS;
      }

      return undefined;
    };

    const mapsApiKey = resolveGeocodingKey();
    if (!mapsApiKey) {
      logger.warn(
        `[Orbitadrone] ${Platform.OS} Google Maps API key is missing. Reverse geocoding will fail.`,
      );
    } else {
      Geocoder.init(mapsApiKey);
    }

    if (__DEV__) {
      Purchases.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }

    const purchasesApiKey = resolvePurchasesKey();
    if (!purchasesApiKey) {
      logger.warn(
        `[Orbitadrone] RevenueCat API key missing for platform ${Platform.OS}. Purchases will not be configured.`,
      );
    } else {
      Purchases.configure({apiKey: purchasesApiKey});
    }
  }, [resolvePurchasesKey]);

  useEffect(() => {
    if (consentRefreshStartedRef.current) {
      return;
    }
    consentRefreshStartedRef.current = true;
    refreshConsent().catch(error => {
      logger.warn('[AdsConsent] Initial refresh failed', error);
    });
  }, [refreshConsent]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState !== 'active') {
        return;
      }
      if (canRequestAds || !consentError || !isAdsConsentRefreshRetryable(consentError)) {
        return;
      }
      refreshConsent().catch(error => {
        logger.warn('[AdsConsent] Foreground retry failed', error);
      });
    });

    return () => subscription.remove();
  }, [canRequestAds, consentError, refreshConsent]);

  useEffect(() => {
    if (!consentError || canRequestAds || !isAdsConsentRefreshRetryable(consentError)) {
      if (consentRetryTimeoutRef.current) {
        clearTimeout(consentRetryTimeoutRef.current);
        consentRetryTimeoutRef.current = null;
      }
      return;
    }

    consentRetryTimeoutRef.current = setTimeout(() => {
      consentRetryTimeoutRef.current = null;
      refreshConsent().catch(error => {
        logger.warn('[AdsConsent] Scheduled retry failed', error);
      });
    }, 15000);

    return () => {
      if (consentRetryTimeoutRef.current) {
        clearTimeout(consentRetryTimeoutRef.current);
        consentRetryTimeoutRef.current = null;
      }
    };
  }, [canRequestAds, consentError, refreshConsent]);

  useEffect(() => {
    if (!hasCompletedFirstSync || canRequestAds || isAppReady) {
      return;
    }
    logger.info('[Ads] Consent flow completed without ad eligibility. Continuing without ads.');
    setIsAppReady(true);
  }, [canRequestAds, hasCompletedFirstSync, isAppReady]);

  useEffect(() => {
    if (!canRequestAds || adsSdkInitializationStartedRef.current) {
      return;
    }

    adsSdkInitializationStartedRef.current = true;

    const initAds = async () => {
      const purchasesApiKey = resolvePurchasesKey();
      if (purchasesApiKey && typeof Purchases.getCustomerInfo === 'function') {
        try {
          const customerInfo = await Purchases.getCustomerInfo();
          if (hasRemoveAdsEntitlement(customerInfo)) {
            logger.info('[Ads] Premium entitlement detected on launch. Skipping startup ads.');
            setIsAppReady(true);
            return;
          }
        } catch (error) {
          logger.warn('[Ads] Failed to resolve startup premium status', error);
        }
      }

      await appOpenAdManager.configureRequestOptions();

      try {
        const adapterStatuses = await mobileAds().initialize();
        adsDiagnosticsService.recordSdkInitialized();
        logger.info('Mobile Ads SDK initialized', adapterStatuses);
      } catch (error) {
        adsDiagnosticsService.recordSdkInitializationFailed(error);
        logger.warn('[Ads] Failed to initialize Google Mobile Ads', error);
      }

      adManager.initialize();
      appOpenAdManager.initialize();
      loadAppOpenAd({force: true});
    };

    initAds();
  }, [canRequestAds, loadAppOpenAd, resolvePurchasesKey]);

  useEffect(() => {
    if (isAppReady) {
      return;
    }

    if (isAppOpenAdLoaded && !isAppOpenAdShowing) {
      const shown = showAdIfAvailable();
      if (!shown) {
        setIsAppReady(true);
      }
    }
  }, [
    isAppOpenAdLoaded,
    isAppOpenAdShowing,
    isAppReady,
    showAdIfAvailable,
  ]);

  useEffect(() => {
    if (!isAppReady && hasShownAppOpenAd && !isAppOpenAdShowing) {
      setIsAppReady(true);
    }
  }, [hasShownAppOpenAd, isAppOpenAdShowing, isAppReady]);

  useEffect(() => {
    if (!isAppReady && appOpenAdError) {
      setIsAppReady(true);
    }
  }, [appOpenAdError, isAppReady]);

  useEffect(() => {
    if (isAppReady) {
      return;
    }

    const timer = setTimeout(() => {
      if (!isAppReady) {
        logger.info('App Open Ad timed out. Proceeding with app.');
        setIsAppReady(true);
      }
    }, 6000);

    return () => clearTimeout(timer);
  }, [isAppReady]);

  if (!isAppReady) {
    return <SplashFallback />;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
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
    </GestureHandlerRootView>
  );
};

export default App;
