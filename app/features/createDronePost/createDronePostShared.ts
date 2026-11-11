import RNFS from 'react-native-fs';

import logger from '../../../src/utils/logger';

export const MAX_VIDEO_DURATION_SECONDS = 180;
export const MAX_VIDEO_SIZE_MB = 200;
export const VIDEO_COMPRESSION_THRESHOLD_MB = 80;
export const MAX_IMAGES = 5;
export const DRAFT_STORAGE_KEY = 'create_drone_post_draft_v1';
export const IMAGE_UPLOAD_TIMEOUT_MS = 120000;
export const MEDIA_PREPARE_TIMEOUT_MS = 15000;
export const VIDEO_COMPRESSION_TIMEOUT_MS = 180000;
export const CREATE_POST_TIMEOUT_MS = 20000;
export const PUBLISHED_STAGE_DELAY_MS = 300;
export const SERVER_PROCESSING_RATIO_THRESHOLD = 0.98;

const ORBIT_MEDIA_TEMP_PREFIX = 'orbitadrone_media_';
const BYTES_PER_MB = 1024 * 1024;

export type LocalImageAsset = {
  uri: string;
  fileName?: string | null;
  type?: string | null;
};

export type DraftPayload = {
  text: string;
  images: LocalImageAsset[];
  videoUri: string | null;
  videoName: string | null;
  videoType: string | null;
  updatedAt: number;
};

export const bytesToMb = (bytes?: number) => {
  if (!bytes || bytes <= 0) {
    return 0;
  }
  return bytes / BYTES_PER_MB;
};

export const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
};

export const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

export const withTimeout = async <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`Timeout: ${label}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const ensureFileLikeUri = (input: unknown): string | null => {
  if (typeof input !== 'string' || !input.trim()) {
    return null;
  }
  const normalized = input.trim();
  if (normalized.startsWith('file://') || normalized.startsWith('content://')) {
    return normalized;
  }
  if (normalized.startsWith('/')) {
    return `file://${normalized}`;
  }
  return `file:///${normalized}`;
};

export const getMediaExtension = (
  fileName: string | null | undefined,
  mimeType: string | null | undefined,
  fallback: string,
) => {
  if (fileName) {
    const match = /\.([a-z0-9]+)$/i.exec(fileName);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }
  if (mimeType) {
    const parts = mimeType.toLowerCase().split('/');
    if (parts.length === 2 && parts[1]) {
      return parts[1];
    }
  }
  return fallback;
};

const stripFileScheme = (uri: string) => uri.replace(/^file:\/\//, '');

const buildManagedMediaPath = (extension: string) =>
  `${RNFS.CachesDirectoryPath}/${ORBIT_MEDIA_TEMP_PREFIX}${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}.${extension}`;

const isManagedMediaUri = (uri: string | null | undefined) => {
  if (!uri || !uri.startsWith('file://')) {
    return false;
  }
  return stripFileScheme(uri).includes(`/${ORBIT_MEDIA_TEMP_PREFIX}`);
};

export const safeUnlinkManagedMediaUri = async (uri: string | null | undefined) => {
  if (!isManagedMediaUri(uri)) {
    return;
  }
  const path = stripFileScheme(uri as string);
  try {
    const exists = await RNFS.exists(path);
    if (exists) {
      await RNFS.unlink(path);
    }
  } catch (cleanupError) {
    logger.warn('[CreateDronePost] managed media cleanup failed', cleanupError);
  }
};

export const doesFileUriExist = async (uri: string) => {
  const normalized = ensureFileLikeUri(uri);
  if (!normalized || !normalized.startsWith('file://')) {
    return false;
  }
  try {
    return await RNFS.exists(stripFileScheme(normalized));
  } catch (error) {
    logger.warn('[CreateDronePost] file existence check failed', {uri: normalized, error});
    return false;
  }
};

export const getFileSize = async (uri: string) => {
  const normalized = ensureFileLikeUri(uri);
  if (!normalized) {
    return null;
  }

  const path = normalized.startsWith('file://') ? stripFileScheme(normalized) : normalized;
  try {
    const stat = await RNFS.stat(path);
    const size = Number(stat.size);
    return Number.isFinite(size) ? size : null;
  } catch (error) {
    logger.warn('[CreateDronePost] unable to stat media size', {uri: normalized, error});
    return null;
  }
};

export const normalizeDraftImages = (value: unknown): LocalImageAsset[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<LocalImageAsset[]>((acc, item) => {
    if (typeof item === 'string' && item.trim()) {
      acc.push({uri: item.trim()});
      return acc;
    }
    if (item && typeof item === 'object' && typeof (item as {uri?: unknown}).uri === 'string') {
      const candidate = item as {
        uri: string;
        fileName?: unknown;
        type?: unknown;
      };
      acc.push({
        uri: candidate.uri,
        fileName: typeof candidate.fileName === 'string' ? candidate.fileName : null,
        type: typeof candidate.type === 'string' ? candidate.type : null,
      });
    }
    return acc;
  }, []);
};

export const prepareUploadableUri = async ({
  uri,
  fileName,
  mimeType,
  fallbackExtension,
  preferStableCopy = false,
}: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fallbackExtension?: string;
  preferStableCopy?: boolean;
}): Promise<{uploadUri: string; tempPath: string | null}> => {
  const normalizedUri = ensureFileLikeUri(uri);
  if (!normalizedUri) {
    throw new Error('Invalid media URI');
  }

  const extension = getMediaExtension(fileName, mimeType, fallbackExtension ?? 'bin');
  const shouldCreateManagedCopy =
    preferStableCopy ||
    normalizedUri.startsWith('content://') ||
    /rn_image_picker_lib_temp_/i.test(normalizedUri);

  if (shouldCreateManagedCopy) {
    const destinationPath = buildManagedMediaPath(extension);
    const sourcePath = normalizedUri.startsWith('file://')
      ? stripFileScheme(normalizedUri)
      : normalizedUri;
    try {
      await RNFS.copyFile(sourcePath, destinationPath);
      return {
        uploadUri: `file://${destinationPath}`,
        tempPath: destinationPath,
      };
    } catch (copyError) {
      logger.warn('[CreateDronePost] media copy failed', {
        uri: normalizedUri,
        copyError,
      });
      if (normalizedUri.startsWith('content://')) {
        throw copyError instanceof Error ? copyError : new Error('Unable to access selected media');
      }
    }
  }

  if (normalizedUri.startsWith('file://')) {
    const filePath = stripFileScheme(normalizedUri);
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      throw new Error('Selected media file is no longer available.');
    }
  }

  return {uploadUri: normalizedUri, tempPath: null};
};

export const cleanupTempFiles = async (tempPaths: string[]) => {
  if (!tempPaths.length) {
    return;
  }

  await Promise.all(
    tempPaths.map(async tempPath => {
      try {
        const exists = await RNFS.exists(tempPath);
        if (exists) {
          await RNFS.unlink(tempPath);
        }
      } catch (cleanupError) {
        logger.warn('[CreateDronePost] temp cleanup failed', cleanupError);
      }
    }),
  );
};
