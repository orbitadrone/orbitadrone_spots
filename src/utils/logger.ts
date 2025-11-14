// Simple logging utility to reduce noise in production.
// In development, it leaves console behavior unchanged.

export const silenceConsoleInProd = () => {
  if (__DEV__) return;
  const noop = () => {};
  // Keep warn and error to surface important issues in production.
  // Silence the most verbose methods.
  // eslint-disable-next-line no-console
  console.log = noop;
  // eslint-disable-next-line no-console
  console.debug = noop;
};

export const logger = {
  log: (...args: any[]) => {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.warn(...args);
  },
  error: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
};

export default logger;

