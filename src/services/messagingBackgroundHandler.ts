import {getMessaging, setBackgroundMessageHandler} from '@react-native-firebase/messaging';
import logger from '../utils/logger';

const messagingInstance = getMessaging();

setBackgroundMessageHandler(messagingInstance, async remoteMessage => {
  logger.info('[Messaging] Background message received', remoteMessage.messageId);
});
