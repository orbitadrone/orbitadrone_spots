import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';
import { getStorage } from '@react-native-firebase/storage';

// Keep firebase instances centralized and simple. App Check is initialized elsewhere.
export const authInstance = getAuth();
export const auth = authInstance;
export const firebaseAuth = authInstance;
export const firestoreDB = getFirestore();
export const firebaseStorage = getStorage();
