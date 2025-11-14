import Geocoder from 'react-native-geocoding';
import { GOOGLE_MAPS_API_KEY } from '@env';

export const initGeocoder = () => {
  Geocoder.init(GOOGLE_MAPS_API_KEY);
};

export const geocode = async (lat: number, lng: number) => {
  try {
    const json = await Geocoder.from(lat, lng);
    return json.results[0];
  } catch (error) {
    console.error("Error in geocoding service: ", error);
    throw error;
  }
};