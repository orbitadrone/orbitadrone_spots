import { Alert, Platform } from 'react-native';
import {
  AuthorizationStatus,
  FirebaseMessagingTypes,
  deleteToken,
  getMessaging,
  getToken,
  hasPermission,
  onMessage,
  onTokenRefresh,
  requestPermission,
} from '@react-native-firebase/messaging';
import Toast from 'react-native-toast-message';
import { addUserNotificationToken, removeUserNotificationToken } from './firestoreService';
import logger from '../utils/logger';

const logPrefix = '[Messaging]';
const messagingInstance = getMessaging();
let tokenRefreshUnsubscribe: (() => void) | null = null;
let tokenRefreshUserId: string | null = null;

const isAuthorizationGranted = (status: FirebaseMessagingTypes.AuthorizationStatus) =>
  status === AuthorizationStatus.AUTHORIZED ||
  status === AuthorizationStatus.PROVISIONAL;

const syncTokenRefreshSubscription = (userId: string) => {
  if (tokenRefreshUserId === userId && tokenRefreshUnsubscribe) {
    return;
  }

  tokenRefreshUnsubscribe?.();
  tokenRefreshUserId = userId;
  tokenRefreshUnsubscribe = onTokenRefresh(messagingInstance, async refreshedToken => {
    try {
      await addUserNotificationToken(userId, refreshedToken);
      logger.info(`${logPrefix} token refreshed`);
    } catch (error) {
      logger.error(`${logPrefix} failed to save refreshed token`, error);
    }
  });
};

export const stopFcmTokenRefreshSync = () => {
  tokenRefreshUnsubscribe?.();
  tokenRefreshUnsubscribe = null;
  tokenRefreshUserId = null;
};

export const hasNotificationPermission = async () => {
  const status = await hasPermission(messagingInstance);
  return isAuthorizationGranted(status);
};

export const requestNotificationPermission = async () => {
  const settings = await requestPermission(messagingInstance);
  const granted = isAuthorizationGranted(settings);
  if (!granted && Platform.OS === 'android') {
    Alert.alert(
      'Permisos necesarios',
      'Activa las notificaciones en los ajustes del sistema para recibir avisos importantes.',
    );
  }
  return granted;
};

export const ensureFcmTokenForUser = async (
  userId: string,
  options: {promptIfNeeded?: boolean} = {},
) => {
  const {promptIfNeeded = true} = options;
  try {
    const enabled =
      (await hasNotificationPermission()) ||
      (promptIfNeeded ? await requestNotificationPermission() : false);
    if (!enabled) {
      logger.info(`${logPrefix} permission not granted`);
      return null;
    }

    const token = await getToken(messagingInstance);
    if (!token) {
      logger.warn(`${logPrefix} failed to obtain FCM token`);
      return null;
    }

    await addUserNotificationToken(userId, token);
    logger.info(`${logPrefix} token registered`);
    syncTokenRefreshSubscription(userId);

    return {
      token,
    };
  } catch (error) {
    logger.error(`${logPrefix} ensureFcmTokenForUser failed`, error);
    return null;
  }
};

export const clearFcmTokenForUser = async (userId: string) => {
  try {
    stopFcmTokenRefreshSync();
    const token = await getToken(messagingInstance);
    if (!token) return;
    await removeUserNotificationToken(userId, token);
    await deleteToken(messagingInstance);
    logger.info(`${logPrefix} token removed`);
  } catch (error) {
    logger.error(`${logPrefix} clearFcmTokenForUser failed`, error);
  }
};

export const registerForegroundNotificationHandler = () =>
  onMessage(messagingInstance, async remoteMessage => {
    const title = remoteMessage.notification?.title ?? 'Nueva notificación';
    const body = remoteMessage.notification?.body ?? '';
    Toast.show({
      type: 'info',
      text1: title,
      text2: body,
    });
  });
