import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  PanResponder,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewToken,
  View,
} from 'react-native';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import {useIsFocused, useNavigation, useRoute} from '@react-navigation/native';
import {BannerAd, BannerAdSize} from 'react-native-google-mobile-ads';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {useAuthContext} from '../context/AuthContext';
import {useAds} from '../context/AdContext';
import {useMap} from '../context/MapContext';
import FeedPostCard from '../components/FeedPostCard';
import {
  Spot,
  Review,
  addReview,
  getReviewsForSpot,
} from '../../src/services/firestoreService';
import {
  PostComment,
  SocialPost,
  addPostComment,
  getPostComments,
  getSpotPostDocId,
  submitContentReport,
  togglePostLike,
} from '../../src/services/socialService';
import {joinPublicEvent} from '../../src/services/eventService';
import {feedBannerAdUnitId} from '../../src/constants/adUnits';
import {
  buildGoogleMapsDirectionsUrl,
  buildEventShareUrl,
  buildPostShareUrl,
  buildSpotShareUrl,
  PLAY_STORE_URL,
} from '../../src/constants/links';
import {palette, shadows} from '../../src/constants/theme';
import {adsDiagnosticsService} from '../../src/services/adsDiagnosticsService';
import logger from '../../src/utils/logger';
import {useFeedContent} from '../features/feed/useFeedContent';
import {
  ActiveLayer,
  FEED_AD_FREQUENCY,
  FEED_AUTOPLAY_CLEAR_DELAY_MS,
  FEED_AUTOPLAY_SWITCH_DELAY_MS,
  FEED_MEDIA_MIN_HEIGHT,
  FEED_POST_PREFETCH_DELAY_MS,
  FEED_POST_PREFETCH_WINDOW,
  FEED_VIDEO_MIN_PREFETCH_ROWS,
  FEED_VIDEO_PROBE_AHEAD,
  FEED_VIDEO_WARMUP_RANGE_LAST_BYTE,
  FEED_VIDEO_WARMUP_TIMEOUT_MS,
  FeedRow,
  FeedTab,
  SHEET_MAX_HEIGHT,
  SHEET_MID_HEIGHT,
  SHEET_MIN_HEIGHT,
  SHEET_PEEK_THRESHOLD,
  UnifiedPost,
  buildInlineBunnyIframeHtml,
  calculateDistanceKm,
  getBunnyEmbedForVideoUrl,
  getFeedVideoHeight,
  getFeedVideoPlaybackHeight,
  getMeasuredVideoAspectRatio,
  getOrderedViewablePostIds,
  getOrderedViewableVideoPostIds,
  getSpotCoordinates,
  getTargetVisibleRowsForPostWindow,
  getTimestampMillis,
  getVideoPreviewImage,
  pickWarmupVideoUrl,
} from '../features/feed/feedShared';
import {
  buildVideoSourceCandidates,
} from '../../src/utils/videoPlayback';
import type {MainTabScreenNavigationProp, MainTabScreenProps} from '../../src/navigation/types';

const FeedAdCard = ({label}: {label: string}) => {
  useEffect(() => {
    adsDiagnosticsService.recordLoadRequested('feedBanner');
  }, []);

  return (
    <View style={styles.adCard}>
      <Text style={styles.adLabel}>{label}</Text>
      <BannerAd
        unitId={feedBannerAdUnitId}
        size={BannerAdSize.FULL_BANNER}
        requestOptions={{requestNonPersonalizedAdsOnly: true}}
        onAdLoaded={() => {
          adsDiagnosticsService.recordLoaded('feedBanner');
          logger.info('[Ads][FeedBanner] loaded');
        }}
        onAdFailedToLoad={error => {
          adsDiagnosticsService.recordFailed('feedBanner', error);
          logger.warn('[Ads][FeedBanner] failed to load', error);
        }}
        onAdOpened={() => {
          adsDiagnosticsService.recordShown('feedBanner');
        }}
      />
    </View>
  );
};

