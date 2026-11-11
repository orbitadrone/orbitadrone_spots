import {
  Review,
  Spot,
  UserModerationStatus,
  UserProfile,
} from '../../../src/services/firestoreService';
import {ContentReport, PostComment} from '../../../src/services/socialService';

export type AdminSection = 'dashboard' | 'spots' | 'comments' | 'users' | 'reports';
export type SpotActivityFilter = 'all' | '24h' | '7d' | 'hidden';
export type AdminCommentItem =
  | {
      kind: 'spotReview';
      id: string;
      userId: string;
      text: string;
      createdAt: unknown;
      moderationStatus?: string;
      spotId?: string;
      postId?: string;
    }
  | {
      kind: 'postComment';
      id: string;
      userId: string;
      text: string;
      createdAt: unknown;
      moderationStatus?: string;
      spotId?: string;
      postId: string;
    };

export type AdminSpotMetric = {
  spot: Spot;
  spotReviews: Review[];
  commentCount: number;
  ratingCount: number;
  lastActivityMs: number;
};

export type AdminDashboardStats = {
  totalSpots: number;
  totalUsers: number;
  totalComments: number;
  totalSpotComments: number;
  totalPostComments: number;
  totalRatings: number;
  totalReports: number;
  openReports: number;
  hiddenSpots: number;
  newSpots24h: number;
  newSpots7d: number;
  activity24h: number;
  activity7d: number;
};

export type AdminUserActivity = {
  spotsCount: number;
  commentsCount: number;
  ratingsCount: number;
};

export type AdminSelectedSpotDetails = {
  spot: Spot;
  spotReviews: Review[];
  comments: Review[];
  ratings: Review[];
};

export const ADMIN_SECTION_VALUES: AdminSection[] = [
  'dashboard',
  'spots',
  'comments',
  'users',
  'reports',
];

export const SPOT_ACTIVITY_FILTER_VALUES: SpotActivityFilter[] = [
  'all',
  '24h',
  '7d',
  'hidden',
];

export const REPORT_STATUS_ORDER: NonNullable<ContentReport['status']>[] = [
  'open',
  'in_review',
  'resolved',
  'dismissed',
];

export const STATUS_OPTIONS: UserModerationStatus[] = [
  'active',
  'flagged',
  'suspended',
  'blocked',
];

export const getTimestampMillis = (value: unknown): number => {
  if (!value) {
    return 0;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'object') {
    const maybeTimestamp = value as {
      toDate?: () => Date;
      seconds?: number;
      nanoseconds?: number;
    };
    if (typeof maybeTimestamp.toDate === 'function') {
      return maybeTimestamp.toDate().getTime();
    }
    if (typeof maybeTimestamp.seconds === 'number') {
      return maybeTimestamp.seconds * 1000;
    }
  }
  return 0;
};

export const formatAdminDate = (value: unknown, t: (key: string) => string) => {
  const millis = getTimestampMillis(value);
  if (!millis) {
    return t('common.na');
  }
  return new Date(millis).toLocaleString();
};

export const buildSpotMedia = (spot: Spot) => {
  const images = [spot.mainImage, ...(spot.galleryImages ?? [])].filter(
    (image): image is string => Boolean(image),
  );
  return {
    video: spot.videoUrl ?? null,
    images,
  };
};

export const buildReviewsBySpotId = (reviews: Review[]) => {
  const grouped: Record<string, Review[]> = {};
  reviews.forEach(review => {
    if (!review.spotId) {
      return;
    }
    if (!grouped[review.spotId]) {
      grouped[review.spotId] = [];
    }
    grouped[review.spotId].push(review);
  });

  Object.keys(grouped).forEach(spotId => {
    grouped[spotId].sort(
      (a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt),
    );
  });

  return grouped;
};

