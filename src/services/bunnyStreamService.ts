import { BUNNY_UPLOAD_ENDPOINT as RAW_UPLOAD_ENDPOINT, BUNNY_CDN_HOST as RAW_BUNNY_CDN_HOST } from '@env';
import { getFreshIdToken } from './authSession';
import { uploadFile } from './storageService';

const BUNNY_UPLOAD_ENDPOINT = RAW_UPLOAD_ENDPOINT?.trim();
const UPLOAD_TIMEOUT_MS = 4 * 60 * 1000;
const BACKEND_HEALTH_TIMEOUT_MS = 5000;

type BunnyUploadErrorCode =
  | 'bunny/auth-required'
  | 'bunny/auth-rejected'
  | 'bunny/network'
  | 'bunny/timeout'
  | 'bunny/backend'
  | 'bunny/fallback-failed';

const getBunnyPlaybackUrl = (guid: string) => {
  // Prefer backend-provided playbackUrl. If absent, derive from env.
  const cdnHost = (RAW_BUNNY_CDN_HOST || '').toString().trim().replace(/\/$/, '');
  return cdnHost ? `${cdnHost}/${guid}/playlist.m3u8` : '';
};

const buildUploadError = (
  message: string,
  code: BunnyUploadErrorCode,
  status?: number,
  responseText?: string,
) => {
  const error = new Error(message);
  (error as any).code = code;
  if (typeof status === 'number') {
    (error as any).status = status;
  }
  if (responseText) {
    (error as any).responseText = responseText;
  }
  return error;
};

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getBackendHealthUrl = () => {
  if (!BUNNY_UPLOAD_ENDPOINT) {
    return '';
  }
  if (/\/bunny\/upload\/?$/i.test(BUNNY_UPLOAD_ENDPOINT)) {
    return BUNNY_UPLOAD_ENDPOINT.replace(/\/bunny\/upload\/?$/i, '/health');
  }
  return `${BUNNY_UPLOAD_ENDPOINT.replace(/\/$/, '')}/health`;
};

