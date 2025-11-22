import {
  InterstitialAd,
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
} from 'react-native-google-mobile-ads';
import { interstitialAdUnitId, rewardedAdUnitId } from '../constants/adUnits';

// --- Configuración ---
const MIN_TIME_BETWEEN_ADS = 120000; // 2 minutos

let lastAdShownTimestamp = 0;

// --- Instancias de Anuncios ---
const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId);
const rewarded = RewardedAd.createForAdRequest(rewardedAdUnitId);

let isInitialized = false;
let isInterstitialLoaded = false;
let isRewardedLoaded = false;

/**
 * Inicializa el gestor de anuncios. Carga los primeros anuncios.
 * Debe llamarse una sola vez al iniciar la aplicación.
 */
const initialize = () => {
  if (isInitialized) {
    return;
  }

  // Listeners para Interstitial
  interstitial.addAdEventListener(AdEventType.LOADED, () => {
    console.log('AdManager: Interstitial Ad loaded and ready.');
    isInterstitialLoaded = true;
  });
  interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
    console.warn('AdManager: Interstitial Ad failed to load', error);
    isInterstitialLoaded = false;
  });

  // Listeners para Rewarded
  rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
    console.log('AdManager: Rewarded Ad loaded and ready.');
    isRewardedLoaded = true;
  });
  rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
    console.log(
      'AdManager: User earned reward of ',
      reward.amount,
      reward.type,
    );
  });
  rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
    console.warn('AdManager: Rewarded Ad failed to load', error);
    isRewardedLoaded = false;
  });

  // Empezar a precargar los anuncios
  interstitial.load();
  rewarded.load();
  isInitialized = true;
};

/**
 * Muestra un anuncio intersticial si está cargado y ha pasado el tiempo mínimo.
 * @param onAdClosed - Callback opcional que se ejecuta después de que el anuncio se cierra.
 * @param areAdsDisabled - Booleano que indica si los anuncios están deshabilitados.
 */
const showInterstitialAd = (
  onAdClosed?: () => void,
  areAdsDisabled?: boolean,
) => {
  if (areAdsDisabled) {
    console.log('AdManager: Ads are disabled, skipping interstitial.');
    onAdClosed?.();
    return;
  }

  const now = Date.now();
  if (now - lastAdShownTimestamp < MIN_TIME_BETWEEN_ADS) {
    console.log('AdManager: Interstitial ad not shown, too recent.');
    onAdClosed?.();
    return;
  }

  // Asegurarnos de que siempre llamamos al callback,
  // incluso si el anuncio falla al cargar o mostrar.
  let hasCompleted = false;
  const complete = () => {
    if (hasCompleted) {
      return;
    }
    hasCompleted = true;
    onAdClosed?.();
  };

  // Listener de un solo uso para cuando el anuncio se haya cerrado
  const closedListener = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
    console.log('AdManager: Interstitial ad closed.');
    complete();
    closedListener(); // Limpiar el listener
    errorListener(); // Limpiar el listener de error asociado a esta llamada
  });

  // Listener de un solo uso para cuando el anuncio falle
  const errorListener = interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
    console.warn('AdManager: Interstitial ad failed to show', error);
    complete();
    closedListener(); // Limpiar el listener de cerrado asociado a esta llamada
    errorListener(); // Limpiar este listener
  });

  if (isInterstitialLoaded) {
    console.log('AdManager: Interstitial ad was already loaded, showing now.');
    interstitial.show();
    lastAdShownTimestamp = now;
    isInterstitialLoaded = false; // Marcar como usado
    interstitial.load(); // Precargar el siguiente
  } else {
    console.log('AdManager: Interstitial ad not loaded, waiting for it to load...');
    // Listener de un solo uso para cuando el anuncio se cargue
    const loadedListener = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      console.log('AdManager: Interstitial ad finished loading, showing now.');
      interstitial.show();
      lastAdShownTimestamp = now;
      isInterstitialLoaded = false; // Marcar como usado
      loadedListener(); // Limpiar el listener
      interstitial.load(); // Precargar el siguiente
    });
    // Si no está cargado, iniciar la carga
    interstitial.load();
  }
};

/**
 * Muestra un anuncio de recompensa si está cargado.
 * @param onRewardEarned - Callback que se ejecuta cuando el usuario ha ganado la recompensa.
 */
const showRewardedAd = (onRewardEarned: () => void, onUnavailable?: () => void) => {
  if (isRewardedLoaded) {
    const rewardListener = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      () => {
        onRewardEarned();
        rewardListener(); // Limpiar listener de un solo uso
        // Precargar el siguiente anuncio de recompensa
        isRewardedLoaded = false;
        rewarded.load();
      },
    );

    rewarded.show();
  } else {
    console.log('AdManager: Rewarded ad not loaded yet.');
    onUnavailable?.();
    rewarded.load();
  }
};


export const adManager = {
  initialize,
  showInterstitialAd,
  showRewardedAd,
};
