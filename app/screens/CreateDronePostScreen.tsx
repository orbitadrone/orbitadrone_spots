import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Platform,
  ScrollView,
  StatusBar,
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
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import {palette, radii, shadows} from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import {useAuthContext} from '../context/AuthContext';
import {
  bytesToMb,
  DRAFT_STORAGE_KEY,
  DraftPayload,
  LocalImageAsset,
  MAX_IMAGES,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_SIZE_MB,
  PUBLISHED_STAGE_DELAY_MS,
  doesFileUriExist,
  normalizeDraftImages,
  safeUnlinkManagedMediaUri,
  sleep,
} from '../features/createDronePost/createDronePostShared';
import {
  CreateDronePostStep,
  classifyCreateDronePostError,
  prepareSelectedVideoAsset,
  publishCreateDronePost,
} from '../features/createDronePost/createDronePostPublishing';
import type {AppStackScreenProps} from '../../src/navigation/types';

export default function CreateDronePostScreen({
  navigation,
}: AppStackScreenProps<'CreateDronePost'>) {
  const {t} = useTranslation();
  const {user} = useAuthContext();
  const insets = useSafeAreaInsets();
  const topInset =
    insets.top > 0
      ? insets.top
      : Platform.OS === 'android'
        ? (StatusBar.currentHeight ?? 0)
        : 0;

  const [text, setText] = useState('');
  const [images, setImages] = useState<LocalImageAsset[]>([]);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<string | null>(null);

  const [stage, setStage] = useState<'idle' | 'uploading' | 'processing' | 'published'>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isPreparingVideo, setPreparingVideo] = useState(false);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  const publishAttemptRef = useRef(0);
  const bypassBeforeRemoveRef = useRef(false);
  const isMountedRef = useRef(true);

  const canSubmit = useMemo(
    () => Boolean(text.trim() || images.length || videoUri),
    [images.length, text, videoUri],
  );
  const hasDraftContent = canSubmit;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const resetLocalForm = useCallback(() => {
    const currentVideoUri = videoUri;
    setText('');
    setImages([]);
    setVideoUri(null);
    setVideoName(null);
    setVideoType(null);
    setStage('idle');
    setUploadProgress(0);
    setPreparingVideo(false);
    setLastErrorMessage(null);
    safeUnlinkManagedMediaUri(currentVideoUri);
  }, [videoUri]);

  const clearDraftStorage = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
      logger.warn('[CreateDronePost] clear draft failed', error);
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

  const continueUploadInBackground = useCallback(() => {
    if (!isSubmitting) {
      safeGoBack();
      return;
    }
    bypassBeforeRemoveRef.current = true;
    navigation.goBack();
  }, [isSubmitting, navigation, safeGoBack]);

  const confirmExit = useCallback(() => {
    if (isPreparingVideo) {
      Alert.alert(t('alerts.attention'), t('feed.videoPreparingMessage'));
      return;
    }

    if (isSubmitting) {
      Alert.alert(
        t('feed.uploadingInProgressTitle'),
        t('feed.backgroundUploadMessage'),
        [
          {
            text: t('feed.stayInEditor'),
            style: 'cancel',
          },
          {
            text: t('feed.continueInBackground'),
            onPress: continueUploadInBackground,
          },
        ],
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
    isPreparingVideo,
    isSubmitting,
    resetLocalForm,
    safeGoBack,
    continueUploadInBackground,
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
        const restoredVideoUri = typeof draft.videoUri === 'string' ? draft.videoUri : null;
        let safeVideoUri = restoredVideoUri;
        if (restoredVideoUri && restoredVideoUri.startsWith('file://')) {
          const exists = await doesFileUriExist(restoredVideoUri);
          if (!exists) {
            logger.warn('[CreateDronePost] restored video file missing, clearing draft video');
            safeVideoUri = null;
          }
        }
        setVideoUri(safeVideoUri);
        setVideoName(
          safeVideoUri && typeof draft.videoName === 'string' ? draft.videoName : null,
        );
        setVideoType(
          safeVideoUri && typeof draft.videoType === 'string' ? draft.videoType : null,
        );
        logger.log('[CreateDronePost] draft restored', {
          imageCount: restoredImages.length,
          hasVideo: Boolean(safeVideoUri),
          textLength: typeof draft.text === 'string' ? draft.text.length : 0,
        });
      } catch (error) {
        logger.warn('[CreateDronePost] restore draft failed', error);
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
    if (!draftLoaded || isSubmitting || isPreparingVideo) {
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
        logger.warn('[CreateDronePost] persist draft failed', error);
      }
    };

    persistDraft();
  }, [
    draftLoaded,
    hasDraftContent,
    images,
    isPreparingVideo,
    isSubmitting,
    text,
    videoName,
    videoType,
    videoUri,
  ]);

  const clearSelectedVideo = useCallback(() => {
    const currentVideoUri = videoUri;
    setVideoUri(null);
    setVideoName(null);
    setVideoType(null);
    safeUnlinkManagedMediaUri(currentVideoUri);
  }, [videoUri]);

  const pickImages = async () => {
    if (isSubmitting || isPreparingVideo) {
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
      logger.log('[CreateDronePost] images selected', {
        selected: nextImages.length,
      });
      setImages(prev => [...prev, ...nextImages].slice(0, MAX_IMAGES));
    });
  };

  const pickVideo = async () => {
    if (isSubmitting || isPreparingVideo) {
      return;
    }
    const options: ImageLibraryOptions = {
      mediaType: 'video',
      selectionLimit: 1,
      videoQuality: 'medium',
    };

    launchImageLibrary(options, async response => {
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

      setPreparingVideo(true);
      try {
        const preparedVideo = await prepareSelectedVideoAsset({
          asset,
          currentVideoUri: videoUri,
          isMounted: () => isMountedRef.current,
        });
        if (preparedVideo.compressionFailed) {
          Alert.alert(t('alerts.attention'), t('alerts.videoCompressErrorMessage'));
        }
        setVideoUri(preparedVideo.videoUri);
        setVideoName(preparedVideo.videoName);
        setVideoType(preparedVideo.videoType);
        logger.log('[CreateDronePost] video selected', {
          duration: preparedVideo.duration,
          sizeMb: preparedVideo.sizeMb,
          staged: preparedVideo.videoUri.startsWith('file://'),
          compressed: preparedVideo.compressed,
        });
      } catch (selectionError) {
        if ((selectionError as Error).message === 'video_selection_cancelled') {
          return;
        }
        if ((selectionError as Error).message === 'selected_video_too_large') {
          Alert.alert(
            t('addSpot.videoTooLargeTitle'),
            t('addSpot.videoTooLargeMessage', {
              maxSize: MAX_VIDEO_SIZE_MB,
            }),
          );
          return;
        }
        logger.error('[CreateDronePost] video staging failed', selectionError);
        Alert.alert(t('alerts.error'), t('alerts.videoCompressErrorMessage'));
      } finally {
        if (isMountedRef.current) {
          setPreparingVideo(false);
        }
      }
    });
  };

  const handlePublish = async () => {
    if (isSubmitting || isPreparingVideo) {
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
    const selectedVideoUri = videoUri;
    const setIfMounted = (apply: () => void) => {
      if (isMountedRef.current) {
        apply();
      }
    };
    logger.log('[CreateDronePost] publish start', {
      attempt,
      imageCount: images.length,
      hasVideo: Boolean(videoUri),
      textLength: text.trim().length,
    });

    setIfMounted(() => {
      setLastErrorMessage(null);
      setSubmitting(true);
      setUploadProgress(0);
      setStage('uploading');
    });

    try {
      const result = await publishCreateDronePost({
        attempt,
        images,
        text,
        videoName,
        videoType,
        videoUri,
        isMounted: () => isMountedRef.current,
        onProgressChange: progress => {
          setIfMounted(() => {
            setUploadProgress(progress);
          });
        },
        onStageChange: nextStage => {
          setIfMounted(() => {
            setStage(nextStage);
          });
        },
      });

      await clearDraftStorage();
      if (isMountedRef.current) {
        resetLocalForm();
        await sleep(PUBLISHED_STAGE_DELAY_MS);
        goToFeed(result.createdPostId);
      } else {
        await safeUnlinkManagedMediaUri(selectedVideoUri);
        Alert.alert(t('alerts.success'), t('feed.postPublishedBackground'));
      }
    } catch (publishError) {
      const currentStep = ((publishError as any)?.publishStep ??
        'create_post') as CreateDronePostStep;
      logger.error('[CreateDronePost] publish failed', {
        step: currentStep,
        error: publishError,
      });
      const errorKind = classifyCreateDronePostError({
        error: publishError,
        step: currentStep,
      });
      const message =
        errorKind === 'storage_permission' || errorKind === 'network_upload'
          ? t('alerts.videoUploadError')
          : errorKind === 'auth'
            ? t('alerts.reauthFailedError')
            : t('feed.postPublishError');
      logger.warn('[CreateDronePost] publish error classified', {
        step: currentStep,
        errorKind,
      });
      setIfMounted(() => {
        setLastErrorMessage(message);
      });
      Alert.alert(t('alerts.error'), message);
      setIfMounted(() => {
        setStage('idle');
      });
    } finally {
      setIfMounted(() => {
        setSubmitting(false);
      });
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: topInset + 10}]}>
        <TouchableOpacity onPress={confirmExit}>
          <Icon name="arrow-left" size={24} color={palette.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('feed.publishDronePost')}</Text>
        <TouchableOpacity
          style={[
            styles.publishButton,
            (!canSubmit || isSubmitting || isPreparingVideo) && styles.publishButtonDisabled,
          ]}
          disabled={!canSubmit || isSubmitting || isPreparingVideo}
          onPress={handlePublish}>
          {isSubmitting || isPreparingVideo ? (
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
          <TouchableOpacity
            style={[
              styles.actionButton,
              (isSubmitting || isPreparingVideo) && styles.actionButtonDisabled,
            ]}
            disabled={isSubmitting || isPreparingVideo}
            onPress={pickImages}>
            <Icon name="image-plus" size={20} color={palette.highlight} />
            <Text style={styles.actionButtonText}>{t('feed.addPhotos')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.actionButton,
              (isSubmitting || isPreparingVideo) && styles.actionButtonDisabled,
            ]}
            disabled={isSubmitting || isPreparingVideo}
            onPress={pickVideo}>
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
                  disabled={isSubmitting || isPreparingVideo}
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
                disabled={isSubmitting || isPreparingVideo}
                onPress={clearSelectedVideo}>
                <Icon name="delete-outline" size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {isPreparingVideo ? (
          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>{t('addSpot.compressingVideo')}</Text>
            <ActivityIndicator size="small" color={palette.highlight} />
            <Text style={styles.uploadHintText}>{t('feed.videoPreparationHint')}</Text>
          </View>
        ) : null}

        {isSubmitting ? (
          <View style={styles.uploadCard}>
            <Text style={styles.uploadTitle}>{t(`feed.uploadState.${stage}`)}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, {width: `${Math.round(uploadProgress * 100)}%`}]} />
            </View>
            <Text style={styles.uploadProgressText}>{Math.round(uploadProgress * 100)}%</Text>
            <TouchableOpacity style={styles.backgroundButton} onPress={continueUploadInBackground}>
              <Icon name="arrow-collapse-down" size={16} color={palette.textSecondary} />
              <Text style={styles.backgroundButtonText}>{t('feed.continueInBackground')}</Text>
            </TouchableOpacity>
            <Text style={styles.uploadHintText}>{t('feed.backgroundUploadHint')}</Text>
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
  actionButtonDisabled: {
    opacity: 0.5,
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
  backgroundButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#f8fafc',
  },
  backgroundButtonText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  uploadHintText: {
    marginTop: 8,
    color: palette.textMuted,
    fontSize: 12,
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
