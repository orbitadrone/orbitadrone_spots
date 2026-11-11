const CONTENT_QUERY_CACHE_TTL_MS = 10000;

type CacheEntry<T> = {
  expiresAt: number;
  hasValue: boolean;
  inFlight: Promise<T> | null;
  value?: T;
};

const queryCache = new Map<string, CacheEntry<unknown>>();

const getCacheEntry = <T,>(key: string) =>
  queryCache.get(key) as CacheEntry<T> | undefined;

export const readCachedContentQuery = async <T>({
  forceRefresh = false,
  key,
  read,
  ttlMs = CONTENT_QUERY_CACHE_TTL_MS,
}: {
  forceRefresh?: boolean;
  key: string;
  read: () => Promise<T>;
  ttlMs?: number;
}): Promise<T> => {
  const now = Date.now();
  const existing = getCacheEntry<T>(key);

  if (!forceRefresh && existing?.hasValue && existing.expiresAt > now) {
    return existing.value as T;
  }

  if (!forceRefresh && existing?.inFlight) {
    return existing.inFlight;
  }

  const inFlight = (async () => {
    const value = await read();
    queryCache.set(key, {
      expiresAt: Date.now() + ttlMs,
      hasValue: true,
      inFlight: null,
      value,
    });
    return value;
  })();

  queryCache.set(key, {
    expiresAt: existing?.expiresAt ?? 0,
    hasValue: existing?.hasValue ?? false,
    inFlight,
    value: existing?.value,
  });

  try {
    return await inFlight;
  } catch (error) {
    if (existing?.hasValue) {
      queryCache.set(key, {
        ...existing,
        inFlight: null,
      });
    } else {
      queryCache.delete(key);
    }
    throw error;
  }
};

export const CONTENT_QUERY_CACHE_KEYS = {
  socialPosts: 'socialPosts.all',
  spots: 'spots.all',
} as const;

export const invalidateContentQueryCache = (...keys: string[]) => {
  keys.forEach(key => {
    queryCache.delete(key);
  });
};

export const invalidateSocialPostsQueryCache = () =>
  invalidateContentQueryCache(CONTENT_QUERY_CACHE_KEYS.socialPosts);

export const invalidateSpotsQueryCache = () =>
  invalidateContentQueryCache(CONTENT_QUERY_CACHE_KEYS.spots);
