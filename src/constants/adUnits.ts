import { Platform } from 'react-native';

// --- IDs de Bloques de Anuncios de PRUEBA ---
// Estos IDs son proporcionados por Google y SIEMPRE mostrarán anuncios.
const testIds = {
  appOpen: {
    ios: 'ca-app-pub-3940256099942544/5662855259',
    android: 'ca-app-pub-3940256099942544/9257395921',
  },
  interstitial: {
    ios: 'ca-app-pub-3940256099942544/4411468910',
    android: 'ca-app-pub-3940256099942544/1033173712',
  },
  rewarded: {
    ios: 'ca-app-pub-3940256099942544/1712485313',
    android: 'ca-app-pub-3940256099942544/5224354917',
  },
};

// --- IDs de Bloques de Anuncios de PRODUCCIÓN ---
// TODO: Reemplazar los IDs de prueba restantes por los reales antes de publicar.
const productionIds = {
  appOpen: {
    ios: testIds.appOpen.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/8475785225',
  },
  interstitial: {
    ios: testIds.interstitial.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/3741953743',
  },
  rewarded: {
    ios: testIds.rewarded.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/7359689262',
  },
};

// Selecciona los IDs correctos según el entorno (desarrollo o producción)
const adUnits = __DEV__ ? testIds : productionIds;

// --- Exportación de IDs según la plataforma ---

export const appOpenAdUnitId = Platform.select({
  ios: adUnits.appOpen.ios,
  android: adUnits.appOpen.android,
}) as string;

export const interstitialAdUnitId = Platform.select({
  ios: adUnits.interstitial.ios,
  android: adUnits.interstitial.android,
}) as string;

export const rewardedAdUnitId = Platform.select({
  ios: adUnits.rewarded.ios,
  android: adUnits.rewarded.android,
}) as string;
