import {FirebaseAuthTypes, onAuthStateChanged} from '@react-native-firebase/auth';
import {auth} from '../firebaseConfig';

const DEFAULT_AUTH_WAIT_MS = 4500;

const buildAuthError = (message: string, code = 'auth/no-current-user') => {
  const error = new Error(message);
  (error as any).code = code;
  return error;
};

export const waitForAuthenticatedUser = async (
  timeoutMs = DEFAULT_AUTH_WAIT_MS,
): Promise<FirebaseAuthTypes.User | null> => {
  if (auth.currentUser) {
    return auth.currentUser;
  }

  return new Promise(resolve => {
    let settled = false;

    const finish = (user: FirebaseAuthTypes.User | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      unsubscribe();
      resolve(user);
    };

    const timeoutHandle = setTimeout(() => {
      finish(auth.currentUser ?? null);
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(auth, user => {
      if (user) {
        finish(user);
      }
    });
  });
};

export const requireAuthenticatedUser = async (
  context: string,
  timeoutMs = DEFAULT_AUTH_WAIT_MS,
) => {
  const currentUser = auth.currentUser ?? (await waitForAuthenticatedUser(timeoutMs));
  if (currentUser) {
    return currentUser;
  }

  const error = buildAuthError(`Usuario no autenticado (${context})`);
  (error as any).context = context;
  throw error;
};

export const getFreshIdToken = async (
  context: string,
  options: {forceRefresh?: boolean; timeoutMs?: number} = {},
) => {
  const {forceRefresh = true, timeoutMs = DEFAULT_AUTH_WAIT_MS} = options;
  const user = await requireAuthenticatedUser(context, timeoutMs);

  try {
    return await user.getIdToken(forceRefresh);
  } catch (error) {
    if (forceRefresh) {
      return user.getIdToken(false);
    }
    const tokenError = buildAuthError(`No se pudo obtener token (${context})`, 'auth/token-error');
    (tokenError as any).cause = error;
    throw tokenError;
  }
};
