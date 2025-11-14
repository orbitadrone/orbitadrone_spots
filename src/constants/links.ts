export const WEB_BASE_URL = 'https://orbitadrone.com';
export const PLAY_STORE_PACKAGE_NAME = 'com.orbitadrone_spots';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE_NAME}`;

export const buildSpotShareUrl = (spotId: string) => `${WEB_BASE_URL}/spot/${spotId}`;
