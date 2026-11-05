export const WEB_BASE_URL = 'https://orbitadrone.com';
export const PLAY_STORE_PACKAGE_NAME = 'com.orbitadrone_spots';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${PLAY_STORE_PACKAGE_NAME}`;

export const buildSpotShareUrl = (spotId: string) => `${WEB_BASE_URL}/spot/${spotId}`;
export const buildEventShareUrl = (eventId: string) => `${WEB_BASE_URL}/event/${eventId}`;
export const buildFeedShareUrl = () => `${WEB_BASE_URL}/feed`;
export const buildPostShareUrl = (postId: string) =>
  `${buildFeedShareUrl()}?postId=${encodeURIComponent(postId)}`;

export const buildGoogleMapsDirectionsUrl = ({
  latitude,
  longitude,
  address,
  label,
}: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  label?: string | null;
}) => {
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }

  const destination = address?.trim() || label?.trim() || '';
  if (!destination) {
    return null;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
};
