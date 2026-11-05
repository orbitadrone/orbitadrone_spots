import {Video as VideoCompressor} from 'react-native-compressor';
import type {Asset} from 'react-native-image-picker';

import {uploadFile} from '../../../src/services/storageService';
import {uploadVideoToBunny} from '../../../src/services/bunnyStreamService';
import {createDronePost} from '../../../src/services/socialService';
import logger from '../../../src/utils/logger';
import {
  CREATE_POST_TIMEOUT_MS,
  cleanupTempFiles,
  IMAGE_UPLOAD_TIMEOUT_MS,
  MAX_VIDEO_SIZE_MB,
  MEDIA_PREPARE_TIMEOUT_MS,
  SERVER_PROCESSING_RATIO_THRESHOLD,
  VIDEO_COMPRESSION_THRESHOLD_MB,
  VIDEO_COMPRESSION_TIMEOUT_MS,
  bytesToMb,
  ensureFileLikeUri,
  getFileSize,
  getMediaExtension,
  prepareUploadableUri,
  safeUnlinkManagedMediaUri,
  withTimeout,
} from './createDronePostShared';
import type {LocalImageAsset} from './createDronePostShared';

const BYTES_PER_MB = 1024 * 1024;

export type CreateDronePostStage = 'idle' | 'uploading' | 'processing' | 'published';
export type CreateDronePostStep = 'upload_images' | 'upload_video' | 'create_post';
export type CreateDronePostErrorKind =
  | 'storage_permission'
  | 'auth'
  | 'network_upload'
  | 'generic';

type PrepareSelectedVideoArgs = {
  asset: Asset;
  currentVideoUri: string | null;
  isMounted: () => boolean;
};

type PublishCreateDronePostArgs = {
  attempt: number;
  images: LocalImageAsset[];
  text: string;
  videoName: string | null;
  videoType: string | null;
  videoUri: string | null;
  isMounted: () => boolean;
  onProgressChange: (progress: number) => void;
  onStageChange: (stage: CreateDronePostStage) => void;
};

type PreparedSelectedVideo = {
  compressed: boolean;
  compressionFailed: boolean;
  duration: number;
  sizeMb: number;
  videoName: string;
  videoType: string;
  videoUri: string;
};

type PublishCreateDronePostResult = {
  createdPostId: string;
};

export const classifyCreateDronePostError = ({
  error,
  step,
}: {
  error: unknown;
  step: CreateDronePostStep;
}): CreateDronePostErrorKind => {
  const errorCode = String((error as any)?.code ?? '').toLowerCase();
  const errorStatus = Number((error as any)?.status ?? 0);
  const rawMessage = String((error as any)?.message ?? '').toLowerCase();

  const isStoragePermissionError =
    errorCode === 'storage/unauthorized' ||
    (errorCode.includes('storage') && errorCode.includes('unauthorized')) ||
    rawMessage.includes('storage/unauthorized') ||
    (rawMessage.includes('permission denied') && rawMessage.includes('storage'));

  if (isStoragePermissionError) {
    return 'storage_permission';
  }

  const isAuthError =
    errorStatus === 401 ||
    errorStatus === 403 ||
    errorCode.includes('auth') ||
    errorCode.includes('unauthorized') ||
    rawMessage.includes('usuario no autenticado') ||
    rawMessage.includes('unauth') ||
    rawMessage.includes('unauthorized') ||
    rawMessage.includes('auth token');

  if (isAuthError) {
    return 'auth';
  }

  const isUploadError =
    step !== 'create_post' ||
    errorCode.includes('bunny/') ||
    rawMessage.includes('bunny') ||
    rawMessage.includes('upload') ||
    rawMessage.includes('storage') ||
    rawMessage.includes('timeout');

  const isNetworkUploadError =
    errorCode.includes('network') ||
    errorCode.includes('timeout') ||
    errorCode.includes('retry') ||
    errorCode.includes('unavailable') ||
    rawMessage.includes('network') ||
    rawMessage.includes('timed out') ||
    rawMessage.includes('timeout') ||
    rawMessage.includes('connection');

  if (isUploadError && isNetworkUploadError) {
    return 'network_upload';
  }

  return 'generic';
};

