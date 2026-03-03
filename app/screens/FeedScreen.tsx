import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  ViewToken,
  View,
} from 'react-native';
import MapView, {Marker, PROVIDER_GOOGLE, Region} from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import {BannerAd, BannerAdSize} from 'react-native-google-mobile-ads';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Video from 'react-native-video';
import {Rating} from 'react-native-ratings';
import {useTranslation} from 'react-i18next';

import {useAuthContext} from '../context/AuthContext';
import {useAds} from '../context/AdContext';
import {useMap} from '../context/MapContext';
import {
  Spot,
  Review,
  UserProfile,
  addReview,
  getReviewsForSpot,
  getSpots,
  getUserProfile,
} from '../../src/services/firestoreService';
import {
  PostComment,
  PostType,
  SocialPost,
  addPostComment,
  getLikesForPosts,
  getPostComments,
  getSocialPosts,
  getSpotPostDocId,
  submitContentReport,
  togglePostLike,
} from '../../src/services/socialService';
import {feedBannerAdUnitId} from '../../src/constants/adUnits';
import {requestLocationPermission} from '../../src/utils/permissions';
import {palette, shadows} from '../../src/constants/theme';

type FeedTab = 'all' | 'spots';
type ActiveLayer = 'feed' | 'map';

type UnifiedPost = {
  id: string;
  type: Exclude<PostType, 'ad'>;
  createdAtMs: number;
  createdBy: string;
  text: string;
  images: string[];
  videoUrl?: string;
  thumbnailUrl?: string;
  spot?: Spot;
  sourcePost?: SocialPost;
  featured?: boolean;
};

type FeedRow =
  | {kind: 'post'; post: UnifiedPost}
  | {kind: 'ad'; id: string};

const {height: SCREEN_HEIGHT, width: SCREEN_WIDTH} = Dimensions.get('window');

const SHEET_MIN_HEIGHT = 76;
const SHEET_MID_HEIGHT = Math.round(SCREEN_HEIGHT * 0.62);
const SHEET_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * 0.9);
const SHEET_PEEK_THRESHOLD = SHEET_MIN_HEIGHT + 6;
const FEED_AD_FREQUENCY = 4;
const FEED_PRIMARY_TIMEOUT_MS = 12000;
const FEED_SECONDARY_TIMEOUT_MS = 10000;

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

const getTimestampMillis = (value: unknown): number => {
  if (!value) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'object') {
    const timestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof timestamp.toDate === 'function') {
      return timestamp.toDate().getTime();
    }
    if (typeof timestamp.seconds === 'number') {
      return timestamp.seconds * 1000;
    }
  }
  return 0;
};

const getSpotCoordinates = (spot: Spot) => {
  const coordinates: any = (spot as any).coordinates;
  const latitude =
    coordinates?.latitude ??
    coordinates?._latitude ??
    (spot as any).latitude ??
    (spot as any).lat;
  const longitude =
    coordinates?.longitude ??
    coordinates?._longitude ??
    (spot as any).longitude ??
    (spot as any).lng ??
    (spot as any).lon;

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return null;
  }

  return {latitude, longitude};
};

const getVideoPreviewImage = (post: UnifiedPost): string | null => {
  const thumbnail = post.thumbnailUrl?.trim();
  if (thumbnail) {
    return thumbnail;
  }
  if (post.images.length > 0 && post.images[0]) {
    return post.images[0];
  }
  const videoUrl = post.videoUrl?.trim();
  if (!videoUrl) {
    return null;
  }
  if (videoUrl.includes('/playlist.m3u8')) {
    return videoUrl.replace(/\/playlist\.m3u8(\?.*)?$/, '/thumbnail.jpg');
  }
  return null;
};

