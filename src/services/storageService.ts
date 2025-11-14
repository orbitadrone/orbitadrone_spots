import { firebaseStorage } from '../firebaseConfig';
import { retryAsync, isRetriableNetworkError } from '../utils/retry';

const isRetriableStorageError = (error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as {code?: string}).code
      : undefined;
  if (typeof code === 'string') {
    const normalized = code.toLowerCase();
    if (
      normalized.includes('retry') ||
      normalized.includes('quota') ||
      normalized.includes('unavailable')
    ) {
      return true;
    }
  }
  return isRetriableNetworkError(error);
};

const uploadFile = async (uri: string, path: string, metadata?: Record<string, unknown>) => {
  return retryAsync(async () => {
    const reference = firebaseStorage.ref(path);
    try {
      await reference.putFile(uri, metadata);
      return reference.getDownloadURL();
    } catch (error) {
      console.warn('[Storage] upload failed', { path, error });
      throw error;
    }
  }, {
    attempts: 3,
    shouldRetry: isRetriableStorageError,
    onRetry: ({ attempt, delayMs, error }) => {
      console.warn(
        `[Storage] retrying upload for ${path} (attempt ${attempt}) in ${delayMs}ms`,
        error,
      );
    },
  });
};

export const uploadImage = (uri: string, path: string) =>
  uploadFile(uri, path);

export { uploadFile };
