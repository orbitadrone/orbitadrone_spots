import {
  getCrashlytics,
  log as logCrashlytics,
  recordError,
} from '@react-native-firebase/crashlytics';

const MAX_CRASHLYTICS_MESSAGE_LENGTH = 1024;

const noop = () => {};

const serializeLogValue = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack || value.message || value.name;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatMessage = (args: unknown[]) =>
  args
    .map(serializeLogValue)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CRASHLYTICS_MESSAGE_LENGTH);

const writeCrashlyticsLog = (level: 'info' | 'warn' | 'error', args: unknown[]) => {
  if (__DEV__) {
    return;
  }

  const message = formatMessage(args);
  if (!message) {
    return;
  }

  try {
    logCrashlytics(getCrashlytics(), `[${level}] ${message}`);
  } catch {
    // Ignore logging failures to avoid cascading runtime issues.
  }
};

const findError = (args: unknown[]) => args.find(value => value instanceof Error) as Error | undefined;

export const silenceConsoleInProd = () => {
  if (__DEV__) return;
  // Keep console.error intact for fatal uncaught issues, but silence noisy levels.
  console.log = noop;
  console.debug = noop;
  console.info = noop;
  console.warn = noop;
};

export const logger = {
  log: (...args: unknown[]) => {
    if (__DEV__) {
      console.log(...args);
    }
  },
  info: (...args: unknown[]) => {
    if (__DEV__) {
      console.log(...args);
      return;
    }
    writeCrashlyticsLog('info', args);
  },
  warn: (...args: unknown[]) => {
    if (__DEV__) {
      console.warn(...args);
      return;
    }
    writeCrashlyticsLog('warn', args);
  },
  error: (...args: unknown[]) => {
    if (__DEV__) {
      console.error(...args);
      return;
    }

    writeCrashlyticsLog('error', args);

    try {
      const error = findError(args) ?? new Error(formatMessage(args) || 'Unknown runtime error');
      recordError(getCrashlytics(), error);
    } catch {
      // Ignore Crashlytics failures to avoid cascading runtime issues.
    }
  },
};

export default logger;
