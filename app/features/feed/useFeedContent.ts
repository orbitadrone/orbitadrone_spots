import {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';

import {
  Review,
  Spot,
  UserProfile,
  getReviewsForSpots,
  getSpots,
  getUserProfiles,
} from '../../../src/services/firestoreService';
import {
  PostComment,
  SocialPost,
  getLikesForPosts,
  getPostCommentsForPosts,
  getSocialPosts,
  getSpotPostDocId,
} from '../../../src/services/socialService';
import logger from '../../../src/utils/logger';
import {
  FEED_AUTO_REFRESH_MIN_INTERVAL_MS,
  FEED_PRIMARY_TIMEOUT_MS,
  FEED_SECONDARY_TIMEOUT_MS,
  withTimeout,
} from './feedShared';

type UseFeedContentArgs = {
  authLoading: boolean;
  userId?: string;
  loadErrorMessage: string;
};

type Coordinate = {
  latitude: number;
  longitude: number;
};

export const useFeedContent = ({
  authLoading,
  userId,
  loadErrorMessage,
}: UseFeedContentArgs) => {
  const refreshRequestIdRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const lastRefreshStartedAtRef = useRef(0);
  const spotsRef = useRef<Spot[]>([]);
  const socialPostsRef = useRef<SocialPost[]>([]);
  const profilesByUserIdRef = useRef<Record<string, UserProfile | null>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [spotReviewsBySpotId, setSpotReviewsBySpotId] = useState<Record<string, Review[]>>({});
  const [postCommentsByPostId, setPostCommentsByPostId] = useState<Record<string, PostComment[]>>(
    {},
  );
  const [profilesByUserId, setProfilesByUserId] = useState<Record<string, UserProfile | null>>(
    {},
  );
  const [likedByCurrentUser, setLikedByCurrentUser] = useState<Record<string, boolean>>({});
  const [likeCountByPostId, setLikeCountByPostId] = useState<Record<string, number>>({});
  const [currentLocation] = useState<Coordinate | null>(null);

  useEffect(() => {
    spotsRef.current = spots;
  }, [spots]);

  useEffect(() => {
    socialPostsRef.current = socialPosts;
  }, [socialPosts]);

  useEffect(() => {
    profilesByUserIdRef.current = profilesByUserId;
  }, [profilesByUserId]);

  const ensureProfiles = useCallback(async (userIds: string[]) => {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
    const missing = uniqueUserIds.filter(userIdValue => !(userIdValue in profilesByUserIdRef.current));
    if (!missing.length) {
      return;
    }

    try {
      const profiles = await getUserProfiles(missing);
      setProfilesByUserId(previous => ({
        ...previous,
        ...profiles,
      }));
    } catch (profileError) {
      logger.warn('[Feed] profile fetch failed', profileError);
      setProfilesByUserId(previous => ({
        ...previous,
        ...Object.fromEntries(missing.map(missingUserId => [missingUserId, null])),
      }));
    }
  }, []);

  const refreshContent = useCallback(
    async (isPullRefresh = false) => {
      const requestId = ++refreshRequestIdRef.current;
      const mode = isPullRefresh ? 'pull' : 'initial';
      lastRefreshStartedAtRef.current = Date.now();
      logger.log('[Feed][Load] start', {requestId, mode});

      if (isPullRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const shouldLoadSocial = Boolean(userId) && !authLoading;
        if (!shouldLoadSocial) {
          logger.log('[Feed][Load] social content deferred until auth is ready', {
            requestId,
            authLoading,
            hasUser: Boolean(userId),
          });
        }

        const [spotsResult, postsResult] = await Promise.allSettled([
          withTimeout(
            getSpots({forceRefresh: isPullRefresh}),
            FEED_PRIMARY_TIMEOUT_MS,
            'spots',
          ),
          shouldLoadSocial
            ? withTimeout(
                getSocialPosts({forceRefresh: isPullRefresh}),
                FEED_PRIMARY_TIMEOUT_MS,
                'posts',
              )
            : Promise.resolve<SocialPost[]>([]),
        ]);

        if (requestId !== refreshRequestIdRef.current) {
          return;
        }

        const spotsOk = spotsResult.status === 'fulfilled';
        const postsOk = postsResult.status === 'fulfilled';

        if (!spotsOk) {
          logger.warn('[Feed][Load] spots failed', spotsResult.reason);
        }
        if (!postsOk) {
          logger.warn('[Feed][Load] posts failed', postsResult.reason);
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

        logger.log('[Feed][Load] primary', {
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
            setError(loadErrorMessage);
          }
          logger.warn('[Feed][Load] no primary data available', {requestId});
          return;
        }

        if (!isPullRefresh) {
          setLoading(false);
        }

        const spotReviewsMap = await withTimeout(
          getReviewsForSpots(validSpots.map(spot => spot.id!).filter(Boolean)),
          FEED_SECONDARY_TIMEOUT_MS,
          'spotReviews',
        );

        if (requestId !== refreshRequestIdRef.current) {
          return;
        }

        setSpotReviewsBySpotId(spotReviewsMap);

        const commentablePosts = validPosts.filter(post => post.type !== 'spot');
        const postCommentsMap = await withTimeout(
          getPostCommentsForPosts(commentablePosts.map(post => post.id!).filter(Boolean)),
          FEED_SECONDARY_TIMEOUT_MS,
          'postComments',
        );

        if (requestId !== refreshRequestIdRef.current) {
          return;
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
          const spotPostIdBySpotId = new Map<string, string>();
          validPosts.forEach(post => {
            if (post.type === 'spot' && post.spotId && post.id) {
              spotPostIdBySpotId.set(post.spotId, post.id);
            }
          });

          const likeAliasesByPostId: Record<string, string[]> = {};
          commentablePosts.forEach(post => {
            if (!post.id) {
              return;
            }
            likeAliasesByPostId[post.id] = [post.id];
          });
          validSpots.forEach(spot => {
            if (!spot.id) {
              return;
            }
            const syntheticSpotPostId = getSpotPostDocId(spot.id);
            const linkedSpotPostId = spotPostIdBySpotId.get(spot.id);
            const unifiedSpotPostId = linkedSpotPostId ?? syntheticSpotPostId;
            likeAliasesByPostId[unifiedSpotPostId] = Array.from(
              new Set(
                [unifiedSpotPostId, linkedSpotPostId, syntheticSpotPostId].filter(
                  (value): value is string => Boolean(value),
                ),
              ),
            );
          });

          const postIdsForLikes = Array.from(new Set(Object.values(likeAliasesByPostId).flat()));
          try {
            const likeSummary = await withTimeout(
              getLikesForPosts(postIdsForLikes),
              FEED_SECONDARY_TIMEOUT_MS,
              'likes',
            );
            if (requestId !== refreshRequestIdRef.current) {
              return;
            }
            const mergedCountsByPostId: Record<string, number> = {};
            const mergedLikedByCurrentUser: Record<string, boolean> = {};

            Object.entries(likeAliasesByPostId).forEach(([postIdValue, aliases]) => {
              mergedCountsByPostId[postIdValue] = aliases.reduce(
                (sum, aliasPostId) => sum + (likeSummary.countsByPostId[aliasPostId] ?? 0),
                0,
              );
              mergedLikedByCurrentUser[postIdValue] = aliases.some(aliasPostId =>
                Boolean(likeSummary.likedByCurrentUser[aliasPostId]),
              );
            });

            setLikeCountByPostId(mergedCountsByPostId);
            setLikedByCurrentUser(mergedLikedByCurrentUser);
          } catch (likeError) {
            logger.warn('[Feed][Load] likes failed', likeError);
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

        logger.log('[Feed][Merge] hydrated', {
          requestId,
          mergedApprox: validSpots.length + commentablePosts.length,
          spotReviewCount: Object.keys(spotReviewsMap).length,
          postCommentCount: Object.keys(postCommentsMap).length,
        });
      } catch (loadError) {
        logger.error('[Feed] refresh failed', loadError);
        setError(loadErrorMessage);
      } finally {
        if (requestId === refreshRequestIdRef.current) {
          hasLoadedOnceRef.current = true;
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authLoading, ensureProfiles, loadErrorMessage, userId],
  );

  const refreshContentIfStale = useCallback(() => {
    if (!hasLoadedOnceRef.current) {
      return;
    }

    const elapsedMs = Date.now() - lastRefreshStartedAtRef.current;
    if (elapsedMs < FEED_AUTO_REFRESH_MIN_INTERVAL_MS) {
      logger.log('[Feed][Load] focus refresh skipped', {
        elapsedMs,
        minIntervalMs: FEED_AUTO_REFRESH_MIN_INTERVAL_MS,
      });
      return;
    }

    refreshContent(true);
  }, [refreshContent]);

  useEffect(() => {
    refreshContent();
  }, [refreshContent]);

  useEffect(() => {
    if (authLoading || !hasLoadedOnceRef.current) {
      return;
    }
    refreshContent(true);
  }, [authLoading, refreshContent, userId]);

  useFocusEffect(
    useCallback(() => {
      refreshContentIfStale();
    }, [refreshContentIfStale]),
  );

  const isPostVisible = useCallback(
    (postId: string) => socialPostsRef.current.some(post => post.id === postId),
    [],
  );

  return {
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
  };
};