const calculateDistanceKm = (
  from: {latitude: number; longitude: number},
  to: {latitude: number; longitude: number},
) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(to.latitude - from.latitude);
  const dLon = toRad(to.longitude - from.longitude);
  const lat1 = toRad(from.latitude);
  const lat2 = toRad(to.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

const FeedAdCard = ({label}: {label: string}) => (
  <View style={styles.adCard}>
    <Text style={styles.adLabel}>{label}</Text>
    <BannerAd
      unitId={feedBannerAdUnitId}
      size={BannerAdSize.FULL_BANNER}
      requestOptions={{requestNonPersonalizedAdsOnly: true}}
    />
  </View>
);

export default function FeedScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const {t} = useTranslation();
  const {user, loading: authLoading} = useAuthContext();
  const {areAdsDisabled} = useAds();
  const {region: mapRegion, setRegion: setMapRegion} = useMap();

  const mapRef = useRef<MapView | null>(null);
  const routeRefreshHandledRef = useRef<number | null>(null);
  const routeRefreshRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const spotsRef = useRef<Spot[]>([]);
  const socialPostsRef = useRef<SocialPost[]>([]);
  const profilesByUserIdRef = useRef<Record<string, UserProfile | null>>({});

  const [activeLayer, setActiveLayer] = useState<ActiveLayer>('feed');
  const [feedTab, setFeedTab] = useState<FeedTab>('all');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [spotReviewsBySpotId, setSpotReviewsBySpotId] = useState<Record<string, Review[]>>({});
  const [postCommentsByPostId, setPostCommentsByPostId] = useState<Record<string, PostComment[]>>({});
  const [profilesByUserId, setProfilesByUserId] = useState<Record<string, UserProfile | null>>({});

  const [likedByCurrentUser, setLikedByCurrentUser] = useState<Record<string, boolean>>({});
  const [likeCountByPostId, setLikeCountByPostId] = useState<Record<string, number>>({});

  const [inlineCommentDrafts, setInlineCommentDrafts] = useState<Record<string, string>>({});
  const [savingCommentByPostId, setSavingCommentByPostId] = useState<Record<string, boolean>>({});
  const [savingRatingBySpotId, setSavingRatingBySpotId] = useState<Record<string, boolean>>({});
  const [savingLikeByPostId, setSavingLikeByPostId] = useState<Record<string, boolean>>({});
  const [playingVideoPostId, setPlayingVideoPostId] = useState<string | null>(null);

  const [expandedTextByPostId, setExpandedTextByPostId] = useState<Record<string, boolean>>({});
  const [visibleRows, setVisibleRows] = useState(12);
  const [isPeekMode, setIsPeekMode] = useState(false);

  const [currentLocation, setCurrentLocation] = useState<
    {latitude: number; longitude: number} | null
  >(null);

  const [highlightedSpotId, setHighlightedSpotId] = useState<string | null>(null);
  const [reportSubmittingForPostId, setReportSubmittingForPostId] = useState<
    Record<string, boolean>
  >({});
  const [commentsModalPostId, setCommentsModalPostId] = useState<string | null>(null);
  const playingVideoPostIdRef = useRef<string | null>(null);

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  useEffect(() => {
    socialPostsRef.current = socialPosts;
  }, [socialPosts]);

  useEffect(() => {
    profilesByUserIdRef.current = profilesByUserId;
  }, [profilesByUserId]);

  useEffect(() => {
    playingVideoPostIdRef.current = playingVideoPostId;
  }, [playingVideoPostId]);

  const sheetHeight = useRef(new Animated.Value(SHEET_MID_HEIGHT)).current;
  const sheetHeightValueRef = useRef(SHEET_MID_HEIGHT);
  const panStartHeightRef = useRef(SHEET_MID_HEIGHT);

  const heartScalesRef = useRef<Record<string, Animated.Value>>({});

  useEffect(() => {
    const subscription = sheetHeight.addListener(({value}) => {
      sheetHeightValueRef.current = value;
      const nextPeekMode = value <= SHEET_PEEK_THRESHOLD;
      setIsPeekMode(prev => (prev === nextPeekMode ? prev : nextPeekMode));
    });
    return () => {
      sheetHeight.removeListener(subscription);
    };
  }, [sheetHeight]);

  const getHeartScale = (postId: string) => {
    if (!heartScalesRef.current[postId]) {
      heartScalesRef.current[postId] = new Animated.Value(1);
    }
    return heartScalesRef.current[postId];
  };

  const animateSheetTo = useCallback((targetHeight: number) => {
    Animated.spring(sheetHeight, {
      toValue: targetHeight,
      useNativeDriver: false,
      damping: 18,
      stiffness: 160,
      mass: 0.8,
    }).start();
  }, [sheetHeight]);

  const switchToFeedLayer = () => {
    setActiveLayer('feed');
    animateSheetTo(SHEET_MID_HEIGHT);
  };

  const switchToMapLayer = () => {
    setActiveLayer('map');
    animateSheetTo(SHEET_MIN_HEIGHT);
  };

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

          if (nearest === SHEET_MIN_HEIGHT) {
            setActiveLayer('map');
          } else {
            setActiveLayer('feed');
          }
          animateSheetTo(nearest);
        },
      }),
    [animateSheetTo, sheetHeight],
  );

  const ensureProfiles = useCallback(
    async (userIds: string[]) => {
      const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
      const missing = uniqueUserIds.filter(
        userId => !(userId in profilesByUserIdRef.current),
      );
      if (!missing.length) {
        return;
      }

      const entries = await Promise.all(
        missing.map(async userId => {
          try {
            const profile = await getUserProfile(userId);
            return [userId, profile] as const;
          } catch (profileError) {
            console.warn('[Feed] profile fetch failed', profileError);
            return [userId, null] as const;
          }
        }),
      );

      setProfilesByUserId(prev => ({
        ...prev,
        ...Object.fromEntries(entries),
      }));
    },
    [],
  );

  const fetchLocation = useCallback(async () => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      return;
    }
    Geolocation.getCurrentPosition(
      position => {
        const coords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        setCurrentLocation(coords);
        if (!mapRegion) {
          const nextRegion: Region = {
            ...coords,
            latitudeDelta: 0.09,
            longitudeDelta: 0.05,
          };
          setMapRegion(nextRegion);
        }
      },
      geolocationError => {
        console.warn('[Feed] location error', geolocationError);
      },
      {enableHighAccuracy: false, timeout: 15000, maximumAge: 10000},
    );
  }, [mapRegion, setMapRegion]);

  const refreshContent = useCallback(
    async (isPullRefresh = false) => {
      const requestId = ++refreshRequestIdRef.current;
      const mode = isPullRefresh ? 'pull' : 'initial';
      console.log('[Feed][Load] start', {requestId, mode});

      if (isPullRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const shouldLoadSocial = Boolean(user?.uid) && !authLoading;
        if (!shouldLoadSocial) {
          console.log('[Feed][Load] social content deferred until auth is ready', {
            requestId,
            authLoading,
            hasUser: Boolean(user?.uid),
          });
        }

        const [spotsResult, postsResult] = await Promise.allSettled([
          withTimeout(getSpots(), FEED_PRIMARY_TIMEOUT_MS, 'spots'),
          shouldLoadSocial
            ? withTimeout(getSocialPosts(), FEED_PRIMARY_TIMEOUT_MS, 'posts')
            : Promise.resolve<SocialPost[]>([]),
        ]);

        if (requestId !== refreshRequestIdRef.current) {
          return;
        }

        const spotsOk = spotsResult.status === 'fulfilled';
        const postsOk = postsResult.status === 'fulfilled';

        if (!spotsOk) {
          console.warn('[Feed][Load] spots failed', spotsResult.reason);
        }
        if (!postsOk) {
          console.warn('[Feed][Load] posts failed', postsResult.reason);
        }

        const validSpots = spotsOk
          ? spotsResult.value.filter(spot => Boolean(spot.id))
          : spotsRef.current;
        const validPosts = postsOk
          ? postsResult.value.filter(post => Boolean(post.id))
          : socialPostsRef.current;

        setSpots(validSpots);
        setSocialPosts(validPosts);
        spotsRef.current = validSpots;
        socialPostsRef.current = validPosts;

        console.log('[Feed][Load] primary', {
          requestId,
          spotsOk,
          postsOk,
          spotCount: validSpots.length,
          postCount: validPosts.length,
        });

        const hasAnyPrimaryData = validSpots.length > 0 || validPosts.length > 0;
        if (!hasAnyPrimaryData) {
          setSpotReviewsBySpotId({});
          setPostCommentsByPostId({});
          setLikeCountByPostId({});
          setLikedByCurrentUser({});
          if (!spotsOk || !postsOk) {
            setError(t('feed.errorLoad'));
          }
          console.warn('[Feed][Load] no primary data available', {requestId});
          return;
        }

        if (!isPullRefresh) {
          // Keep skeleton only for primary payload. Secondary enrichment can load in background.
          setLoading(false);
        }

        const spotReviewsEntries = await Promise.allSettled(
          validSpots.map(async spot => {
            const reviews = await withTimeout(
              getReviewsForSpot(spot.id!),
              FEED_SECONDARY_TIMEOUT_MS,
              `reviews:${spot.id}`,
            );
            return [spot.id!, reviews] as const;
          }),
        );

        if (requestId !== refreshRequestIdRef.current) {
          return;
        }

        const spotReviewsMap: Record<string, Review[]> = {};
        let spotReviewFailures = 0;
        spotReviewsEntries.forEach(entry => {
          if (entry.status === 'fulfilled') {
            spotReviewsMap[entry.value[0]] = entry.value[1];
          } else {
            spotReviewFailures += 1;
          }
        });
        if (spotReviewFailures > 0) {
          console.warn('[Feed][Load] spot reviews partial failure', {
            requestId,
            failures: spotReviewFailures,
          });
        }
        setSpotReviewsBySpotId(spotReviewsMap);

        const dronePosts = validPosts.filter(post => post.type === 'drone');
        const droneCommentEntries = await Promise.allSettled(
          dronePosts.map(async post => {
            const comments = await withTimeout(
              getPostComments(post.id!),
              FEED_SECONDARY_TIMEOUT_MS,
              `postComments:${post.id}`,
            );
            return [post.id!, comments] as const;
          }),
        );

        if (requestId !== refreshRequestIdRef.current) {
          return;
        }

        const postCommentsMap: Record<string, PostComment[]> = {};
        let postCommentFailures = 0;
        droneCommentEntries.forEach(entry => {
          if (entry.status === 'fulfilled') {
            postCommentsMap[entry.value[0]] = entry.value[1];
          } else {
            postCommentFailures += 1;
          }
        });
        if (postCommentFailures > 0) {
          console.warn('[Feed][Load] post comments partial failure', {
            requestId,
            failures: postCommentFailures,
          });
        }
        setPostCommentsByPostId(postCommentsMap);

        const userIds = [
          ...validSpots.map(spot => spot.createdBy),
          ...validPosts.map(post => post.createdBy),
          ...Object.values(spotReviewsMap)
            .flat()
            .map(review => review.userId),
          ...Object.values(postCommentsMap)
            .flat()
            .map(comment => comment.userId),
        ];
        await ensureProfiles(userIds);

        if (shouldLoadSocial) {
          const postIdsForLikes = [
            ...dronePosts.map(post => post.id!),
            ...validSpots.map(spot => getSpotPostDocId(spot.id!)),
          ];
          try {
            const likeSummary = await withTimeout(
              getLikesForPosts(postIdsForLikes),
              FEED_SECONDARY_TIMEOUT_MS,
              'likes',
            );
            if (requestId !== refreshRequestIdRef.current) {
              return;
            }
            setLikeCountByPostId(likeSummary.countsByPostId);
            setLikedByCurrentUser(likeSummary.likedByCurrentUser);
          } catch (likeError) {
            console.warn('[Feed][Load] likes failed', likeError);
            if (requestId !== refreshRequestIdRef.current) {
              return;
            }
            setLikeCountByPostId({});
            setLikedByCurrentUser({});
          }
        } else {
          setLikeCountByPostId({});
          setLikedByCurrentUser({});
        }

        console.log('[Feed][Merge] hydrated', {
          requestId,
          mergedApprox: validSpots.length + dronePosts.length,
          spotReviewCount: Object.keys(spotReviewsMap).length,
          postCommentCount: Object.keys(postCommentsMap).length,
        });
      } catch (loadError) {
        console.error('[Feed] refresh failed', loadError);
        setError(t('feed.errorLoad'));
      } finally {
        if (requestId === refreshRequestIdRef.current) {
          hasLoadedOnceRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authLoading, ensureProfiles, t, user?.uid],
  );

  useEffect(() => {
    refreshContent();
    fetchLocation();
  }, [fetchLocation, refreshContent]);

  useEffect(() => {
    if (authLoading || !hasLoadedOnceRef.current) {
      return;
    }
    refreshContent(true);
  }, [authLoading, refreshContent, user?.uid]);

  useFocusEffect(
    useCallback(() => {
      if (hasLoadedOnceRef.current) {
        refreshContent(true);
      }
    }, [refreshContent]),
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
      console.log('[Feed][Load] route refresh requested', {refreshAt, createdPostId});
      setFeedTab('all');
      setVisibleRows(12);
      await refreshContent(true);
      if (cancelled || !createdPostId) {
        return;
      }

      const isCreatedPostVisible = socialPostsRef.current.some(
        post => post.id === createdPostId,
      );
      if (isCreatedPostVisible) {
        console.log('[Feed][Load] created post visible', {createdPostId});
        return;
      }

      console.warn('[Feed][Load] created post not visible yet, retrying', {
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
  }, [refreshContent, route?.params?.createdPostId, route?.params?.refreshAt]);

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

    return [...spotUnified, ...droneUnified];
  }, [socialPosts, spots]);

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

  const commentsModalMetric = useMemo(
    () => postMetrics.find(item => item.post.id === commentsModalPostId) ?? null,
    [commentsModalPostId, postMetrics],
  );

  const visibleRowsData = useMemo(
    () => feedRows.slice(0, visibleRows),
    [feedRows, visibleRows],
  );

  useEffect(() => {
    if (loading) {
      return;
    }
    console.log('[Feed][Merge] render', {
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

  const focusSpotOnMap = (spot: Spot) => {
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
  };

  const onToggleLike = async (post: UnifiedPost) => {
    if (authLoading || !user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }

    const postId = post.id;
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
      console.error('[Feed] like toggle failed', likeError);
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
  };

  const onRateSpot = async (spotId: string, rating: number) => {
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
      console.error('[Feed] spot rating failed', ratingError);
      Alert.alert(t('alerts.error'), t('alerts.addReviewError'));
    } finally {
      setSavingRatingBySpotId(prev => ({...prev, [spotId]: false}));
    }
  };

  const onSendComment = async (post: UnifiedPost) => {
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
      console.error('[Feed] comment publish failed', commentError);
      Alert.alert(t('alerts.error'), t('alerts.addReviewError'));
      setInlineCommentDrafts(prev => ({...prev, [post.id]: draft}));
    } finally {
      setSavingCommentByPostId(prev => ({...prev, [post.id]: false}));
    }
  };

  const onReportPost = (post: UnifiedPost) => {
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
              console.error('[Feed] report failed', reportError);
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
              console.error('[Feed] report failed', reportError);
              Alert.alert(t('alerts.error'), t('feed.reportError'));
            } finally {
              setReportSubmittingForPostId(prev => ({...prev, [post.id]: false}));
            }
          },
        },
      ],
    );
  };

  const goToSpotDetail = (spotId?: string) => {
    if (!spotId) {
      return;
    }
    navigation.navigate('SpotDetail', {spotId});
  };

  const renderPostCard = (post: UnifiedPost) => {
    const metric = postMetrics.find(item => item.post.id === post.id);
    if (!metric) {
      return null;
    }

    const commentsPreview = metric.comments.slice(0, 2);
    const postAuthor = profilesByUserId[post.createdBy]?.displayName || t('common.unknownUser');
    const postText = post.text;
    const isExpanded = Boolean(expandedTextByPostId[post.id]);
    const shouldCollapse = postText.length > 180;
    const liked = Boolean(likedByCurrentUser[post.id]);
    const videoPreviewUri = post.videoUrl ? getVideoPreviewImage(post) : null;
    const isVideoPlaying = Boolean(post.videoUrl) && playingVideoPostId === post.id;

    const userSpotRating =
      post.type === 'spot'
        ? metric.ratings.find(review => review.userId === user?.uid)?.rating ?? 0
        : 0;

    return (
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <View style={styles.cardHeadLeft}>
            <Icon
              name={post.type === 'spot' ? 'map-marker' : 'drone'}
              size={16}
              color={post.type === 'spot' ? '#0f766e' : '#0369a1'}
            />
            <Text style={styles.cardHeadType}>
              {post.type === 'spot' ? t('feed.badgeSpot') : t('feed.badgeDrone')}
            </Text>
          </View>
          <Text style={styles.cardHeadAuthor}>@{postAuthor}</Text>
        </View>

        <View style={styles.mediaFrame}>
          {post.videoUrl ? (
            <Pressable
              style={styles.videoPressable}
              onPress={() =>
                setPlayingVideoPostId(prev => (prev === post.id ? null : post.id))
              }>
              {isVideoPlaying ? (
                <Video
                  source={{uri: post.videoUrl}}
                  style={styles.videoView}
                  resizeMode="cover"
                  paused={false}
                  muted
                  repeat
                  controls={false}
                  onError={playbackError => {
                    console.warn('[Feed] video playback failed', {
                      postId: post.id,
                      error: playbackError,
                    });
                    setPlayingVideoPostId(null);
                  }}
                />
              ) : videoPreviewUri ? (
                <Image source={{uri: videoPreviewUri}} style={styles.imageView} />
              ) : (
                <View style={styles.mediaFallback}>
                  <Icon name="video-off-outline" size={24} color={palette.textMuted} />
                  <Text style={styles.mediaFallbackText}>{t('feed.video')}</Text>
                </View>
              )}
              <View style={styles.videoPill}>
                <Icon name="play-circle" size={18} color="#fff" />
                <Text style={styles.videoPillText}>{t('feed.video')}</Text>
              </View>
              <View style={styles.videoTogglePill}>
                <Icon
                  name={isVideoPlaying ? 'pause-circle' : 'play-circle'}
                  size={18}
                  color="#fff"
                />
              </View>
            </Pressable>
          ) : post.images.length ? (
            <Image source={{uri: post.images[0]}} style={styles.imageView} />
          ) : (
            <View style={styles.mediaFallback}>
              <Icon name="image-off-outline" size={24} color={palette.textMuted} />
              <Text style={styles.mediaFallbackText}>{t('feed.noMedia')}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardContent}>
          {postText ? (
            <>
              <Text
                style={styles.postText}
                numberOfLines={shouldCollapse && !isExpanded ? 3 : undefined}>
                {postText}
              </Text>
              {shouldCollapse ? (
                <TouchableOpacity
                  onPress={() =>
                    setExpandedTextByPostId(prev => ({
                      ...prev,
                      [post.id]: !prev[post.id],
                    }))
                  }>
                  <Text style={styles.linkText}>
                    {isExpanded ? t('feed.seeLess') : t('feed.seeMore')}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : null}

          {post.type === 'spot' ? (
            <View style={styles.spotMetaRow}>
              <View style={styles.spotRatingSummary}>
                <Icon name="star" size={14} color="#f59e0b" />
                <Text style={styles.spotRatingText}>
                  {Number(post.spot?.averageRating || 0).toFixed(1)}
                  {' · '}
                  {post.spot?.ratingCount ?? post.spot?.reviewCount ?? 0}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.mapButton}
                onPress={() => focusSpotOnMap(post.spot!)}>
                <Icon name="map-marker-radius" size={15} color="#fff" />
                <Text style={styles.mapButtonText}>{t('feed.viewOnMap')}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            <Pressable onPress={() => onToggleLike(post)}>
              <Animated.View
                style={[
                  styles.actionIconButton,
                  {transform: [{scale: getHeartScale(post.id)}]},
                ]}>
                <Icon
                  name={liked ? 'heart' : 'heart-outline'}
                  size={20}
                  color={liked ? '#ef4444' : palette.textSecondary}
                />
                <Text style={styles.actionLabel}>{metric.likesCount}</Text>
                {savingLikeByPostId[post.id] ? (
                  <ActivityIndicator size="small" color={palette.textMuted} />
                ) : null}
              </Animated.View>
            </Pressable>

            <View style={styles.actionIconButton}>
              <Icon name="comment-outline" size={20} color={palette.textSecondary} />
              <Text style={styles.actionLabel}>{metric.comments.length}</Text>
            </View>

            <TouchableOpacity style={styles.actionIconButton} onPress={() => onReportPost(post)}>
              <Icon
                name={reportSubmittingForPostId[post.id] ? 'progress-clock' : 'flag-outline'}
                size={20}
                color={palette.textSecondary}
              />
              <Text style={styles.actionLabel}>{t('feed.report')}</Text>
            </TouchableOpacity>
          </View>

          {post.type === 'spot' ? (
            <View style={styles.inlineRatingWrap}>
              <Text style={styles.inlineSectionTitle}>{t('feed.yourRating')}</Text>
              <View style={styles.inlineRatingRow}>
                <Rating
                  type="star"
                  imageSize={22}
                  ratingCount={5}
                  startingValue={userSpotRating}
                  onFinishRating={value => onRateSpot(post.spot!.id!, value)}
                  readonly={Boolean(savingRatingBySpotId[post.spot!.id!])}
                />
                {savingRatingBySpotId[post.spot!.id!] ? (
                  <ActivityIndicator size="small" color={palette.highlight} />
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={styles.commentsBlock}>
            <Text style={styles.inlineSectionTitle}>{t('feed.latestComments')}</Text>
            {commentsPreview.length ? (
              commentsPreview.map(comment => {
                const userId =
                  (comment as Review).userId || (comment as PostComment).userId;
                const author =
                  profilesByUserId[userId]?.displayName || t('common.unknownUser');
                const text =
                  (comment as Review).text || (comment as PostComment).text || '';
                return (
                  <View
                    key={(comment as Review).id || (comment as PostComment).id}
                    style={styles.commentBubble}>
                    <Text style={styles.commentAuthor}>{author}</Text>
                    <Text style={styles.commentText}>{text}</Text>
                  </View>
                );
              })
            ) : (
              <Text style={styles.commentEmpty}>{t('feed.noCommentsYet')}</Text>
            )}

            <View style={styles.commentInputRow}>
              <TextInput
                style={styles.commentInput}
                placeholder={t('feed.commentPlaceholder')}
                placeholderTextColor={palette.textMuted}
                value={inlineCommentDrafts[post.id] ?? ''}
                onChangeText={value =>
                  setInlineCommentDrafts(prev => ({
                    ...prev,
                    [post.id]: value,
                  }))
                }
              />
              <TouchableOpacity
                style={styles.sendButton}
                onPress={() => onSendComment(post)}
                disabled={Boolean(savingCommentByPostId[post.id])}>
                {savingCommentByPostId[post.id] ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Icon name="send" size={18} color="#fff" />
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={() => setCommentsModalPostId(post.id)}>
              <Text style={styles.linkText}>{t('feed.viewAllComments')}</Text>
            </TouchableOpacity>

            {post.type === 'spot' ? (
              <View style={styles.spotActionFooter}>
                <TouchableOpacity onPress={() => goToSpotDetail(post.spot?.id)}>
                  <Text style={styles.linkText}>{t('feed.exploreSpot')}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => focusSpotOnMap(post.spot!)}>
                  <Text style={styles.linkText}>{t('feed.viewOnMap')}</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const renderRow = ({item}: {item: FeedRow}) => {
    if (item.kind === 'ad') {
      return <FeedAdCard label={t('feed.adLabel')} />;
    }
    return renderPostCard(item.post);
  };

  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 45,
  });

  const onViewableItemsChanged = useRef(
    ({viewableItems}: {viewableItems: Array<ViewToken>}) => {
      const currentPlayingId = playingVideoPostIdRef.current;
      if (!currentPlayingId) {
        return;
      }
      const isPlayingPostVisible = viewableItems.some(viewable => {
        const row = viewable.item as FeedRow | undefined;
        return row?.kind === 'post' && row.post.id === currentPlayingId;
      });
      if (!isPlayingPostVisible) {
        setPlayingVideoPostId(null);
      }
    },
  ).current;

  useEffect(() => {
    if (activeLayer !== 'feed' || isPeekMode) {
      setPlayingVideoPostId(null);
    }
  }, [activeLayer, isPeekMode]);

  useEffect(() => {
    setPlayingVideoPostId(null);
  }, [feedTab]);

  return (
    <View style={styles.container}>
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
          {spots.map(spot => {
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
          })}
        </MapView>
      </View>

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

        {activeLayer === 'feed' && !isPeekMode ? (
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
                data={visibleRowsData}
                keyExtractor={item =>
                  item.kind === 'ad' ? item.id : `post-${item.post.id}`
                }
                renderItem={renderRow}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfigRef.current}
                onRefresh={() => refreshContent(true)}
                refreshing={refreshing}
                onEndReached={() => {
                  if (visibleRows < feedRows.length) {
                    setVisibleRows(prev => prev + 10);
                  }
                }}
                onEndReachedThreshold={0.35}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
              />
            )}

            <TouchableOpacity
              style={styles.fab}
              onPress={() => {
                Alert.alert(
                  t('feed.publishMenuTitle'),
                  '',
                  [
                    {
                      text: t('common.cancel'),
                      style: 'cancel',
                    },
                    {
                      text: t('feed.publishSpot'),
                      onPress: () => navigation.navigate('AddSpot'),
                    },
                    {
                      text: t('feed.publishDronePost'),
                      onPress: () => navigation.navigate('CreateDronePost'),
                    },
                  ],
                );
              }}>
              <Icon name="plus" size={28} color="#fff" />
            </TouchableOpacity>
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
              keyExtractor={value =>
                value.id ?? `${value.userId}-${getTimestampMillis(value.createdAt)}`
              }
              renderItem={({item: value}) => {
                const author =
                  profilesByUserId[value.userId]?.displayName || t('common.unknownUser');
                return (
                  <View style={styles.modalCommentRow}>
                    <Text style={styles.commentAuthor}>{author}</Text>
                    <Text style={styles.commentText}>{value.text ?? ''}</Text>
                  </View>
                );
              }}
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    overflow: 'hidden',
    marginBottom: 12,
    ...shadows.subtle,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
  },
  cardHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardHeadType: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textSecondary,
    textTransform: 'uppercase',
  },
  cardHeadAuthor: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  mediaFrame: {
    height: 220,
    backgroundColor: '#e2e8f0',
  },
  videoPressable: {
    flex: 1,
  },
  imageView: {
    width: SCREEN_WIDTH - 24,
    height: 220,
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  videoPill: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
    paddingVertical: 4,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  videoTogglePill: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  mediaFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaFallbackText: {
    color: palette.textMuted,
    fontSize: 12,
  },
  cardContent: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  postText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  linkText: {
    color: palette.highlight,
    fontSize: 13,
    fontWeight: '700',
  },
  spotMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  spotRatingSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  spotRatingText: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionLabel: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineRatingWrap: {
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: '#edf2f7',
    paddingTop: 8,
  },
  inlineSectionTitle: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineRatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentsBlock: {
    gap: 8,
  },
  commentBubble: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#f8fafc',
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
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: palette.textPrimary,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: palette.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotActionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: palette.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.medium,
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