export const prepareSelectedVideoAsset = async ({
  asset,
  currentVideoUri,
  isMounted,
}: PrepareSelectedVideoArgs): Promise<PreparedSelectedVideo> => {
  const uri = asset.uri;
  if (!uri) {
    throw new Error('No video selected');
  }

  const duration = Number(asset.duration ?? 0);
  const preparedVideo = await withTimeout(
    prepareUploadableUri({
      uri,
      fileName: asset.fileName,
      mimeType: asset.type,
      fallbackExtension: 'mp4',
      preferStableCopy: true,
    }),
    MEDIA_PREPARE_TIMEOUT_MS,
    'stage_selected_video',
  );

  let workingUri = preparedVideo.uploadUri;
  let workingSizeBytes =
    typeof asset.fileSize === 'number' && asset.fileSize > 0 ? asset.fileSize : null;
  if (!workingSizeBytes) {
    workingSizeBytes = await getFileSize(workingUri);
  }

  if (workingSizeBytes && workingSizeBytes > MAX_VIDEO_SIZE_MB * BYTES_PER_MB) {
    await safeUnlinkManagedMediaUri(workingUri);
    throw new Error('selected_video_too_large');
  }

  const shouldCompress =
    Boolean(workingSizeBytes) &&
    (workingSizeBytes as number) > VIDEO_COMPRESSION_THRESHOLD_MB * BYTES_PER_MB;

  let compressionFailed = false;
  if (shouldCompress) {
    try {
      const compressedUriRaw = await withTimeout(
        VideoCompressor.compress(workingUri, {compressionMethod: 'auto'}),
        VIDEO_COMPRESSION_TIMEOUT_MS,
        'compress_selected_video',
      );
      const compressedUri = ensureFileLikeUri(compressedUriRaw) ?? compressedUriRaw;
      const stagedCompressed = await withTimeout(
        prepareUploadableUri({
          uri: compressedUri,
          fileName: asset.fileName,
          mimeType: asset.type,
          fallbackExtension: 'mp4',
          preferStableCopy: true,
        }),
        MEDIA_PREPARE_TIMEOUT_MS,
        'stage_compressed_video',
      );
      if (workingUri !== stagedCompressed.uploadUri) {
        await safeUnlinkManagedMediaUri(workingUri);
      }
      workingUri = stagedCompressed.uploadUri;
      const compressedSizeBytes = await getFileSize(workingUri);
      if (compressedSizeBytes) {
        workingSizeBytes = compressedSizeBytes;
      }
      logger.log('[CreateDronePost] video compressed before upload', {
        originalSizeMb: bytesToMb(asset.fileSize),
        compressedSizeMb: bytesToMb(workingSizeBytes ?? undefined),
      });
    } catch (compressionError) {
      compressionFailed = true;
      logger.warn(
        '[CreateDronePost] video compression failed, keeping original',
        compressionError,
      );
    }
  }

  if (currentVideoUri && currentVideoUri !== workingUri) {
    await safeUnlinkManagedMediaUri(currentVideoUri);
  }
  if (!isMounted()) {
    await safeUnlinkManagedMediaUri(workingUri);
    throw new Error('video_selection_cancelled');
  }

  return {
    compressed: shouldCompress,
    compressionFailed,
    duration,
    sizeMb: bytesToMb(workingSizeBytes ?? undefined),
    videoName: asset.fileName ?? 'video.mp4',
    videoType: asset.type ?? 'video/mp4',
    videoUri: workingUri,
  };
};