export const buildSpotMetrics = (
  spots: Spot[],
  reviewsBySpotId: Record<string, Review[]>,
): AdminSpotMetric[] =>
  spots.map(spot => {
    const spotReviews = reviewsBySpotId[spot.id ?? ''] ?? [];
    const commentCount = spotReviews.filter(review => review.type === 'comment').length;
    const ratingCount = spotReviews.filter(review => review.type === 'rating').length;
    const latestReviewMs = spotReviews.length
      ? Math.max(...spotReviews.map(review => getTimestampMillis(review.createdAt)))
      : 0;
    const createdAtMs = getTimestampMillis(spot.createdAt);

    return {
      spot,
      spotReviews,
      commentCount,
      ratingCount,
      lastActivityMs: Math.max(createdAtMs, latestReviewMs),
    };
  });

export const buildDashboardStats = ({
  spots,
  reviews,
  postComments,
  reports,
  usersCount,
  nowMs,
}: {
  spots: Spot[];
  reviews: Review[];
  postComments: PostComment[];
  reports: ContentReport[];
  usersCount: number;
  nowMs: number;
}): AdminDashboardStats => {
  const last24hMs = nowMs - 24 * 60 * 60 * 1000;
  const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  const totalSpotComments = reviews.filter(review => review.type === 'comment').length;
  const totalRatings = reviews.filter(review => review.type === 'rating').length;
  const totalPostComments = postComments.length;

  return {
    totalSpots: spots.length,
    totalUsers: usersCount,
    totalComments: totalSpotComments + totalPostComments,
    totalSpotComments,
    totalPostComments,
    totalRatings,
    totalReports: reports.length,
    openReports: reports.filter(report => report.status === 'open').length,
    hiddenSpots: spots.filter(spot => spot.isHidden).length,
    newSpots24h: spots.filter(spot => getTimestampMillis(spot.createdAt) >= last24hMs).length,
    newSpots7d: spots.filter(spot => getTimestampMillis(spot.createdAt) >= last7dMs).length,
    activity24h:
      reviews.filter(review => getTimestampMillis(review.createdAt) >= last24hMs).length +
      postComments.filter(comment => getTimestampMillis(comment.createdAt) >= last24hMs).length,
    activity7d:
      reviews.filter(review => getTimestampMillis(review.createdAt) >= last7dMs).length +
      postComments.filter(comment => getTimestampMillis(comment.createdAt) >= last7dMs).length,
  };
};

export const buildUserActivityByUserId = (
  spots: Spot[],
  reviews: Review[],
): Record<string, AdminUserActivity> => {
  const activityByUserId: Record<string, AdminUserActivity> = {};

  const ensureActivity = (userId: string) => {
    if (!activityByUserId[userId]) {
      activityByUserId[userId] = {
        spotsCount: 0,
        commentsCount: 0,
        ratingsCount: 0,
      };
    }
    return activityByUserId[userId];
  };

  spots.forEach(spot => {
    if (!spot.createdBy) {
      return;
    }
    ensureActivity(spot.createdBy).spotsCount += 1;
  });

  reviews.forEach(review => {
    if (!review.userId) {
      return;
    }
    const activity = ensureActivity(review.userId);
    if (review.type === 'comment') {
      activity.commentsCount += 1;
      return;
    }
    if (review.type === 'rating') {
      activity.ratingsCount += 1;
    }
  });

  return activityByUserId;
};