export default function FeedScreen() {
  const navigation = useNavigation<MainTabScreenNavigationProp<'Feed'>>();
  const route = useRoute<MainTabScreenProps<'Feed'>['route']>();
  const isScreenFocused = useIsFocused();
  const {t} = useTranslation();
  const {user, loading: authLoading} = useAuthContext();
  const {areAdsDisabled} = useAds();
  const {region: mapRegion, setRegion: setMapRegion} = useMap();

  const mapRef = useRef<MapView | null>(null);
  const feedListRef = useRef<FlatList<FeedRow> | null>(null);
  const routeRefreshHandledRef = useRef<number | null>(null);
  const routeRefreshRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFocusedPostIdRef = useRef<string | null>(null);

  const [activeLayer, setActiveLayer] = useState<ActiveLayer>('feed');
  const [feedTab, setFeedTab] = useState<FeedTab>('all');

  const [inlineCommentDrafts, setInlineCommentDrafts] = useState<Record<string, string>>({});
  const [savingCommentByPostId, setSavingCommentByPostId] = useState<Record<string, boolean>>({});
  const [savingRatingBySpotId, setSavingRatingBySpotId] = useState<Record<string, boolean>>({});
  const [savingLikeByPostId, setSavingLikeByPostId] = useState<Record<string, boolean>>({});
  const [playingVideoPostId, setPlayingVideoPostId] = useState<string | null>(null);
  const [videoPrefetchAnchorPostId, setVideoPrefetchAnchorPostId] = useState<string | null>(null);
  const [viewableVideoPostIds, setViewableVideoPostIds] = useState<string[]>([]);
  const [bufferingVideoByPostId, setBufferingVideoByPostId] = useState<Record<string, boolean>>({});
  const [videoSourceByPostId, setVideoSourceByPostId] = useState<
    Record<string, {url: string; fallbackUrls: string[]}>
  >({});
  const [forceBunnyEmbedByPostId, setForceBunnyEmbedByPostId] = useState<Record<string, boolean>>(
    {},
  );
  const [videoAspectRatioByPostId, setVideoAspectRatioByPostId] = useState<Record<string, number>>(
    {},
  );

  const [expandedTextByPostId, setExpandedTextByPostId] = useState<Record<string, boolean>>({});
  const [visibleRows, setVisibleRows] = useState(12);
  const [isPeekMode, setIsPeekMode] = useState(false);

  const [highlightedSpotId, setHighlightedSpotId] = useState<string | null>(null);
  const [reportSubmittingForPostId, setReportSubmittingForPostId] = useState<
    Record<string, boolean>
  >({});
  const [joiningEventByPostId, setJoiningEventByPostId] = useState<Record<string, boolean>>({});
  const [commentsModalPostId, setCommentsModalPostId] = useState<string | null>(null);
  const playingVideoPostIdRef = useRef<string | null>(null);
  const viewableVideoPostIdsRef = useRef<string[]>([]);
  const prefetchedVideoPostIdsRef = useRef<Record<string, true>>({});
  const warmingVideoPostIdsRef = useRef<Record<string, true>>({});
  const probedVideoPreviewByPostIdRef = useRef<Record<string, boolean>>({});
  const playbackSwitchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefetchBatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandedSheetForMediaRef = useRef(false);

  const canRenderFeedContent = isScreenFocused && activeLayer === 'feed' && !isPeekMode;
  const {
    currentLocation,
    error,
    isPostVisible,
    likeCountByPostId,
    likedByCurrentUser,
    loading,
    postCommentsByPostId,
    profilesByUserId,
    refreshContent,
    refreshing,
    setLikeCountByPostId,
    setLikedByCurrentUser,
    setPostCommentsByPostId,
    setSpotReviewsBySpotId,
    socialPosts,
    spotReviewsBySpotId,
    spots,
  } = useFeedContent({
    authLoading,
    userId: user?.uid,
    loadErrorMessage: t('feed.errorLoad'),
  });

  const setMeasuredVideoAspectRatio = useCallback(
    (postId: string, widthValue: unknown, heightValue: unknown) => {
      const nextRatio = getMeasuredVideoAspectRatio(widthValue, heightValue);
      if (!nextRatio) {
        return;
      }
      setVideoAspectRatioByPostId(previous => {
        const existing = previous[postId];
        if (existing && Math.abs(existing - nextRatio) < 0.02) {
          return previous;
        }
        return {
          ...previous,
          [postId]: nextRatio,
        };
      });
    },
    [],
  );

  useEffect(() => {
    playingVideoPostIdRef.current = playingVideoPostId;
  }, [playingVideoPostId]);

  useEffect(() => {
    viewableVideoPostIdsRef.current = viewableVideoPostIds;
  }, [viewableVideoPostIds]);

  const syncViewableVideoPostIds = useCallback((nextPostIds: string[]) => {
    setViewableVideoPostIds(previous => {
      if (previous.length === nextPostIds.length && previous.every((postId, index) => postId === nextPostIds[index])) {
        return previous;
      }
      return nextPostIds;
    });
  }, []);

  const syncVideoPrefetchAnchorPostId = useCallback((nextPostId: string | null) => {
    setVideoPrefetchAnchorPostId(previous => (previous === nextPostId ? previous : nextPostId));
  }, []);

  const setVideoBufferingState = useCallback((postId: string, isBuffering: boolean) => {
    setBufferingVideoByPostId(previous => {
      const current = Boolean(previous[postId]);
      if (current === isBuffering) {
        return previous;
      }
      if (isBuffering) {
        return {
          ...previous,
          [postId]: true,
        };
      }
      if (!current) {
        return previous;
      }
      const next = {...previous};
      delete next[postId];
      return next;
    });
  }, []);

  const clearScheduledPlaybackSwitch = useCallback(() => {
    if (playbackSwitchTimeoutRef.current) {
      clearTimeout(playbackSwitchTimeoutRef.current);
      playbackSwitchTimeoutRef.current = null;
    }
  }, []);

  const clearPrefetchBatchTimeout = useCallback(() => {
    if (prefetchBatchTimeoutRef.current) {
      clearTimeout(prefetchBatchTimeoutRef.current);
      prefetchBatchTimeoutRef.current = null;
    }
  }, []);

  const schedulePlayingVideo = useCallback(
    (nextPostId: string | null, delayMs = 0) => {
      clearScheduledPlaybackSwitch();
      const commit = () => {
        if (playingVideoPostIdRef.current !== nextPostId) {
          setPlayingVideoPostId(nextPostId);
        }
      };
      if (delayMs <= 0) {
        commit();
        return;
      }
      playbackSwitchTimeoutRef.current = setTimeout(() => {
        playbackSwitchTimeoutRef.current = null;
        commit();
      }, delayMs);
    },
    [clearScheduledPlaybackSwitch],
  );

  useEffect(() => () => {
    clearScheduledPlaybackSwitch();
  }, [clearScheduledPlaybackSwitch]);

  useEffect(() => () => {
    clearPrefetchBatchTimeout();
  }, [clearPrefetchBatchTimeout]);

  useEffect(() => {
    if (!isScreenFocused) {
      schedulePlayingVideo(null, 0);
      setCommentsModalPostId(null);
    }
  }, [isScreenFocused, schedulePlayingVideo]);

  const sheetHeight = useRef(new Animated.Value(SHEET_MID_HEIGHT)).current;
  const sheetHeightValueRef = useRef(SHEET_MID_HEIGHT);
  const panStartHeightRef = useRef(SHEET_MID_HEIGHT);

  const heartScalesRef = useRef<Record<string, Animated.Value>>({});

  useEffect(() => {
    const subscription = sheetHeight.addListener(({value}) => {
      sheetHeightValueRef.current = value;
      const nextPeekMode = value <= SHEET_PEEK_THRESHOLD;
      setIsPeekMode(prev => (prev === nextPeekMode ? prev : nextPeekMode));
      const nextLayer: ActiveLayer = nextPeekMode ? 'map' : 'feed';
      setActiveLayer(prev => (prev === nextLayer ? prev : nextLayer));
    });
    return () => {
      sheetHeight.removeListener(subscription);
    };
  }, [sheetHeight]);

  const getHeartScale = useCallback((postId: string) => {
    if (!heartScalesRef.current[postId]) {
      heartScalesRef.current[postId] = new Animated.Value(1);
    }
    return heartScalesRef.current[postId];
  }, []);

  const animateSheetTo = useCallback((targetHeight: number) => {
    Animated.spring(sheetHeight, {
      toValue: targetHeight,
      useNativeDriver: false,
      damping: 18,
      stiffness: 160,
      mass: 0.8,
    }).start();
  }, [sheetHeight]);

  const switchToFeedLayer = useCallback(() => {
    setActiveLayer('feed');
    animateSheetTo(SHEET_MID_HEIGHT);
  }, [animateSheetTo]);

  const switchToMapTab = useCallback(() => {
    requestAnimationFrame(() => {
      navigation.navigate('Map');
    });
  }, [navigation]);

  const switchToMapLayer = useCallback(() => {
    setActiveLayer('map');
    animateSheetTo(SHEET_MIN_HEIGHT);
  }, [animateSheetTo]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 8,
        onPanResponderGrant: () => {
          panStartHeightRef.current = sheetHeightValueRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          const nextHeight = Math.max(
            SHEET_MIN_HEIGHT,
            Math.min(SHEET_MAX_HEIGHT, panStartHeightRef.current - gestureState.dy),
          );
          sheetHeight.setValue(nextHeight);
        },
        onPanResponderRelease: (_, gestureState) => {
          const currentHeight = Math.max(
            SHEET_MIN_HEIGHT,
            Math.min(SHEET_MAX_HEIGHT, panStartHeightRef.current - gestureState.dy),
          );
          const snapPoints = [SHEET_MIN_HEIGHT, SHEET_MID_HEIGHT, SHEET_MAX_HEIGHT];
          const nearest = snapPoints.reduce((prev, point) =>
            Math.abs(point - currentHeight) < Math.abs(prev - currentHeight) ? point : prev,
          );
          animateSheetTo(nearest);
          if (nearest === SHEET_MIN_HEIGHT) {
            switchToMapTab();
          }
        },
      }),
    [animateSheetTo, sheetHeight, switchToMapTab],
  );

  useEffect(() => {
    const refreshAt = route?.params?.refreshAt;
    if (typeof refreshAt !== 'number') {
      return;
    }
    if (routeRefreshHandledRef.current === refreshAt) {
      return;
    }
    routeRefreshHandledRef.current = refreshAt;
    const createdPostId =
      typeof route?.params?.createdPostId === 'string'
        ? route.params.createdPostId
        : null;
    let cancelled = false;

    const run = async () => {
      logger.log('[Feed][Load] route refresh requested', {refreshAt, createdPostId});
      setFeedTab('all');
      setActiveLayer('feed');
      setIsPeekMode(false);
      animateSheetTo(SHEET_MID_HEIGHT);
      setVisibleRows(12);
      await refreshContent(true);
      if (cancelled || !createdPostId) {
        return;
      }

      const isCreatedPostVisible = isPostVisible(createdPostId);
      if (isCreatedPostVisible) {
        logger.log('[Feed][Load] created post visible', {createdPostId});
        return;
      }

      logger.warn('[Feed][Load] created post not visible yet, retrying', {
        createdPostId,
      });
      if (routeRefreshRetryTimeoutRef.current) {
        clearTimeout(routeRefreshRetryTimeoutRef.current);
      }
      routeRefreshRetryTimeoutRef.current = setTimeout(() => {
        refreshContent(true);
      }, 1200);
    };

    run();

    return () => {
      cancelled = true;
      if (routeRefreshRetryTimeoutRef.current) {
        clearTimeout(routeRefreshRetryTimeoutRef.current);
        routeRefreshRetryTimeoutRef.current = null;
      }
    };
  }, [animateSheetTo, isPostVisible, refreshContent, route?.params?.createdPostId, route?.params?.refreshAt]);

  useEffect(() => {
    const postIdFromLink =
      typeof route?.params?.postId === 'string' ? route.params.postId.trim() : null;
    if (!postIdFromLink) {
      return;
    }
    pendingFocusedPostIdRef.current = postIdFromLink;
    setFeedTab('all');
    setActiveLayer('feed');
    setIsPeekMode(false);
    animateSheetTo(SHEET_MID_HEIGHT);
    setVisibleRows(prev => Math.max(prev, 22));
    refreshContent(true);
  }, [animateSheetTo, refreshContent, route?.params?.activityAt, route?.params?.postId]);

  const unifiedPosts = useMemo<UnifiedPost[]>(() => {
    const spotPostsBySpotId = new Map<string, SocialPost>();
    socialPosts.forEach(post => {
      if (post.type === 'spot' && post.spotId) {
        spotPostsBySpotId.set(post.spotId, post);
      }
    });

    const spotUnified = spots.map(spot => {
      const spotPost = spotPostsBySpotId.get(spot.id!);
      const fallbackImages = [spot.mainImage, ...(spot.galleryImages ?? [])].filter(
        (item): item is string => Boolean(item),
      );

      return {
        id: spotPost?.id ?? getSpotPostDocId(spot.id!),
        type: 'spot' as const,
        createdAtMs:
          getTimestampMillis(spotPost?.createdAt) ||
          (typeof (spotPost as any)?.createdAtMs === 'number'
            ? (spotPost as any).createdAtMs
            : 0) ||
          getTimestampMillis(spot.createdAt),
        createdBy: spotPost?.createdBy ?? spot.createdBy,
        text: (spotPost?.text ?? spot.description ?? '').trim(),
        images:
          spotPost?.media?.images?.filter(Boolean) ??
          fallbackImages.slice(0, 6),
        videoUrl: spotPost?.media?.videoUrl ?? spot.videoUrl,
        thumbnailUrl:
          spotPost?.media?.thumbnailUrl ?? spot.mainImage ?? fallbackImages[0],
        spot,
        sourcePost: spotPost,
        featured: Boolean(spot.featured || spotPost?.featured),
      };
    });

    const droneUnified = socialPosts
      .filter(post => post.type === 'drone')
      .map(post => ({
        id: post.id!,
        type: 'drone' as const,
        createdAtMs:
          getTimestampMillis(post.createdAt) ||
          (typeof (post as any).createdAtMs === 'number' ? (post as any).createdAtMs : 0),
        createdBy: post.createdBy,
        text: (post.text ?? '').trim(),
        images: post.media?.images?.filter(Boolean) ?? [],
        videoUrl: post.media?.videoUrl,
        thumbnailUrl: post.media?.thumbnailUrl,
        sourcePost: post,
        featured: Boolean(post.featured),
      }));

    const eventUnified = socialPosts
      .filter(post => post.type === 'event')
      .map(post => ({
        id: post.id!,
        type: 'event' as const,
        createdAtMs:
          getTimestampMillis(post.createdAt) ||
          (typeof (post as any).createdAtMs === 'number' ? (post as any).createdAtMs : 0),
        createdBy: post.createdBy,
        text: (post.text ?? '').trim(),
        images: post.media?.images?.filter(Boolean) ?? [],
        videoUrl: post.media?.videoUrl,
        thumbnailUrl: post.media?.thumbnailUrl,
        eventId: post.eventId,
        eventMeta: post.eventMeta,
        sourcePost: post,
        featured: Boolean(post.featured),
      }));

    return [...spotUnified, ...droneUnified, ...eventUnified];
  }, [socialPosts, spots]);

  const videoProbeCandidates = useMemo(() => {
    const candidateCount = Math.max(visibleRows + FEED_VIDEO_PROBE_AHEAD, FEED_VIDEO_MIN_PREFETCH_ROWS);
    return unifiedPosts.slice(0, candidateCount);
  }, [unifiedPosts, visibleRows]);

  useEffect(() => {
    videoProbeCandidates.forEach(post => {
      if ((!post.videoUrl && !post.images[0]) || videoAspectRatioByPostId[post.id]) {
        return;
      }
      if (probedVideoPreviewByPostIdRef.current[post.id]) {
        return;
      }
      probedVideoPreviewByPostIdRef.current[post.id] = true;
      const previewUri = post.videoUrl ? getVideoPreviewImage(post) : post.images[0] ?? null;
      if (!previewUri) {
        return;
      }
      Image.getSize(
        previewUri,
        (width, height) => {
          setMeasuredVideoAspectRatio(post.id, width, height);
        },
        () => {},
      );
    });
  }, [setMeasuredVideoAspectRatio, videoAspectRatioByPostId, videoProbeCandidates]);

  const postMetrics = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const referenceCoords =
      currentLocation ||
      (mapRegion
        ? {latitude: mapRegion.latitude, longitude: mapRegion.longitude}
        : null);

    return unifiedPosts.map(post => {
      const postComments =
        post.type === 'spot'
          ? (spotReviewsBySpotId[post.spot?.id ?? ''] ?? []).filter(
              review => review.type === 'comment' && Boolean(review.text),
            )
          : (postCommentsByPostId[post.id] ?? []);

      const spotRatings =
        post.type === 'spot'
          ? (spotReviewsBySpotId[post.spot?.id ?? ''] ?? []).filter(
              review => review.type === 'rating' && typeof review.rating === 'number',
            )
          : [];

      const lastCommentMs = postComments.length
        ? Math.max(...postComments.map(comment => getTimestampMillis(comment.createdAt)))
        : 0;

      const lastRatingMs = spotRatings.length
        ? Math.max(...spotRatings.map(review => getTimestampMillis(review.createdAt)))
        : 0;

      const lastActivityMs = Math.max(post.createdAtMs, lastCommentMs, lastRatingMs);
      const likesCount = likeCountByPostId[post.id] ?? 0;

      const weeklyComments = postComments.filter(
        comment => getTimestampMillis(comment.createdAt) >= weekAgo,
      ).length;
      const weeklyRatings = spotRatings.filter(
        review => getTimestampMillis(review.createdAt) >= weekAgo,
      ).length;

      const weeklyScore =
        likesCount * 2 +
        weeklyComments * 2 +
        weeklyRatings * 2 +
        (post.type === 'spot' ? Number(post.spot?.averageRating || 0) : 0) +
        (post.featured ? 2 : 0);

      const spotCoordinates = post.spot ? getSpotCoordinates(post.spot) : null;
      const distanceKm =
        referenceCoords && spotCoordinates
          ? calculateDistanceKm(referenceCoords, spotCoordinates)
          : Number.POSITIVE_INFINITY;

      return {
        post,
        comments: postComments,
        ratings: spotRatings,
        likesCount,
        lastActivityMs,
        weeklyScore,
        distanceKm,
      };
    });
  }, [
    currentLocation,
    likeCountByPostId,
    mapRegion,
    postCommentsByPostId,
    spotReviewsBySpotId,
    unifiedPosts,
  ]);

  const filteredPosts = useMemo(() => {
    let items = [...postMetrics];

    if (feedTab === 'spots') {
      items = items.filter(item => item.post.type === 'spot');
    }

    items.sort((a, b) => b.lastActivityMs - a.lastActivityMs);

    return items;
  }, [feedTab, postMetrics]);

  const filteredPostIndexById = useMemo(
    () =>
      filteredPosts.reduce<Record<string, number>>((accumulator, item, index) => {
        accumulator[item.post.id] = index;
        return accumulator;
      }, {}),
    [filteredPosts],
  );

  const feedRows = useMemo<FeedRow[]>(() => {
    const rows: FeedRow[] = [];
    filteredPosts.forEach((item, index) => {
      rows.push({kind: 'post', post: item.post});
      if (!areAdsDisabled && (index + 1) % FEED_AD_FREQUENCY === 0) {
        rows.push({kind: 'ad', id: `ad-${index}`});
      }
    });
    return rows;
  }, [areAdsDisabled, filteredPosts]);

  const feedRowIndexByPostId = useMemo(
    () =>
      feedRows.reduce<Record<string, number>>((accumulator, row, index) => {
        if (row.kind === 'post') {
          accumulator[row.post.id] = index;
        }
        return accumulator;
      }, {}),
    [feedRows],
  );

  useEffect(() => {
    const validPostIds = new Set(unifiedPosts.map(post => post.id));
    Object.keys(prefetchedVideoPostIdsRef.current).forEach(postId => {
      if (!validPostIds.has(postId)) {
        delete prefetchedVideoPostIdsRef.current[postId];
      }
    });
    Object.keys(warmingVideoPostIdsRef.current).forEach(postId => {
      if (!validPostIds.has(postId)) {
        delete warmingVideoPostIdsRef.current[postId];
      }
    });
  }, [unifiedPosts]);

  const postMetricsByPostId = useMemo(
    () =>
      postMetrics.reduce<Record<string, (typeof postMetrics)[number]>>((accumulator, metric) => {
        accumulator[metric.post.id] = metric;
        return accumulator;
      }, {}),
    [postMetrics],
  );

  const commentsModalMetric = useMemo(
    () => (commentsModalPostId ? postMetricsByPostId[commentsModalPostId] ?? null : null),
    [commentsModalPostId, postMetricsByPostId],
  );

  const visibleRowsData = useMemo(
    () => feedRows.slice(0, visibleRows),
    [feedRows, visibleRows],
  );
  const viewableVideoPostIdSet = useMemo(() => new Set(viewableVideoPostIds), [viewableVideoPostIds]);
  const activeFeedPost = useMemo(
    () => (videoPrefetchAnchorPostId ? postMetricsByPostId[videoPrefetchAnchorPostId]?.post ?? null : null),
    [postMetricsByPostId, videoPrefetchAnchorPostId],
  );
  const activeFeedPostHasPortraitMedia = useMemo(() => {
    if (!activeFeedPost || (!activeFeedPost.videoUrl && !activeFeedPost.images[0])) {
      return false;
    }
    const aspectRatio = videoAspectRatioByPostId[activeFeedPost.id];
    return typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio < 1;
  }, [activeFeedPost, videoAspectRatioByPostId]);

  useEffect(() => {
    if (!canRenderFeedContent) {
      autoExpandedSheetForMediaRef.current = false;
      return;
    }

    if (activeFeedPostHasPortraitMedia) {
      if (sheetHeightValueRef.current < SHEET_MAX_HEIGHT - 12) {
        autoExpandedSheetForMediaRef.current = true;
        animateSheetTo(SHEET_MAX_HEIGHT);
      }
      return;
    }

    if (autoExpandedSheetForMediaRef.current) {
      autoExpandedSheetForMediaRef.current = false;
      animateSheetTo(SHEET_MID_HEIGHT);
    }
  }, [
    activeFeedPostHasPortraitMedia,
    animateSheetTo,
    canRenderFeedContent,
  ]);

  useEffect(() => {
    const targetPostId = pendingFocusedPostIdRef.current;
    if (!targetPostId || loading) {
      return;
    }

    const targetRowIndex = feedRowIndexByPostId[targetPostId];
    if (typeof targetRowIndex !== 'number') {
      if (!refreshing) {
        logger.warn('[Feed][Load] target post not found in feed', {postId: targetPostId});
        pendingFocusedPostIdRef.current = null;
      }
      return;
    }

    setVisibleRows(previous => Math.max(previous, targetRowIndex + FEED_POST_PREFETCH_WINDOW));
    requestAnimationFrame(() => {
      feedListRef.current?.scrollToIndex({
        index: targetRowIndex,
        animated: true,
        viewPosition: 0.06,
      });
    });
    pendingFocusedPostIdRef.current = null;
  }, [feedRowIndexByPostId, loading, refreshing]);

  useEffect(() => {
    if (loading) {
      return;
    }
    logger.log('[Feed][Merge] render', {
      tab: feedTab,
      unifiedCount: unifiedPosts.length,
      rowCount: feedRows.length,
    });
  }, [feedRows.length, feedTab, loading, unifiedPosts.length]);

  const mapDisplayRegion: Region =
    mapRegion ||
    ({
      latitude: currentLocation?.latitude ?? 41.3851,
      longitude: currentLocation?.longitude ?? 2.1734,
      latitudeDelta: 0.09,
      longitudeDelta: 0.05,
    } as Region);

  const onRegionChangeComplete = (nextRegion: Region) => {
    if (activeLayer !== 'map') {
      return;
    }
    setMapRegion(nextRegion);
  };

  const focusSpotOnMap = useCallback((spot: Spot) => {
    const coords = getSpotCoordinates(spot);
    if (!coords) {
      return;
    }

    const targetRegion: Region = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    setHighlightedSpotId(spot.id ?? null);
    setMapRegion(targetRegion);
    mapRef.current?.animateToRegion(targetRegion, 700);
    switchToMapLayer();
  }, [setMapRegion, switchToMapLayer]);

  const onToggleLike = useCallback(async (post: UnifiedPost) => {
    if (authLoading || !user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }

    const postId = post.id;
    if (savingLikeByPostId[postId]) {
      return;
    }
    const nextLiked = !likedByCurrentUser[postId];
    setSavingLikeByPostId(prev => ({...prev, [postId]: true}));

    const heartScale = getHeartScale(postId);
    heartScale.setValue(0.8);
    Animated.spring(heartScale, {
      toValue: 1,
      useNativeDriver: true,
      damping: 6,
      stiffness: 180,
      mass: 0.6,
    }).start();

    setLikedByCurrentUser(prev => ({
      ...prev,
      [postId]: nextLiked,
    }));
    setLikeCountByPostId(prev => ({
      ...prev,
      [postId]: Math.max(0, (prev[postId] ?? 0) + (nextLiked ? 1 : -1)),
    }));

    try {
      await togglePostLike({
        postId,
        postType: post.type,
      });
    } catch (likeError) {
      logger.error('[Feed] like toggle failed', likeError);
      setLikedByCurrentUser(prev => ({
        ...prev,
        [postId]: !nextLiked,
      }));
      setLikeCountByPostId(prev => ({
        ...prev,
        [postId]: Math.max(0, (prev[postId] ?? 0) + (nextLiked ? -1 : 1)),
      }));
      Alert.alert(t('alerts.error'), t('feed.likeError'));
    } finally {
      setSavingLikeByPostId(prev => ({...prev, [postId]: false}));
    }
  }, [
    authLoading,
    getHeartScale,
    likedByCurrentUser,
    savingLikeByPostId,
    setLikeCountByPostId,
    setLikedByCurrentUser,
    t,
    user,
  ]);

  const onRateSpot = useCallback(async (spotId: string, rating: number) => {
    if (!user || !spotId || !rating) {
      return;
    }

    setSavingRatingBySpotId(prev => ({...prev, [spotId]: true}));
    try {
      await addReview({
        spotId,
        userId: user.uid,
        type: 'rating',
        rating,
      });
      const latest = await getReviewsForSpot(spotId);
      setSpotReviewsBySpotId(prev => ({...prev, [spotId]: latest}));
      refreshContent(true);
    } catch (ratingError) {
      logger.error('[Feed] spot rating failed', ratingError);
      Alert.alert(t('alerts.error'), t('alerts.addReviewError'));
    } finally {
      setSavingRatingBySpotId(prev => ({...prev, [spotId]: false}));
    }
  }, [refreshContent, setSpotReviewsBySpotId, t, user]);

  const onSendComment = useCallback(async (post: UnifiedPost) => {
    if (!user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }
    const draft = (inlineCommentDrafts[post.id] ?? '').trim();
    if (!draft) {
      Alert.alert(t('alerts.error'), t('alerts.enterComment'));
      return;
    }

    setSavingCommentByPostId(prev => ({...prev, [post.id]: true}));
    setInlineCommentDrafts(prev => ({...prev, [post.id]: ''}));

    try {
      if (post.type === 'spot' && post.spot?.id) {
        await addReview({
          spotId: post.spot.id,
          userId: user.uid,
          type: 'comment',
          text: draft,
        });
        const latestSpotComments = await getReviewsForSpot(post.spot.id);
        setSpotReviewsBySpotId(prev => ({
          ...prev,
          [post.spot!.id!]: latestSpotComments,
        }));
      } else {
        await addPostComment({
          postId: post.id,
          text: draft,
        });
        const latestPostComments = await getPostComments(post.id);
        setPostCommentsByPostId(prev => ({
          ...prev,
          [post.id]: latestPostComments,
        }));
      }
      refreshContent(true);
    } catch (commentError) {
      logger.error('[Feed] comment publish failed', commentError);
      Alert.alert(t('alerts.error'), t('alerts.addReviewError'));
      setInlineCommentDrafts(prev => ({...prev, [post.id]: draft}));
    } finally {
      setSavingCommentByPostId(prev => ({...prev, [post.id]: false}));
    }
  }, [
    inlineCommentDrafts,
    refreshContent,
    setPostCommentsByPostId,
    setSpotReviewsBySpotId,
    t,
    user,
  ]);

  const onSharePost = useCallback(async (post: UnifiedPost) => {
    const spotName = post.spot?.name?.trim() || t('feed.untitled');
    const isSpotPost = post.type === 'spot';
    const isEventPost = post.type === 'event';
    const shareUrl =
      isSpotPost && post.spot?.id
        ? buildSpotShareUrl(post.spot.id)
        : isEventPost && post.eventId
          ? buildEventShareUrl(post.eventId)
        : buildPostShareUrl(post.id);
    const shareMessageBase = isSpotPost
      ? t('feed.shareMessageSpot', {spotName})
      : isEventPost
        ? t('feed.shareMessageEvent', {
            eventName: post.eventMeta?.title || t('feed.badgeEvent'),
          })
      : t('feed.shareMessagePost');
    const sharePayload = shareUrl
      ? {
          message: `${shareMessageBase}\n${shareUrl}\n${PLAY_STORE_URL}`,
          url: shareUrl,
        }
      : {message: `${shareMessageBase}\n${PLAY_STORE_URL}`};

    try {
      await Share.share(sharePayload);
    } catch (shareError) {
      logger.warn('[Feed] share post failed', {postId: post.id, error: shareError});
      Alert.alert(t('alerts.error'), t('feed.shareError'));
    }
  }, [t]);

  const onReportPost = useCallback((post: UnifiedPost) => {
    Alert.alert(
      t('feed.reportTitle'),
      t('feed.reportPrompt'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('reportReasons.spam'),
          onPress: async () => {
            setReportSubmittingForPostId(prev => ({...prev, [post.id]: true}));
            try {
              await submitContentReport({
                targetType: 'post',
                targetId: post.id,
                reasons: ['spam'],
                contextPostId: post.id,
                contextSpotId: post.spot?.id,
              });
              Alert.alert(t('alerts.success'), t('feed.reportSent'));
            } catch (reportError) {
              logger.error('[Feed] report failed', reportError);
              Alert.alert(t('alerts.error'), t('feed.reportError'));
            } finally {
              setReportSubmittingForPostId(prev => ({...prev, [post.id]: false}));
            }
          },
        },
        {
          text: t('reportReasons.other'),
          onPress: async () => {
            setReportSubmittingForPostId(prev => ({...prev, [post.id]: true}));
            try {
              await submitContentReport({
                targetType: 'post',
                targetId: post.id,
                reasons: ['other'],
                contextPostId: post.id,
                contextSpotId: post.spot?.id,
              });
              Alert.alert(t('alerts.success'), t('feed.reportSent'));
            } catch (reportError) {
              logger.error('[Feed] report failed', reportError);
              Alert.alert(t('alerts.error'), t('feed.reportError'));
            } finally {
              setReportSubmittingForPostId(prev => ({...prev, [post.id]: false}));
            }
          },
        },
      ],
    );
  }, [t]);

  const goToSpotDetail = useCallback((spotId?: string) => {
    if (!spotId) {
      return;
    }
    navigation.navigate('SpotDetail', {spotId});
  }, [navigation]);

  const goToEventDetail = useCallback((eventId?: string) => {
    if (!eventId) {
      return;
    }
    navigation.navigate('EventDetail', {eventId});
  }, [navigation]);

  const openEventDirections = useCallback(
    async (post: UnifiedPost) => {
      const directionsUrl = buildGoogleMapsDirectionsUrl({
        latitude: post.eventMeta?.latitude,
        longitude: post.eventMeta?.longitude,
        address: post.eventMeta?.locationAddress,
        label: post.eventMeta?.locationLabel,
      });

      if (!directionsUrl) {
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
        return;
      }

      try {
        await Linking.openURL(directionsUrl);
      } catch (directionsError) {
        logger.warn('[Feed] event directions failed', {postId: post.id, error: directionsError});
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      }
    },
    [t],
  );

  const viewEventOnMap = useCallback(
    (post: UnifiedPost) => {
      navigation.navigate('Map', {
        focusEventId: post.eventId ?? null,
        focusLatitude:
          typeof post.eventMeta?.latitude === 'number' ? post.eventMeta.latitude : null,
        focusLongitude:
          typeof post.eventMeta?.longitude === 'number' ? post.eventMeta.longitude : null,
        focusRequestedAt: Date.now(),
      });
    },
    [navigation],
  );

  const onJoinEventFromPost = useCallback(
    async (post: UnifiedPost) => {
      if (!user) {
        Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
        return;
      }
      if (!post.eventId || !post.eventMeta?.isPublic) {
        return;
      }

      setJoiningEventByPostId(previous => ({...previous, [post.id]: true}));
      try {
        const result = await joinPublicEvent(post.eventId);
        if (result.participantStatus === 'going') {
          Alert.alert(t('alerts.success'), t('events.joinedSuccess'));
        } else if (result.participantStatus === 'requested') {
          Alert.alert(t('alerts.success'), t('events.requestSentSuccess'));
        } else {
          Alert.alert(t('alerts.attention'), t('events.alreadyInvitedHint'));
        }
      } catch (joinError) {
        logger.error('[Feed] join event from post failed', {postId: post.id, error: joinError});
        if (
          joinError instanceof Error &&
          joinError.message === 'event_participation_managed_by_host'
        ) {
          Alert.alert(t('alerts.error'), t('events.managedByHostOnly'));
        } else {
          Alert.alert(t('alerts.error'), t('events.actionError'));
        }
      } finally {
        setJoiningEventByPostId(previous => ({...previous, [post.id]: false}));
      }
    },
    [t, user],
  );

  const getInlineVideoSource = useCallback((post: UnifiedPost) => {
    const existing = videoSourceByPostId[post.id];
    if (existing) {
      return existing;
    }
    const urls = post.videoUrl ? buildVideoSourceCandidates(post.videoUrl) : [];
    return {
      url: urls[0] ?? '',
      fallbackUrls: urls.slice(1),
    };
  }, [videoSourceByPostId]);

  const onToggleExpandedText = useCallback((postId: string) => {
    setExpandedTextByPostId(prev => ({
      ...prev,
      [postId]: !prev[postId],
    }));
  }, []);

  const onTogglePostPlayback = useCallback((postId: string) => {
    clearScheduledPlaybackSwitch();
    setPlayingVideoPostId(prev => {
      const next = prev === postId ? null : postId;
      if (next === null) {
        setVideoBufferingState(postId, false);
      }
      return next;
    });
  }, [clearScheduledPlaybackSwitch, setVideoBufferingState]);

  const onChangeInlineComment = useCallback((postId: string, value: string) => {
    setInlineCommentDrafts(prev => ({
      ...prev,
      [postId]: value,
    }));
  }, []);

  const onOpenCommentsModal = useCallback((postId: string) => {
    setCommentsModalPostId(postId);
  }, []);

  const onInlineVideoBufferingChange = useCallback((postId: string, isBuffering: boolean) => {
    setVideoBufferingState(postId, isBuffering);
  }, [setVideoBufferingState]);

  const onInlineVideoMeasured = useCallback(
    (postId: string, widthValue: unknown, heightValue: unknown) => {
      setMeasuredVideoAspectRatio(postId, widthValue, heightValue);
    },
    [setMeasuredVideoAspectRatio],
  );

  const onSwitchPostToBunnyEmbed = useCallback((postId: string) => {
    setForceBunnyEmbedByPostId(previous => {
      if (previous[postId]) {
        return previous;
      }
      return {
        ...previous,
        [postId]: true,
      };
    });
  }, []);

  const onAdvancePostVideoSource = useCallback(
    (postId: string, nextSource: {url: string; fallbackUrls: string[]}) => {
      setVideoSourceByPostId(previous => ({
        ...previous,
        [postId]: nextSource,
      }));
    },
    [],
  );

  const onEnsurePostPlaying = useCallback((postId: string) => {
    setPlayingVideoPostId(postId);
  }, []);

  const feedLabels = useMemo(
    () => ({
      badgeSpot: t('feed.badgeSpot'),
      badgeDrone: t('feed.badgeDrone'),
      badgeEvent: t('feed.badgeEvent'),
      video: t('feed.video'),
      noMedia: t('feed.noMedia'),
      seeMore: t('feed.seeMore'),
      seeLess: t('feed.seeLess'),
      viewOnMap: t('feed.viewOnMap'),
      directions: t('spotDetail.directionsButton'),
      viewEvent: t('feed.viewEvent'),
      share: t('feed.share'),
      report: t('feed.report'),
      yourRating: t('feed.yourRating'),
      latestComments: t('feed.latestComments'),
      noCommentsYet: t('feed.noCommentsYet'),
      commentPlaceholder: t('feed.commentPlaceholder'),
      viewAllComments: t('feed.viewAllComments'),
      exploreSpot: t('feed.exploreSpot'),
      errorTitle: t('alerts.error'),
      videoPlaybackError: t('alerts.videoPlaybackError'),
      unknownUser: t('common.unknownUser'),
      eventStarts: t('feed.eventStarts'),
      eventPublicClosed: t('events.publicJoinModeApprovalSummary'),
      eventPublicOpen: t('events.publicJoinModeOpenSummary'),
      eventPublic: t('feed.eventPublic'),
      eventPrivate: t('feed.eventPrivate'),
      requestJoinAction: t('events.requestJoinAction'),
      joinOpenAction: t('events.joinOpenAction'),
    }),
    [t],
  );

  const warmupVideoForPost = useCallback(
    async (post: UnifiedPost) => {
      if (!post.videoUrl) {
        return;
      }
      if (prefetchedVideoPostIdsRef.current[post.id] || warmingVideoPostIdsRef.current[post.id]) {
        return;
      }

      warmingVideoPostIdsRef.current[post.id] = true;
      const previewUri = getVideoPreviewImage(post);
      if (previewUri) {
        Image.prefetch(previewUri).catch(() => {});
      }

      const existing = videoSourceByPostId[post.id];
      const sourceCandidates = existing
        ? [existing.url, ...existing.fallbackUrls].filter(Boolean)
        : buildVideoSourceCandidates(post.videoUrl);
      const warmupUrl = pickWarmupVideoUrl(sourceCandidates);
      if (!warmupUrl) {
        prefetchedVideoPostIdsRef.current[post.id] = true;
        delete warmingVideoPostIdsRef.current[post.id];
        return;
      }

      const abortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutHandle = setTimeout(() => {
        abortController?.abort();
      }, FEED_VIDEO_WARMUP_TIMEOUT_MS);

      try {
        const response = await fetch(warmupUrl, {
          method: 'GET',
          headers: {
            Range: `bytes=0-${FEED_VIDEO_WARMUP_RANGE_LAST_BYTE}`,
          },
          signal: abortController?.signal,
        });
        if (response.ok || response.status === 206 || response.status === 416) {
          prefetchedVideoPostIdsRef.current[post.id] = true;
        }
      } catch {
        // Best effort warmup only.
      } finally {
        clearTimeout(timeoutHandle);
        delete warmingVideoPostIdsRef.current[post.id];
      }
    },
    [videoSourceByPostId],
  );

  const renderRow = useCallback(({item}: {item: FeedRow}) => {
    if (item.kind === 'ad') {
      return <FeedAdCard label={t('feed.adLabel')} />;
    }
    const post = item.post;
    const metric = postMetricsByPostId[post.id];
    if (!metric) {
      return null;
    }
    const hasVideo = Boolean(post.videoUrl);
    const videoPreviewUri = hasVideo ? getVideoPreviewImage(post) : null;
    const bunnyEmbed = getBunnyEmbedForVideoUrl(post.videoUrl);
    const inlineVideoSource = hasVideo ? getInlineVideoSource(post) : null;
    const shouldUseBunnyEmbed = Boolean(forceBunnyEmbedByPostId[post.id] && bunnyEmbed);
    const nativeVideoHeaders = bunnyEmbed
      ? {
          Referer: 'https://iframe.mediadelivery.net/',
          Origin: 'https://iframe.mediadelivery.net',
        }
      : undefined;
    const isVideoPlaying =
      hasVideo &&
      canRenderFeedContent &&
      playingVideoPostId === post.id &&
      viewableVideoPostIdSet.has(post.id);
    const shouldExpandVideoFrame =
      hasVideo && canRenderFeedContent && playingVideoPostId === post.id;
    const isVideoBuffering = Boolean(bufferingVideoByPostId[post.id]);
    const videoAspectRatio = hasVideo ? videoAspectRatioByPostId[post.id] : null;
    const videoFrameHeight = hasVideo
      ? shouldExpandVideoFrame
        ? getFeedVideoPlaybackHeight(videoAspectRatio)
        : getFeedVideoHeight(videoAspectRatio)
      : FEED_MEDIA_MIN_HEIGHT;
    const willRenderBunnyWebView = Boolean(
      isVideoPlaying && shouldUseBunnyEmbed && bunnyEmbed,
    );
    const userSpotRating =
      post.type === 'spot'
        ? metric.ratings.find(review => review.userId === user?.uid)?.rating ?? 0
        : 0;

    return (
      <FeedPostCard
        post={post}
        metric={metric}
        postAuthor={profilesByUserId[post.createdBy]?.displayName || feedLabels.unknownUser}
        profilesByUserId={profilesByUserId}
        labels={feedLabels}
        isExpanded={Boolean(expandedTextByPostId[post.id])}
        liked={Boolean(likedByCurrentUser[post.id])}
        userSpotRating={userSpotRating}
        commentDraft={inlineCommentDrafts[post.id] ?? ''}
        savingLike={Boolean(savingLikeByPostId[post.id])}
        savingComment={Boolean(savingCommentByPostId[post.id])}
        savingRating={Boolean(savingRatingBySpotId[post.spot?.id ?? ''])}
        reportSubmitting={Boolean(reportSubmittingForPostId[post.id])}
        hasVideo={hasVideo}
        videoPreviewUri={videoPreviewUri}
        inlineVideoSource={inlineVideoSource}
        nativeVideoHeaders={nativeVideoHeaders}
        bunnyEmbed={bunnyEmbed}
        shouldUseBunnyEmbed={shouldUseBunnyEmbed}
        willRenderBunnyWebView={willRenderBunnyWebView}
        isVideoPlaying={isVideoPlaying}
        isVideoBuffering={isVideoBuffering}
        videoFrameHeight={videoFrameHeight}
        heartScale={getHeartScale(post.id)}
        buildInlineBunnyIframeHtml={buildInlineBunnyIframeHtml}
        onToggleText={onToggleExpandedText}
        onTogglePlayback={onTogglePostPlayback}
        onLike={onToggleLike}
        onRateSpot={onRateSpot}
        onChangeComment={onChangeInlineComment}
        onSendComment={onSendComment}
        onOpenComments={onOpenCommentsModal}
        onShare={onSharePost}
        onReport={onReportPost}
        onFocusSpotOnMap={focusSpotOnMap}
        onOpenEventDirections={openEventDirections}
        onViewEventOnMap={viewEventOnMap}
        onJoinEvent={onJoinEventFromPost}
        onGoToSpotDetail={goToSpotDetail}
        onGoToEventDetail={goToEventDetail}
        onVideoBufferingChange={onInlineVideoBufferingChange}
        onVideoMeasured={onInlineVideoMeasured}
        onSwitchToBunnyEmbed={onSwitchPostToBunnyEmbed}
        onAdvanceVideoSource={onAdvancePostVideoSource}
        onEnsureVideoPlaying={onEnsurePostPlaying}
        canJoinEvent={Boolean(user?.uid && post.createdBy !== user.uid && post.eventMeta?.isPublic)}
        joiningEvent={Boolean(joiningEventByPostId[post.id])}
      />
    );
  }, [
    bufferingVideoByPostId,
    canRenderFeedContent,
    expandedTextByPostId,
    feedLabels,
    focusSpotOnMap,
    forceBunnyEmbedByPostId,
    getHeartScale,
    getInlineVideoSource,
    goToEventDetail,
    goToSpotDetail,
    inlineCommentDrafts,
    joiningEventByPostId,
    likedByCurrentUser,
    openEventDirections,
    onAdvancePostVideoSource,
    onChangeInlineComment,
    onEnsurePostPlaying,
    onJoinEventFromPost,
    onInlineVideoBufferingChange,
    onInlineVideoMeasured,
    onOpenCommentsModal,
    onRateSpot,
    onReportPost,
    onSendComment,
    onSharePost,
    onSwitchPostToBunnyEmbed,
    onToggleExpandedText,
    onToggleLike,
    onTogglePostPlayback,
    playingVideoPostId,
    postMetricsByPostId,
    profilesByUserId,
    reportSubmittingForPostId,
    savingCommentByPostId,
    savingLikeByPostId,
    savingRatingBySpotId,
    t,
    user?.uid,
    videoAspectRatioByPostId,
    viewEventOnMap,
    viewableVideoPostIdSet,
  ]);

  const renderModalCommentRow = useCallback(({item: value}: {item: Review | PostComment}) => {
    const author =
      profilesByUserId[value.userId]?.displayName || t('common.unknownUser');
    return (
      <View style={styles.modalCommentRow}>
        <Text style={styles.commentAuthor}>{author}</Text>
        <Text style={styles.commentText}>{value.text ?? ''}</Text>
      </View>
    );
  }, [profilesByUserId, t]);

  const commentKeyExtractor = useCallback(
    (value: Review | PostComment) =>
      value.id ?? `${value.userId}-${getTimestampMillis(value.createdAt)}`,
    [],
  );

  const mapMarkers = useMemo(
    () =>
      spots.map(spot => {
        const coordinates = getSpotCoordinates(spot);
        if (!coordinates) {
          return null;
        }
        return (
          <Marker
            key={spot.id}
            coordinate={coordinates}
            pinColor={highlightedSpotId === spot.id ? '#ef4444' : '#007BFF'}
            onPress={() => {
              if (activeLayer === 'map') {
                setHighlightedSpotId(spot.id ?? null);
              }
            }}
          />
        );
      }),
    [activeLayer, highlightedSpotId, spots],
  );

  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 35,
    minimumViewTime: 150,
  });

  const onViewableItemsChanged = useCallback(
    ({viewableItems}: {viewableItems: Array<ViewToken>}) => {
      if (!canRenderFeedContent) {
        syncViewableVideoPostIds([]);
        syncVideoPrefetchAnchorPostId(null);
        schedulePlayingVideo(null, 0);
        return;
      }

      const orderedVisiblePostIds = getOrderedViewablePostIds(viewableItems);
      const nextPrefetchAnchorPostId = orderedVisiblePostIds[0] ?? null;
      syncVideoPrefetchAnchorPostId(nextPrefetchAnchorPostId);

      const orderedVisibleVideoPostIds = getOrderedViewableVideoPostIds(viewableItems);
      syncViewableVideoPostIds(orderedVisibleVideoPostIds);
      const nextPostId = orderedVisibleVideoPostIds[0] ?? null;

      if (!nextPostId) {
        schedulePlayingVideo(null, FEED_AUTOPLAY_CLEAR_DELAY_MS);
        return;
      }

      if (playingVideoPostIdRef.current !== nextPostId) {
        schedulePlayingVideo(nextPostId, FEED_AUTOPLAY_SWITCH_DELAY_MS);
      }
    },
    [
      canRenderFeedContent,
      schedulePlayingVideo,
      syncVideoPrefetchAnchorPostId,
      syncViewableVideoPostIds,
    ],
  );

  useEffect(() => {
    if (!canRenderFeedContent) {
      clearPrefetchBatchTimeout();
      syncViewableVideoPostIds([]);
      syncVideoPrefetchAnchorPostId(null);
      schedulePlayingVideo(null, 0);
    }
  }, [
    canRenderFeedContent,
    clearPrefetchBatchTimeout,
    schedulePlayingVideo,
    syncVideoPrefetchAnchorPostId,
    syncViewableVideoPostIds,
  ]);

  useEffect(() => {
    clearPrefetchBatchTimeout();
    syncVideoPrefetchAnchorPostId(null);
    syncViewableVideoPostIds([]);
    schedulePlayingVideo(null, 0);
  }, [
    clearPrefetchBatchTimeout,
    feedTab,
    schedulePlayingVideo,
    syncVideoPrefetchAnchorPostId,
    syncViewableVideoPostIds,
  ]);

  useEffect(() => {
    if (loading || !canRenderFeedContent || playingVideoPostId) {
      return;
    }
    const firstVisibleVideoPostId = viewableVideoPostIdsRef.current[0];
    if (firstVisibleVideoPostId) {
      schedulePlayingVideo(firstVisibleVideoPostId, FEED_AUTOPLAY_SWITCH_DELAY_MS);
    }
  }, [canRenderFeedContent, loading, playingVideoPostId, schedulePlayingVideo, viewableVideoPostIds]);

  useEffect(() => {
    if (!canRenderFeedContent || !videoPrefetchAnchorPostId) {
      clearPrefetchBatchTimeout();
      return;
    }

    const targetVisibleRows = getTargetVisibleRowsForPostWindow(
      feedRows,
      videoPrefetchAnchorPostId,
      FEED_POST_PREFETCH_WINDOW,
    );
    if (targetVisibleRows > visibleRows) {
      setVisibleRows(previous => Math.min(feedRows.length, Math.max(previous, targetVisibleRows)));
    }

    const anchorIndex = filteredPostIndexById[videoPrefetchAnchorPostId];
    if (typeof anchorIndex !== 'number') {
      clearPrefetchBatchTimeout();
      return;
    }

    clearPrefetchBatchTimeout();
    prefetchBatchTimeoutRef.current = setTimeout(() => {
      const upcomingPosts = filteredPosts
        .slice(anchorIndex + 1, anchorIndex + 1 + FEED_POST_PREFETCH_WINDOW)
        .map(item => item.post)
        .filter(post => Boolean(post.videoUrl));
      upcomingPosts.forEach(post => {
        warmupVideoForPost(post).catch(() => {});
      });
    }, FEED_POST_PREFETCH_DELAY_MS);

    return () => {
      clearPrefetchBatchTimeout();
    };
  }, [
    canRenderFeedContent,
    clearPrefetchBatchTimeout,
    feedRows,
    filteredPostIndexById,
    filteredPosts,
    videoPrefetchAnchorPostId,
    visibleRows,
    warmupVideoForPost,
  ]);

  return (
    <View style={styles.container}>
      {isScreenFocused ? (
        <View style={StyleSheet.absoluteFill} pointerEvents={activeLayer === 'map' ? 'auto' : 'none'}>
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            region={mapDisplayRegion}
            onRegionChangeComplete={onRegionChangeComplete}
            scrollEnabled={activeLayer === 'map'}
            zoomEnabled={activeLayer === 'map'}
            rotateEnabled={activeLayer === 'map'}
            pitchEnabled={activeLayer === 'map'}
            showsCompass
            showsUserLocation>
            {mapMarkers}
          </MapView>
        </View>
      ) : null}

      {activeLayer === 'feed' ? (
        <>
          <View style={styles.mapOverlayBase} />
          <View style={styles.mapOverlayTop} />
          <View style={styles.mapOverlayBottom} />
        </>
      ) : null}

      <Animated.View style={[styles.sheet, {height: sheetHeight}]}> 
        <View style={styles.sheetHandleArea} {...panResponder.panHandlers}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{t('feed.title')}</Text>
          <TouchableOpacity
            style={styles.sheetExpandButton}
            onPress={() => {
              if (activeLayer === 'map') {
                switchToFeedLayer();
                return;
              }
              const current = sheetHeightValueRef.current;
              animateSheetTo(current > SHEET_MID_HEIGHT ? SHEET_MID_HEIGHT : SHEET_MAX_HEIGHT);
            }}>
            <Icon
              name={activeLayer === 'map' ? 'chevron-up' : 'unfold-more-horizontal'}
              size={20}
              color={palette.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {canRenderFeedContent ? (
          <View style={styles.sheetContent}>
            <View style={styles.tabsRow}>
              {(['all', 'spots'] as FeedTab[]).map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tabButton, feedTab === tab && styles.tabButtonActive]}
                  onPress={() => setFeedTab(tab)}>
                  <Text style={[styles.tabLabel, feedTab === tab && styles.tabLabelActive]}>
                    {t(`feed.tabs.${tab}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {loading ? (
              <View style={styles.skeletonWrap}>
                {[0, 1, 2].map(index => (
                  <View key={`skeleton-${index}`} style={styles.skeletonCard}>
                    <View style={styles.skeletonMedia} />
                    <View style={styles.skeletonLineLg} />
                    <View style={styles.skeletonLineMd} />
                    <View style={styles.skeletonLineSm} />
                  </View>
                ))}
              </View>
            ) : error ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateTitle}>{t('feed.errorTitle')}</Text>
                <Text style={styles.stateText}>{error}</Text>
                <TouchableOpacity style={styles.retryButton} onPress={() => refreshContent()}>
                  <Text style={styles.retryButtonText}>{t('feed.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : !feedRows.length ? (
              <View style={styles.stateBox}>
                <Text style={styles.stateTitle}>{t('feed.emptyTitle')}</Text>
                <Text style={styles.stateText}>{t('feed.emptyDescription')}</Text>
                <TouchableOpacity
                  style={styles.retryButton}
                  onPress={() => navigation.navigate('AddSpot')}>
                  <Text style={styles.retryButtonText}>{t('feed.publishFirstSpot')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <FlatList
                ref={instance => {
                  feedListRef.current = instance;
                }}
                data={visibleRowsData}
                keyExtractor={item =>
                  item.kind === 'ad' ? item.id : `post-${item.post.id}`
                }
                renderItem={renderRow}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfigRef.current}
                onRefresh={() => refreshContent(true)}
                refreshing={refreshing}
                initialNumToRender={4}
                maxToRenderPerBatch={6}
                updateCellsBatchingPeriod={45}
                windowSize={7}
                removeClippedSubviews={false}
                onEndReached={() => {
                  if (visibleRows < feedRows.length) {
                    setVisibleRows(prev => prev + 10);
                  }
                }}
                onEndReachedThreshold={0.35}
                onScrollToIndexFailed={({index}) => {
                  setVisibleRows(previous =>
                    Math.max(previous, index + FEED_POST_PREFETCH_WINDOW),
                  );
                  setTimeout(() => {
                    feedListRef.current?.scrollToIndex({
                      index,
                      animated: true,
                      viewPosition: 0.06,
                    });
                  }, 180);
                }}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        ) : null}
      </Animated.View>

      <Modal
        visible={Boolean(commentsModalMetric)}
        transparent
        animationType="slide"
        onRequestClose={() => setCommentsModalPostId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('feed.viewAllComments')}</Text>
              <TouchableOpacity onPress={() => setCommentsModalPostId(null)}>
                <Icon name="close" size={20} color={palette.textPrimary} />
              </TouchableOpacity>
            </View>

            <FlatList<Review | PostComment>
              data={(commentsModalMetric?.comments ?? []) as Array<Review | PostComment>}
              keyExtractor={commentKeyExtractor}
              renderItem={renderModalCommentRow}
              ListEmptyComponent={
                <Text style={styles.commentEmpty}>{t('feed.noCommentsYet')}</Text>
              }
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  mapOverlayBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
  mapOverlayTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 180,
    backgroundColor: 'rgba(15, 23, 42, 0.14)',
  },
  mapOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#f3f6fb',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    ...shadows.medium,
  },
  sheetHandleArea: {
    height: 62,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sheetHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#c7d2e0',
    marginBottom: 6,
  },
  sheetTitle: {
    color: palette.textPrimary,
    fontWeight: '800',
    fontSize: 20,
  },
  sheetExpandButton: {
    position: 'absolute',
    right: 12,
    top: 16,
  },
  sheetContent: {
    flex: 1,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 999,
    backgroundColor: '#fff',
    paddingVertical: 8,
  },
  tabButtonActive: {
    borderColor: palette.highlight,
    backgroundColor: '#eaf2ff',
  },
  tabLabel: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  tabLabelActive: {
    color: palette.highlight,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 100,
  },
  skeletonWrap: {
    paddingHorizontal: 12,
    paddingBottom: 16,
    gap: 12,
  },
  skeletonCard: {
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 14,
    backgroundColor: '#fff',
    padding: 10,
    gap: 8,
  },
  skeletonMedia: {
    height: 210,
    borderRadius: 10,
    backgroundColor: '#e2e8f0',
  },
  skeletonLineLg: {
    width: '94%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  skeletonLineMd: {
    width: '72%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  skeletonLineSm: {
    width: '48%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
  },
  stateBox: {
    paddingHorizontal: 14,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  stateTitle: {
    color: palette.textPrimary,
    fontSize: 19,
    fontWeight: '700',
  },
  stateText: {
    color: palette.textSecondary,
    textAlign: 'center',
    fontSize: 14,
  },
  retryButton: {
    backgroundColor: palette.highlight,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  commentAuthor: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  commentText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  commentEmpty: {
    color: palette.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  adCard: {
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 12,
    backgroundColor: '#fff',
    padding: 10,
    marginBottom: 12,
    alignItems: 'center',
    gap: 6,
  },
  adLabel: {
    alignSelf: 'flex-start',
    color: palette.textMuted,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  mapModeHint: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  mapModeHintText: {
    color: palette.textSecondary,
    fontSize: 13,
  },
  mapModeHintButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.highlight,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#eaf2ff',
  },
  mapModeHintButtonText: {
    color: palette.highlight,
    fontWeight: '700',
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: '74%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  modalTitle: {
    color: palette.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  modalCommentRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
    paddingVertical: 8,
    gap: 2,
  },
});