export const publishCreateDronePost = async ({
  attempt,
  images,
  text,
  videoName,
  videoType,
  videoUri,
  isMounted,
  onProgressChange,
  onStageChange,
}: PublishCreateDronePostArgs): Promise<PublishCreateDronePostResult> => {
  const tempFilesToCleanup: string[] = [];
  let currentStep: CreateDronePostStep = 'upload_images';

  try {
    const uploadedImages: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      const prepared = await withTimeout(
        prepareUploadableUri({
          uri: image.uri,
          fileName: image.fileName,
          mimeType: image.type,
          fallbackExtension: 'jpg',
        }),
        MEDIA_PREPARE_TIMEOUT_MS,
        `prepare_image_${index + 1}`,
      );
      if (prepared.tempPath) {
        tempFilesToCleanup.push(prepared.tempPath);
      }

      const extension = getMediaExtension(image.fileName, image.type, 'jpg');
      const remoteUrl = await withTimeout(
        uploadFile(
          prepared.uploadUri,
          `drone_posts/${Date.now()}_${attempt}_${index}.${extension}`,
          image.type ? {contentType: image.type} : undefined,
        ),
        IMAGE_UPLOAD_TIMEOUT_MS,
        `upload_image_${index + 1}`,
      );
      uploadedImages.push(remoteUrl);
      logger.log('[CreateDronePost] image uploaded', {
        attempt,
        index: index + 1,
        total: images.length,
      });

      const maxImageProgress = videoUri ? 0.35 : 0.8;
      const imageProgress = images.length
        ? ((index + 1) / images.length) * maxImageProgress
        : maxImageProgress;
      if (isMounted()) {
        onProgressChange(imageProgress);
      }
    }

    let uploadedVideoUrl: string | undefined;
    if (videoUri) {
      currentStep = 'upload_video';
      if (isMounted()) {
        onStageChange('uploading');
      }

      const preparedVideo = await withTimeout(
        prepareUploadableUri({
          uri: videoUri,
          fileName: videoName,
          mimeType: videoType,
          fallbackExtension: 'mp4',
        }),
        MEDIA_PREPARE_TIMEOUT_MS,
        'prepare_video',
      );
      if (preparedVideo.tempPath) {
        tempFilesToCleanup.push(preparedVideo.tempPath);
      }

      const uploadResult = await uploadVideoToBunny({
        uri: preparedVideo.uploadUri,
        name: videoName ?? 'drone-post-video.mp4',
        contentType: videoType ?? 'video/mp4',
        title: text.trim() || videoName || 'drone-post-video',
        fallbackStoragePrefix: 'drone_posts',
        allowStorageFallback: false,
        onProgress: payload => {
          const ratio = payload.total > 0 ? payload.loaded / payload.total : 0;
          const bounded = Math.max(0, Math.min(1, ratio));
          if (!isMounted()) {
            return;
          }
          if (bounded >= SERVER_PROCESSING_RATIO_THRESHOLD) {
            onStageChange('processing');
          }
          onProgressChange(0.35 + bounded * 0.6);
        },
      });
      uploadedVideoUrl = uploadResult.playbackUrl;
      logger.log('[CreateDronePost] video uploaded', {attempt});
    } else if (!images.length && isMounted()) {
      onProgressChange(0.8);
    }

    currentStep = 'create_post';
    if (isMounted()) {
      onStageChange('processing');
      onProgressChange(0.96);
    }

    const created = await withTimeout(
      createDronePost({
        text: text.trim(),
        images: uploadedImages,
        videoUrl: uploadedVideoUrl,
        thumbnailUrl: uploadedImages[0] ?? undefined,
      }),
      CREATE_POST_TIMEOUT_MS,
      'create_post',
    );

    logger.log('[CreateDronePost] post created', {
      attempt,
      postId: created.id,
    });

    if (isMounted()) {
      onStageChange('published');
      onProgressChange(1);
    }

    return {
      createdPostId: created.id,
    };
  } catch (error) {
    (error as any).publishStep = currentStep;
    throw error;
  } finally {
    await cleanupTempFiles(tempFilesToCleanup);
  }
};
