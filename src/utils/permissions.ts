import {PermissionsAndroid, Platform, type Permission} from 'react-native';
import Geolocation from '@react-native-community/geolocation';

const ANDROID_CAMERA = PermissionsAndroid.PERMISSIONS.CAMERA;
const ANDROID_FINE_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const ANDROID_COARSE_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
const ANDROID_POST_NOTIFICATIONS =
  PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ?? 'android.permission.POST_NOTIFICATIONS';

const requestAndroidPermissions = async (permissions: Array<Permission | null | undefined>) => {
  const uniquePermissions = Array.from(
    new Set(permissions.filter((permission): permission is Permission => Boolean(permission))),
  );
  if (!uniquePermissions.length) {
    return true;
  }

  const result = await PermissionsAndroid.requestMultiple(uniquePermissions);
  return uniquePermissions.every(
    permission => result[permission] === PermissionsAndroid.RESULTS.GRANTED,
  );
};

export const requestLocationPermission = async () => {
  if (Platform.OS === 'ios') {
    Geolocation.requestAuthorization();
    return true;
  }

  return requestAndroidPermissions([ANDROID_FINE_LOCATION, ANDROID_COARSE_LOCATION]);
};

export const requestCameraPermission = async () => {
  if (Platform.OS === 'android') {
    return requestAndroidPermissions([ANDROID_CAMERA]);
  }

  return true;
};

export const requestEssentialPermissions = async () => {
  if (Platform.OS === 'android') {
    await requestAndroidPermissions([
      ANDROID_FINE_LOCATION,
      ANDROID_COARSE_LOCATION,
      ANDROID_CAMERA,
      Platform.Version >= 33 ? ANDROID_POST_NOTIFICATIONS : null,
    ]);
  } else {
    Geolocation.requestAuthorization();
  }
};
