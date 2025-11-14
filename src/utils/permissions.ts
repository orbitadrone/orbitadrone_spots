import {PermissionsAndroid, Platform} from 'react-native';
import Geolocation from '@react-native-community/geolocation';

const ANDROID_CAMERA = PermissionsAndroid.PERMISSIONS.CAMERA;
const ANDROID_FINE_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
const ANDROID_COARSE_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
const ANDROID_READ_EXTERNAL = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
const ANDROID_WRITE_EXTERNAL = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
const ANDROID_ACCESS_MEDIA_LOCATION = PermissionsAndroid.PERMISSIONS.ACCESS_MEDIA_LOCATION;
const ANDROID_READ_MEDIA_IMAGES =
  PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES ?? 'android.permission.READ_MEDIA_IMAGES';
const ANDROID_READ_MEDIA_VIDEO =
  PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO ?? 'android.permission.READ_MEDIA_VIDEO';
const ANDROID_RECORD_AUDIO = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;

const requestAndroidPermissions = async (permissions: string[]) => {
  const uniquePermissions = Array.from(new Set(permissions.filter(Boolean)));
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
    Geolocation.requestAuthorization('whenInUse');
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

export const requestMediaPermission = async () => {
  if (Platform.OS !== 'android') {
    return true;
  }

  const permissions: string[] = [];
  if (Platform.Version >= 33) {
    permissions.push(ANDROID_READ_MEDIA_IMAGES, ANDROID_READ_MEDIA_VIDEO);
  } else {
    permissions.push(ANDROID_READ_EXTERNAL, ANDROID_WRITE_EXTERNAL);
  }

  permissions.push(ANDROID_ACCESS_MEDIA_LOCATION);
  permissions.push(ANDROID_RECORD_AUDIO);
  return requestAndroidPermissions(permissions);
};

export const requestEssentialPermissions = async () => {
  if (Platform.OS === 'android') {
    await requestAndroidPermissions([
      ANDROID_FINE_LOCATION,
      ANDROID_COARSE_LOCATION,
      ANDROID_CAMERA,
      Platform.Version >= 33 ? ANDROID_READ_MEDIA_IMAGES : ANDROID_READ_EXTERNAL,
      Platform.Version >= 33 ? ANDROID_READ_MEDIA_VIDEO : null,
      Platform.Version >= 33 ? null : ANDROID_WRITE_EXTERNAL,
      ANDROID_ACCESS_MEDIA_LOCATION,
      ANDROID_RECORD_AUDIO,
    ].filter(Boolean) as string[]);
  } else {
    Geolocation.requestAuthorization('whenInUse');
  }
};
