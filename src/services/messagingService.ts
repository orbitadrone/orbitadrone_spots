import { Alert, Platform } from 'react-native';
import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import Toast from 'react-native-toast-message';
import { addUserNotificationToken, removeUserNotificationToken } from './firestoreService';

const logPrefix = '[Messaging]';

const isAuthorizationGranted = (status: FirebaseMessagingTypes.AuthorizationStatus) =>
  status === messaging.AuthorizationStatus.AUTHORIZED ||
  status === messaging.AuthorizationStatus.PROVISIONAL;

export const requestNotificationPermission = async () => {
  const settings = await messaging().requestPermission();
  const granted = isAuthorizationGranted(settings);
  if (!granted && Platform.OS === 'android') {
    Alert.alert(
      'Permisos necesarios',
      'Activa las notificaciones en los ajustes del sistema para recibir avisos importantes.',
    );
  }
  return granted;
};

export const ensureFcmTokenForUser = async (userId: string) => {
  try {
    const enabled = await requestNotificationPermission();
    if (!enabled) {
      console.log(`${logPrefix} permission not granted`);
      return null;
    }

    const token = await messaging().getToken();
    if (!token) {
      console.warn(`${logPrefix} failed to obtain FCM token`);
      return null;
    }

    await addUserNotificationToken(userId, token);
    console.log(`${logPrefix} token registered for user ${userId}`);

    const unsubscribeTokenRefresh = messaging().onTokenRefresh(async refreshedToken => {
      try {
        await addUserNotificationToken(userId, refreshedToken);
        console.log(`${logPrefix} token refreshed for user ${userId}`);
      } catch (error) {
        console.error(`${logPrefix} failed to save refreshed token`, error);
      }
    });

    return {
      token,
      unsubscribeTokenRefresh,
    };
  } catch (error) {
    console.error(`${logPrefix} ensureFcmTokenForUser failed`, error);
    return null;
  }
};

export const clearFcmTokenForUser = async (userId: string) => {
  try {
    const token = await messaging().getToken();
    if (!token) return;
    await removeUserNotificationToken(userId, token);
    await messaging().deleteToken();
    console.log(`${logPrefix} token removed for user ${userId}`);
  } catch (error) {
    console.error(`${logPrefix} clearFcmTokenForUser failed`, error);
  }
};

export const registerForegroundNotificationHandler = () =>
  messaging().onMessage(async remoteMessage => {
    const title = remoteMessage.notification?.title ?? 'Nueva notificación';
    const body = remoteMessage.notification?.body ?? '';
    Toast.show({
      type: 'info',
      text1: title,
      text2: body,
    });
  });
