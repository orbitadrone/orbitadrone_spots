import messaging from '@react-native-firebase/messaging';

messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('[Messaging] Background message received', remoteMessage.messageId);
});
