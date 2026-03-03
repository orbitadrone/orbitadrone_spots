import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {launchImageLibrary, Asset, ImageLibraryOptions} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';
import {useFocusEffect} from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Video from 'react-native-video';
import RNFS from 'react-native-fs';

import {uploadFile} from '../../src/services/storageService';
import {uploadVideoToBunny} from '../../src/services/bunnyStreamService';
import {createDronePost} from '../../src/services/socialService';
import {palette, radii, shadows} from '../../src/constants/theme';
import {useAuthContext} from '../context/AuthContext';

const MAX_VIDEO_DURATION_SECONDS = 180;
const MAX_VIDEO_SIZE_MB = 200;
const MAX_IMAGES = 5;
const DRAFT_STORAGE_KEY = 'create_drone_post_draft_v1';
const IMAGE_UPLOAD_TIMEOUT_MS = 120000;
const MEDIA_PREPARE_TIMEOUT_MS = 15000;
const CREATE_POST_TIMEOUT_MS = 20000;
const PUBLISHED_STAGE_DELAY_MS = 300;

type LocalImageAsset = {
  uri: string;
  fileName?: string | null;
  type?: string | null;
};

type DraftPayload = {
  text: string;
  images: LocalImageAsset[];
  videoUri: string | null;
  videoName: string | null;
  videoType: string | null;
  updatedAt: number;
};

const bytesToMb = (bytes?: number) => {
  if (!bytes || bytes <= 0) {
    return 0;
  }
  return bytes / (1024 * 1024);
};

const normalizeErrorMessage = (error: unknown) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
};

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

const withTimeout = async <T,>(
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

const ensureFileLikeUri = (input: unknown): string | null => {
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

const getMediaExtension = (
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

const buildCacheFilePath = (prefix: string, extension: string) =>
  `${RNFS.CachesDirectoryPath}/${prefix}_${Date.now()}_${Math.floor(
    Math.random() * 1e6,
  )}.${extension}`;

const normalizeDraftImages = (value: unknown): LocalImageAsset[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.reduce<LocalImageAsset[]>((acc, item) => {
    if (typeof item === 'string' && item.trim()) {
      acc.push({uri: item.trim()});
      return acc;
    }
    if (item && typeof item === 'object' && typeof (item as any).uri === 'string') {
      acc.push({
        uri: (item as any).uri,
        fileName:
          typeof (item as any).fileName === 'string'
            ? (item as any).fileName
            : null,
        type: typeof (item as any).type === 'string' ? (item as any).type : null,
      });
    }
    return acc;
  }, []);
};

const prepareUploadableUri = async ({
  uri,
  fileName,
  mimeType,
  fallbackExtension,
}: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fallbackExtension: string;
}): Promise<{uploadUri: string; tempPath: string | null}> => {
  const normalizedUri = ensureFileLikeUri(uri);
  if (!normalizedUri) {
    throw new Error('Invalid media URI');
  }
  if (!normalizedUri.startsWith('content://')) {
    return {uploadUri: normalizedUri, tempPath: null};
  }

  const extension = getMediaExtension(fileName, mimeType, fallbackExtension);
  const localPath = buildCacheFilePath('create_drone_post', extension);
  await RNFS.copyFile(normalizedUri, localPath);
  return {uploadUri: `file://${localPath}`, tempPath: localPath};
};

const cleanupTempFiles = async (tempPaths: string[]) => {
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
        console.warn('[CreateDronePost] temp cleanup failed', cleanupError);
      }
    }),
  );
};

