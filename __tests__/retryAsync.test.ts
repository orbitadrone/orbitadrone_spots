import { retryAsync, isRetriableNetworkError, isRetriableFirestoreError } from '../src/utils/retry';

describe('retryAsync', () => {
  it('resolves immediately when operation succeeds', async () => {
    const spy = jest.fn().mockResolvedValue('ok');
    const result = await retryAsync(spy, { attempts: 2 });
    expect(result).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors and eventually succeeds', async () => {
    let attempts = 0;
    const result = await retryAsync(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error('Network request failed');
          (error as any).status = 503;
          throw error;
        }
        return 'success';
      },
      {
        attempts: 4,
        initialDelayMs: 1,
        maxDelayMs: 1,
      },
    );
    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('throws after exhausting retries when shouldRetry is false', async () => {
    const failing = jest.fn().mockRejectedValue(new Error('fatal'));
    await expect(
      retryAsync(failing, {
        attempts: 2,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('fatal');
    expect(failing).toHaveBeenCalledTimes(1);
  });
});

describe('isRetriableNetworkError', () => {
  it('detects transient HTTP status codes', () => {
    const error = new Error('Server unavailable');
    (error as any).status = 503;
    expect(isRetriableNetworkError(error)).toBe(true);
  });

  it('detects firebase unavailable errors', () => {
    expect(
      isRetriableFirestoreError({
        code: 'unavailable',
      }),
    ).toBe(true);
  });

  it('returns false for permanent failures', () => {
    expect(isRetriableNetworkError(new Error('permission denied'))).toBe(false);
  });
});
