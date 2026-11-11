import { Platform } from 'react-native';

// --- IDs de Bloques de Anuncios de PRUEBA ---
// Estos IDs son proporcionados por Google y SIEMPRE mostrarán anuncios.
const testIds = {
  banner: {
    ios: 'ca-app-pub-3940256099942544/2934735716',
    android: 'ca-app-pub-3940256099942544/6300978111',
  },
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
  banner: {
    ios: testIds.banner.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/1795860291',
  },
  appOpen: {
    ios: testIds.appOpen.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/5873522908',
  },
  interstitial: {
    ios: testIds.interstitial.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/3247359563',
  },
  rewarded: {
    ios: testIds.rewarded.ios, // Reemplazar con tu ID real de iOS
    android: 'ca-app-pub-7840437883541028/7461432169',
  },
};

// Selecciona los IDs correctos según el entorno (desarrollo o producción)
const adUnits = __DEV__ ? testIds : productionIds;

// --- Exportación de IDs según la plataforma ---

export const appOpenAdUnitId = Platform.select({
  ios: adUnits.appOpen.ios,
  android: adUnits.appOpen.android,
}) as string;

export const feedBannerAdUnitId = Platform.select({
  ios: adUnits.banner.ios,
  android: adUnits.banner.android,
}) as string;

export const interstitialAdUnitId = Platform.select({
  ios: adUnits.interstitial.ios,
  android: adUnits.interstitial.android,
}) as string;

export const rewardedAdUnitId = Platform.select({
  ios: adUnits.rewarded.ios,
  android: adUnits.rewarded.android,
}) as string;
