type RetryShouldRetryFn = (error: unknown, attempt: number) => boolean;

export type RetryAsyncOptions = {
  attempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  shouldRetry?: RetryShouldRetryFn;
  onRetry?: (payload: {attempt: number; delayMs: number; error: unknown}) => void;
};

const DEFAULT_RETRIABLE_CODES = new Set([
  'aborted',
  'cancelled',
  'deadline-exceeded',
  'resource-exhausted',
  'unavailable',
]);

const sleep = (ms: number) =>
  new Promise(resolve => {
    setTimeout(() => resolve(null), ms);
  });

const getStatusCode = (error: unknown): number | undefined => {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const statusValue = (error as {status?: number}).status;
    if (typeof statusValue === 'number') {
      return statusValue;
    }
  }
  return undefined;
};

const getErrorMessage = (error: unknown) => {
  if (!error) {
    return '';
  }
  if (typeof error === 'string') {
    return error;
  }
  if (typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    return (error as any).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

export const isRetriableHttpStatus = (status?: number | null) => {
  if (typeof status !== 'number') {
    return false;
  }
  return status >= 500 || status === 429 || status === 408;
};

export const isRetriableNetworkError = (error: unknown) => {
  const message = getErrorMessage(error).toLowerCase();
  if (!message) {
    return false;
  }
  const status = getStatusCode(error);
  if (isRetriableHttpStatus(status)) {
    return true;
  }
  const retriableFragments = [
    'network',
    'timeout',
    'timed out',
    'aborted',
    'connection',
    'unavailable',
    '503',
    '429',
    'socket',
    'temporarily',
    'failed to fetch',
    'xhr error',
  ];
  if (retriableFragments.some(fragment => message.includes(fragment))) {
    return true;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as {code?: string}).code
      : undefined;
  if (code && typeof code === 'string' && DEFAULT_RETRIABLE_CODES.has(code)) {
    return true;
  }
  return false;
};

export const isRetriableFirestoreError = (error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as {code?: string}).code
      : undefined;
  if (!code) {
    return false;
  }
  if (DEFAULT_RETRIABLE_CODES.has(code)) {
    return true;
  }
  const status = getStatusCode(error);
  return isRetriableHttpStatus(status);
};

export const retryAsync = async <T>(
  operation: () => Promise<T>,
  {
    attempts = 3,
    initialDelayMs = 250,
    maxDelayMs = 2000,
    backoffFactor = 2,
    shouldRetry = isRetriableNetworkError,
    onRetry,
  }: RetryAsyncOptions = {},
): Promise<T> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const willRetry =
        attempt < attempts && (typeof shouldRetry === 'function' ? shouldRetry(error, attempt) : true);
      if (!willRetry) {
        break;
      }
      const delayMs = Math.min(
        Math.round(initialDelayMs * Math.pow(backoffFactor, attempt - 1)),
        maxDelayMs,
      );
      onRetry?.({attempt, delayMs, error});
      await sleep(delayMs);
    }
  }
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(getErrorMessage(lastError));
};

export default retryAsync;
