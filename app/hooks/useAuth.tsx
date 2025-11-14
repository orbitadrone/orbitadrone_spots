import { useState, useEffect } from 'react';
import { FirebaseAuthTypes, onAuthStateChanged } from '@react-native-firebase/auth';
import { auth } from '../../src/firebaseConfig';

export function useAuth() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, userState => {
      setUser(userState);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return { user, loading };
}
