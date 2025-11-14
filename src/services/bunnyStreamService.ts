import { auth } from '../firebaseConfig';
import { BUNNY_UPLOAD_ENDPOINT as RAW_UPLOAD_ENDPOINT, BUNNY_CDN_HOST as RAW_BUNNY_CDN_HOST } from '@env';

const BUNNY_UPLOAD_ENDPOINT = RAW_UPLOAD_ENDPOINT?.trim();

const getBunnyPlaybackUrl = (guid: string) => {
  // Prefer backend-provided playbackUrl. If absent, derive from env.
  const cdnHost = (RAW_BUNNY_CDN_HOST || '').toString().trim().replace(/\/$/, '');
  return cdnHost ? `${cdnHost}/${guid}/playlist.m3u8` : '';
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

  const fd = new FormData();
  fd.append('file', {
    uri: uri,
    type: contentType ?? 'video/mp4',
    name: name ?? 'upload.mp4',
  } as any);

  if (title) {
    fd.append('title', title);
  }

  const idToken = await auth?.currentUser?.getIdToken();
  const headers: Record<string, string> = {};
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', BUNNY_UPLOAD_ENDPOINT, true);
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
          const response = JSON.parse(xhr.responseText);
          if (!response.guid) {
            throw new Error('Invalid response from backend: missing guid.');
          }
          resolve({
            guid: response.guid,
            playbackUrl: response.playbackUrl ?? getBunnyPlaybackUrl(response.guid),
          });
        } catch (e) {
          reject(new Error(`Failed to parse backend response: ${e.message}`));
        }
      } else {
        const error = new Error(
          `[Bunny] Backend upload failed (${xhr.status}): ${xhr.responseText}`,
        );
        (error as any).status = xhr.status;
        reject(error);
      }
    };

    xhr.onerror = () => {
      const error = new Error('[Bunny] Network request failed.');
      (error as any).status = xhr.status;
      reject(error);
    };

    xhr.send(fd);
  });
};