export default function CreateDronePostScreen({navigation}: {navigation: any}) {
  const {t} = useTranslation();
  const {user} = useAuthContext();

  const [text, setText] = useState('');
  const [images, setImages] = useState<LocalImageAsset[]>([]);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<string | null>(null);

  const [stage, setStage] = useState<'idle' | 'uploading' | 'processing' | 'published'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setSubmitting] = useState(false);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const publishAttemptRef = useRef(0);
  const bypassBeforeRemoveRef = useRef(false);

  const canSubmit = useMemo(
    () => Boolean(text.trim() || images.length || videoUri),
    [images.length, text, videoUri],
  );
  const hasDraftContent = canSubmit;

  const resetLocalForm = useCallback(() => {
    setText('');
    setImages([]);
    setVideoUri(null);
    setVideoName(null);
    setVideoType(null);
    setStage('idle');
    setUploadProgress(0);
    setLastErrorMessage(null);
  }, []);

  const clearDraftStorage = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
      console.warn('[CreateDronePost] clear draft failed', error);
    }
  }, []);

  const goToFeed = useCallback(
    (createdPostId?: string) => {
      bypassBeforeRemoveRef.current = true;
      navigation.navigate('Main', {
        screen: 'Feed',
        params: {
          refreshAt: Date.now(),
          createdPostId: createdPostId ?? null,
        },
      });
    },
    [navigation],
  );

  const safeGoBack = useCallback(() => {
    bypassBeforeRemoveRef.current = true;
    navigation.goBack();
  }, [navigation]);

  const confirmExit = useCallback(() => {
    if (isSubmitting) {
      Alert.alert(
        t('feed.uploadingInProgressTitle'),
        t('feed.uploadingInProgressMessage'),
      );
      return;
    }

    if (!hasDraftContent) {
      safeGoBack();
      return;
    }

    Alert.alert(t('feed.exitConfirmTitle'), t('feed.exitConfirmMessage'), [
      {
        text: t('feed.keepDraft'),
        onPress: safeGoBack,
      },
      {
        text: t('feed.discardDraft'),
        style: 'destructive',
        onPress: async () => {
          await clearDraftStorage();
          resetLocalForm();
          safeGoBack();
        },
      },
      {
        text: t('common.cancel'),
        style: 'cancel',
      },
    ]);
  }, [
    clearDraftStorage,
    hasDraftContent,
    isSubmitting,
    resetLocalForm,
    safeGoBack,
    t,
  ]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (bypassBeforeRemoveRef.current) {
        bypassBeforeRemoveRef.current = false;
        return;
      }
      event.preventDefault();
      confirmExit();
    });

    return unsubscribe;
  }, [confirmExit, navigation]);

  useFocusEffect(
    useCallback(() => {
      const onHardwareBack = () => {
        confirmExit();
        return true;
      };
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onHardwareBack,
      );
      return () => {
        subscription.remove();
      };
    }, [confirmExit]),
  );

  useEffect(() => {
    let cancelled = false;
    const restoreDraft = async () => {
      try {
        const rawDraft = await AsyncStorage.getItem(DRAFT_STORAGE_KEY);
        if (!rawDraft) {
          return;
        }
        const draft = JSON.parse(rawDraft) as DraftPayload;
        if (cancelled) {
          return;
        }
        setText(typeof draft.text === 'string' ? draft.text : '');
        const restoredImages = normalizeDraftImages(draft.images);
        setImages(restoredImages);
        setVideoUri(typeof draft.videoUri === 'string' ? draft.videoUri : null);
        setVideoName(typeof draft.videoName === 'string' ? draft.videoName : null);
        setVideoType(typeof draft.videoType === 'string' ? draft.videoType : null);
        console.log('[CreateDronePost] draft restored', {
          imageCount: restoredImages.length,
          hasVideo: Boolean(draft.videoUri),
          textLength: typeof draft.text === 'string' ? draft.text.length : 0,
        });
      } catch (error) {
        console.warn('[CreateDronePost] restore draft failed', error);
      } finally {
        if (!cancelled) {
          setDraftLoaded(true);
        }
      }
    };

    restoreDraft();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draftLoaded || isSubmitting) {
      return;
    }

    const persistDraft = async () => {
      try {
        if (!hasDraftContent) {
          await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
          return;
        }
        const payload: DraftPayload = {
          text,
          images,
          videoUri,
          videoName,
          videoType,
          updatedAt: Date.now(),
        };
        await AsyncStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
      } catch (error) {
        console.warn('[CreateDronePost] persist draft failed', error);
      }
    };

    persistDraft();
  }, [
    draftLoaded,
    hasDraftContent,
    images,
    isSubmitting,
    text,
    videoName,
    videoType,
    videoUri,
  ]);

  const pickImages = async () => {
    if (isSubmitting) {
      return;
    }
    const remaining = Math.max(0, MAX_IMAGES - images.length);
    if (!remaining) {
      Alert.alert(t('alerts.attention'), t('addSpot.galleryLimitReached'));
      return;
    }

    const options: ImageLibraryOptions = {
      mediaType: 'photo',
      selectionLimit: remaining,
      quality: 0.8,
    };

    launchImageLibrary(options, response => {
      if (response.errorCode) {
        Alert.alert(t('alerts.error'), response.errorMessage || t('alerts.imagePickerError'));
        return;
      }
      if (response.didCancel || !response.assets?.length) {
        return;
      }
      const nextImages = response.assets
        .map(asset => {
          if (!asset.uri) {
            return null;
          }
          return {
            uri: asset.uri,
            fileName: asset.fileName ?? null,
            type: asset.type ?? null,
          } as LocalImageAsset;
        })
        .filter((item): item is LocalImageAsset => Boolean(item));
      if (!nextImages.length) {
        return;
      }
      console.log('[CreateDronePost] images selected', {
        selected: nextImages.length,
      });
      setImages(prev => [...prev, ...nextImages].slice(0, MAX_IMAGES));
    });
  };

  const pickVideo = async () => {
    if (isSubmitting) {
      return;
    }
    const options: ImageLibraryOptions = {
      mediaType: 'video',
      selectionLimit: 1,
      videoQuality: 'medium',
    };

    launchImageLibrary(options, response => {
      if (response.errorCode) {
        Alert.alert(t('alerts.error'), response.errorMessage || t('alerts.imagePickerError'));
        return;
      }
      if (response.didCancel || !response.assets?.length) {
        return;
      }

      const asset = response.assets[0] as Asset;
      const uri = asset?.uri;
      if (!uri) {
        return;
      }

      const duration = Number(asset.duration ?? 0);
      if (duration > MAX_VIDEO_DURATION_SECONDS) {
        Alert.alert(
          t('addSpot.videoTooLongTitle'),
          t('addSpot.videoTooLongMessage', {
            maxDuration: MAX_VIDEO_DURATION_SECONDS,
          }),
        );
        return;
      }

      const sizeMb = bytesToMb(asset.fileSize);
      if (sizeMb > MAX_VIDEO_SIZE_MB) {
        Alert.alert(
          t('addSpot.videoTooLargeTitle'),
          t('addSpot.videoTooLargeMessage', {
            maxSize: MAX_VIDEO_SIZE_MB,
          }),
        );
        return;
      }

      setVideoUri(uri);
      setVideoName(asset.fileName ?? 'video.mp4');
      setVideoType(asset.type ?? 'video/mp4');
      console.log('[CreateDronePost] video selected', {
        duration,
        sizeMb,
      });
    });
  };

  const handlePublish = async () => {
    if (isSubmitting) {
      return;
    }
    if (!canSubmit) {
      Alert.alert(t('alerts.attention'), t('feed.postNeedsContent'));
      return;
    }
    if (!user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }

    publishAttemptRef.current += 1;
    const attempt = publishAttemptRef.current;
    console.log('[CreateDronePost] publish start', {
      attempt,
      imageCount: images.length,
      hasVideo: Boolean(videoUri),
      textLength: text.trim().length,
    });

    setLastErrorMessage(null);
    setSubmitting(true);
    setUploadProgress(0);
    setStage('uploading');

    const tempFilesToCleanup: string[] = [];
    let currentStep: 'upload_images' | 'upload_video' | 'create_post' = 'upload_images';

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
        console.log('[CreateDronePost] image uploaded', {
          attempt,
          index: index + 1,
          total: images.length,
        });
        const maxImageProgress = videoUri ? 0.35 : 0.8;
        const imageProgress = images.length
          ? ((index + 1) / images.length) * maxImageProgress
          : maxImageProgress;
        setUploadProgress(imageProgress);
      }

      let uploadedVideoUrl: string | undefined;
      if (videoUri) {
        currentStep = 'upload_video';
        setStage('uploading');
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
          onProgress: payload => {
            const ratio = payload.total > 0 ? payload.loaded / payload.total : 0;
            const bounded = Math.max(0, Math.min(1, ratio));
            setUploadProgress(0.35 + bounded * 0.6);
          },
        });
        uploadedVideoUrl = uploadResult.playbackUrl;
        console.log('[CreateDronePost] video uploaded', {attempt});
      } else if (!images.length) {
        setUploadProgress(0.8);
      }

      currentStep = 'create_post';
      setStage('processing');
      setUploadProgress(0.96);
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
      console.log('[CreateDronePost] post created', {
        attempt,
        postId: created.id,
      });

      setStage('published');
      setUploadProgress(1);
      await clearDraftStorage();
      resetLocalForm();
      await sleep(PUBLISHED_STAGE_DELAY_MS);
      goToFeed(created.id);
    } catch (publishError) {
      console.error('[CreateDronePost] publish failed', {
        step: currentStep,
        error: publishError,
      });
      const errorCode = String((publishError as any)?.code ?? '').toLowerCase();
      const errorStatus = Number((publishError as any)?.status ?? 0);
      const rawMessage = normalizeErrorMessage(publishError).toLowerCase();
      const isAuthError =
        errorStatus === 401 ||
        errorStatus === 403 ||
        errorCode.includes('auth') ||
        rawMessage.includes('usuario no autenticado') ||
        rawMessage.includes('unauth');
      const isUploadError =
        currentStep !== 'create_post' ||
        errorCode.includes('bunny/') ||
        rawMessage.includes('bunny') ||
        rawMessage.includes('upload') ||
        rawMessage.includes('storage') ||
        rawMessage.includes('timeout');
      const message = isAuthError
        ? t('alerts.reauthFailedError')
        : isUploadError
          ? t('alerts.videoUploadError')
          : t('feed.postPublishError');
      console.warn('[CreateDronePost] publish error classified', {
        step: currentStep,
        errorCode,
        errorStatus,
        isAuthError,
        isUploadError,
      });
      setLastErrorMessage(message);
      Alert.alert(t('alerts.error'), message);
      setStage('idle');
    } finally {
      setSubmitting(false);
      await cleanupTempFiles(tempFilesToCleanup);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={confirmExit}>
          <Icon name="arrow-left" size={24} color={palette.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('feed.publishDronePost')}</Text>
        <TouchableOpacity
          style={[styles.publishButton, (!canSubmit || isSubmitting) && styles.publishButtonDisabled]}
          disabled={!canSubmit || isSubmitting}
          onPress={handlePublish}>
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.publishButtonText}>{t('feed.publish')}</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <TextInput
          style={styles.input}
          placeholder={t('feed.postTextPlaceholder')}
          placeholderTextColor={palette.textMuted}
          multiline
          value={text}
          onChangeText={setText}
        />

        <View style={styles.actionsRow}>
          <TouchableOpacity style={styles.actionButton} onPress={pickImages}>
            <Icon name="image-plus" size={20} color={palette.highlight} />
            <Text style={styles.actionButtonText}>{t('feed.addPhotos')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={pickVideo}>
            <Icon name="video-plus" size={20} color={palette.highlight} />
            <Text style={styles.actionButtonText}>{t('feed.addVideo')}</Text>
          </TouchableOpacity>
        </View>

        {images.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaRow}>
            {images.map((asset, index) => (
              <View key={`${asset.uri}-${index}`} style={styles.imageWrap}>
                <Image source={{uri: asset.uri}} style={styles.image} />
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => {
                    setImages(prev => prev.filter((_, currentIndex) => currentIndex !== index));
                  }}>
                  <Icon name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {videoUri ? (
          <>
            <View style={styles.videoPreviewWrap}>
              <Video
                source={{uri: videoUri}}
                style={styles.videoPreview}
                resizeMode="cover"
                paused
                muted
                controls={false}
              />
              <View style={styles.videoPreviewPill}>
                <Icon name="play-circle" size={18} color="#fff" />
                <Text style={styles.videoPreviewPillText}>{t('feed.video')}</Text>
              </View>
            </View>
            <View style={styles.videoCard}>
              <Icon name="play-circle" size={20} color={palette.highlight} />
              <View style={styles.videoInfo}>
                <Text style={styles.videoName}>{videoName || 'video.mp4'}</Text>
                <Text style={styles.videoHint}>{t('feed.oneVideoLimit')}</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setVideoUri(null);
                  setVideoName(null);
                  setVideoType(null);
                }}>
                <Icon name="delete-outline" size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {isSubmitting ? (
          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>{t(`feed.uploadState.${stage}`)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, {width: `${Math.round(uploadProgress * 100)}%`}]} />
            </View>
            <Text style={styles.uploadProgressText}>{Math.round(uploadProgress * 100)}%</Text>
          </View>
        ) : null}

        {lastErrorMessage && !isSubmitting ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{lastErrorMessage}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handlePublish}>
              <Text style={styles.retryButtonText}>{t('feed.retry')}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f6fb',
  },
  header: {
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#e5eaf4',
  },
  title: {
    flex: 1,
    marginHorizontal: 10,
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  publishButton: {
    backgroundColor: palette.highlight,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 74,
    alignItems: 'center',
  },
  publishButtonDisabled: {
    opacity: 0.5,
  },
  publishButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: radii.md,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: palette.textPrimary,
    textAlignVertical: 'top',
    fontSize: 14,
    ...shadows.subtle,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  actionButtonText: {
    color: palette.textSecondary,
    fontWeight: '600',
  },
  mediaRow: {
    marginTop: 2,
  },
  imageWrap: {
    marginRight: 8,
    position: 'relative',
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 10,
  },
  removeButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 10,
  },
  videoPreviewWrap: {
    position: 'relative',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    height: 180,
  },
  videoPreview: {
    width: '100%',
    height: '100%',
  },
  videoPreviewPill: {
    position: 'absolute',
    left: 10,
    top: 10,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  videoPreviewPillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  videoInfo: {
    flex: 1,
  },
  videoName: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  videoHint: {
    color: palette.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  uploadCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    padding: 10,
  },
  uploadTitle: {
    color: palette.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: palette.highlight,
  },
  uploadProgressText: {
    marginTop: 6,
    color: palette.textMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  errorCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    backgroundColor: '#fff1f2',
    padding: 10,
    gap: 8,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 13,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: palette.highlight,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
});