export const buildFilteredSpots = ({
  last24hMs,
  last7dMs,
  normalizedSearch,
  spotFilter,
  spotMetrics,
  usersById,
}: {
  last24hMs: number;
  last7dMs: number;
  normalizedSearch: string;
  spotFilter: SpotActivityFilter;
  spotMetrics: AdminSpotMetric[];
  usersById: Record<string, UserProfile>;
}) =>
  spotMetrics
    .filter(item => {
      if (spotFilter === '24h' && item.lastActivityMs < last24hMs) {
        return false;
      }
      if (spotFilter === '7d' && item.lastActivityMs < last7dMs) {
        return false;
      }
      if (spotFilter === 'hidden' && !item.spot.isHidden) {
        return false;
      }
      if (!normalizedSearch) {
        return true;
      }
      const author = usersById[item.spot.createdBy]?.displayName ?? '';
      const haystack =
        `${item.spot.name ?? ''} ${item.spot.address ?? ''} ${item.spot.description ?? ''} ${author}`
          .toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);

export const buildFilteredComments = ({
  normalizedSearch,
  postComments,
  reviews,
  spotsById,
  usersById,
}: {
  normalizedSearch: string;
  postComments: PostComment[];
  reviews: Review[];
  spotsById: Record<string, Spot>;
  usersById: Record<string, UserProfile>;
}): AdminCommentItem[] => {
  const spotComments: AdminCommentItem[] = reviews
    .filter(review => review.type === 'comment' && Boolean(review.id) && Boolean(review.text))
    .map(review => ({
      kind: 'spotReview',
      id: review.id!,
      userId: review.userId,
      text: review.text ?? '',
      createdAt: review.createdAt,
      moderationStatus: review.moderationStatus ?? 'approved',
      spotId: review.spotId,
      postId: review.spotId ? `spot_${review.spotId}` : undefined,
    }));

  const feedComments: AdminCommentItem[] = postComments
    .filter(comment => Boolean(comment.id) && Boolean(comment.text))
    .map(comment => ({
      kind: 'postComment',
      id: comment.id!,
      userId: comment.userId,
      text: comment.text,
      createdAt: comment.createdAt,
      moderationStatus: comment.moderationStatus ?? 'approved',
      spotId: comment.postId.startsWith('spot_')
        ? comment.postId.replace(/^spot_/, '')
        : undefined,
      postId: comment.postId,
    }));

  return [...spotComments, ...feedComments]
    .filter(comment => {
      if (!normalizedSearch) {
        return true;
      }
      const spot = comment.spotId ? spotsById[comment.spotId] : undefined;
      const userName = usersById[comment.userId]?.displayName ?? '';
      const haystack =
        `${comment.text} ${spot?.name ?? ''} ${userName} ${comment.postId ?? ''}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));
};

export const buildFilteredUsers = ({
  normalizedSearch,
  users,
}: {
  normalizedSearch: string;
  users: UserProfile[];
}) =>
  users
    .filter(userProfile => {
      if (!normalizedSearch) {
        return true;
      }
      const haystack =
        `${userProfile.displayName ?? ''} ${userProfile.cityRegion ?? ''} ${userProfile.socials?.email ?? ''}`
          .toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const aName = (a.displayName ?? '').toLowerCase();
      const bName = (b.displayName ?? '').toLowerCase();
      return aName.localeCompare(bName);
    });

export const buildFilteredReports = ({
  normalizedSearch,
  reports,
}: {
  normalizedSearch: string;
  reports: ContentReport[];
}) =>
  reports
    .filter(report => {
      if (!normalizedSearch) {
        return true;
      }
      const haystack =
        `${report.targetType} ${report.targetId} ${report.reasons?.join(' ') ?? ''} ${report.note ?? ''}`
          .toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => getTimestampMillis(b.createdAt) - getTimestampMillis(a.createdAt));

export const buildSelectedSpotDetails = ({
  reviewsBySpotId,
  selectedSpotId,
  spotsById,
}: {
  reviewsBySpotId: Record<string, Review[]>;
  selectedSpotId: string | null;
  spotsById: Record<string, Spot>;
}): AdminSelectedSpotDetails | null => {
  if (!selectedSpotId) {
    return null;
  }

  const spot = spotsById[selectedSpotId];
  if (!spot) {
    return null;
  }

  const spotReviews = reviewsBySpotId[selectedSpotId] ?? [];
  return {
    spot,
    spotReviews,
    comments: spotReviews.filter(review => review.type === 'comment' && Boolean(review.text)),
    ratings: spotReviews.filter(
      review => review.type === 'rating' && typeof review.rating === 'number',
    ),
  };
};
