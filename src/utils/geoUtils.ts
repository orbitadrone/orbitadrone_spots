import { geocode } from './geocoding';

const SPAIN_BOUNDING_BOX = {
  min_longitude: -9.39288367353,
  min_latitude: 35.946850084,
  max_longitude: 3.03948408368,
  max_latitude: 43.7483377142,
};

export const isPointInSpain = (latitude: number, longitude: number): boolean => {
  return (
    latitude >= SPAIN_BOUNDING_BOX.min_latitude &&
    latitude <= SPAIN_BOUNDING_BOX.max_latitude &&
    longitude >= SPAIN_BOUNDING_BOX.min_longitude &&
    longitude <= SPAIN_BOUNDING_BOX.max_longitude
  );
};

const extractCountryCode = (geocodeResult: any): string | null => {
  if (!geocodeResult || !Array.isArray(geocodeResult.address_components)) {
    return null;
  }
  const country = geocodeResult.address_components.find((component: any) =>
    Array.isArray(component.types) && component.types.includes('country'),
  );
  if (!country || typeof country.short_name !== 'string') {
    return null;
  }
  return country.short_name;
};

export const validateSpainLocation = async (
  latitude: number,
  longitude: number,
): Promise<{ isSpain: boolean; source: 'geocode' | 'fallback' }> => {
  try {
    const result = await geocode(latitude, longitude);
    const countryCode = extractCountryCode(result);
    if (countryCode) {
      return { isSpain: countryCode === 'ES', source: 'geocode' };
    }
  } catch (error) {
    console.warn('[geoUtils] geocode validation failed, falling back to bbox', error);
  }
  return { isSpain: isPointInSpain(latitude, longitude), source: 'fallback' };
};