const ensureBackendReachable = async () => {
  const healthUrl = getBackendHealthUrl();
  if (!healthUrl) {
    return;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), BACKEND_HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) {
      throw buildUploadError(
        `[Bunny] Upload backend healthcheck failed (${response.status}).`,
        'bunny/network',
        response.status,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildUploadError(
      `[Bunny] Upload backend is unreachable: ${message}`,
      'bunny/network',
    );
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const shouldFallbackToStorage = (error: unknown) => {
  const code = String((error as any)?.code ?? '').toLowerCase();
  const status = Number((error as any)?.status ?? 0);
  if (!code) {
    return true;
  }
  if (code === 'bunny/fallback-failed') {
    return false;
  }
  return (
    code.startsWith('bunny/') ||
    code.startsWith('storage/') ||
    status >= 400
  );
};

const seemsAuthFailure = (status: number, responseText: string) => {
  if (status === 401 || status === 403) {
    return true;
  }
  const normalized = responseText.toLowerCase();
  return (
    normalized.includes('authorization') ||
    normalized.includes('token') ||
    normalized.includes('unauth') ||
    normalized.includes('decode') ||
    normalized.includes('auth')
  );
};

export const uploadVideoToBunny = async ({
  uri,
  name,
  contentType,
  title,
  onProgress,
}: {
  uri: string;
  name?: string;
  contentType?: string;
  title?: string;
  onProgress?: (payload: { loaded: number; total: number }) => void;
}) => {
  if (!uri) {
    throw new Error('No video uri provided for Bunny upload.');
  }

  if (!BUNNY_UPLOAD_ENDPOINT) {
    console.error(
      '[Bunny] Backend endpoint is not configured. Set BUNNY_UPLOAD_ENDPOINT in .env',
    );
    throw new Error('Bunny backend endpoint is not configured.');
  }

  if (__DEV__) {
    console.log('[Bunny] Uploading via backend endpoint', {
      uri,
      name,
      contentType,
      title,
    });
  }

  await ensureBackendReachable();

  const fd = new FormData();
  fd.append('file', {
    uri: uri,
    type: contentType ?? 'video/mp4',
    name: name ?? 'upload.mp4',
  } as any);

  if (title) {
    fd.append('title', title);
  }

  let idToken = '';
  try {
    idToken = await getFreshIdToken('bunny_upload', {forceRefresh: true});
  } catch (tokenError) {
    console.warn('[Bunny] Missing valid auth token for upload', tokenError);
    throw buildUploadError(
      '[Bunny] Missing valid auth token for upload.',
      'bunny/auth-required',
      401,
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${idToken}`,
  };

  try {
    return await new Promise<{ guid: string; playbackUrl: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', BUNNY_UPLOAD_ENDPOINT, true);
      xhr.timeout = UPLOAD_TIMEOUT_MS;
      Object.entries(headers).forEach(([key, value]) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.upload.onprogress = e => {
        if (e.lengthComputable && onProgress) {
          onProgress({ loaded: e.loaded, total: e.total });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const responseText = xhr.responseText;
            const response = JSON.parse(responseText);
            if (!response.guid) {
              throw buildUploadError(
                'Invalid response from backend: missing guid.',
                'bunny/backend',
                xhr.status,
                responseText,
              );
            }
            resolve({
              guid: response.guid,
              playbackUrl: response.playbackUrl ?? getBunnyPlaybackUrl(response.guid),
            });
          } catch (e) {
            if ((e as any)?.code === 'bunny/backend') {
              reject(e as Error);
              return;
            }
            const parseError = e instanceof Error ? e.message : String(e);
            console.warn('[Bunny] Failed to parse backend response', parseError, xhr.responseText);
            reject(
              buildUploadError(
                `Failed to parse backend response: ${parseError}`,
                'bunny/backend',
                xhr.status,
                xhr.responseText,
              ),
            );
          }
        } else {
          const responseText = xhr.responseText || '';
          const isAuthFailure = seemsAuthFailure(xhr.status, responseText);
          console.warn('[Bunny] Backend upload failed', {
            status: xhr.status,
            response: responseText,
          });
          reject(
            buildUploadError(
              `[Bunny] Backend upload failed (${xhr.status}): ${responseText}`,
              isAuthFailure ? 'bunny/auth-rejected' : 'bunny/backend',
              xhr.status,
              responseText,
            ),
          );
        }
      };

      xhr.onerror = () => {
        console.warn('[Bunny] Network request failed', {
          status: xhr.status,
          response: xhr.responseText,
        });
        reject(
          buildUploadError(
            '[Bunny] Network request failed.',
            'bunny/network',
            xhr.status || 0,
            xhr.responseText || '',
          ),
        );
      };

      xhr.ontimeout = () => {
        console.warn('[Bunny] Upload request timed out');
        reject(
          buildUploadError(
            '[Bunny] Upload request timed out.',
            'bunny/timeout',
            408,
            xhr.responseText || '',
          ),
        );
      };

      xhr.send(fd);
    });
  } catch (uploadError) {
    if (!shouldFallbackToStorage(uploadError)) {
      throw uploadError;
    }

    console.warn('[Bunny] Falling back to Firebase Storage upload', {
      code: (uploadError as any)?.code,
      status: (uploadError as any)?.status,
    });

    try {
      const cleanName = sanitizeFileName(name ?? 'upload.mp4') || `video_${Date.now()}.mp4`;
      const storagePath = `video_fallback/${Date.now()}_${cleanName}`;
      const playbackUrl = await uploadFile(
        uri,
        storagePath,
        contentType ? {contentType} : undefined,
      );
      return {
        guid: `storage_${Date.now()}`,
        playbackUrl,
      };
    } catch (fallbackError) {
      console.error('[Bunny] Storage fallback failed', fallbackError);
      const fallbackCode = String((fallbackError as any)?.code ?? '').toLowerCase();
      if (fallbackCode) {
        const enrichedError = fallbackError instanceof Error
          ? fallbackError
          : new Error('[Bunny] Storage fallback failed.');
        (enrichedError as any).code = fallbackCode;
        throw enrichedError;
      }
      throw buildUploadError('[Bunny] Storage fallback failed.', 'bunny/fallback-failed');
    }
  }
};
