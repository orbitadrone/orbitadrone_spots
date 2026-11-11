import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  Review,
  Spot,
  UserProfile,
  getAllReviews,
  getAllSpotsForAdmin,
  getAllUsers,
  isCurrentUserAdmin,
} from '../../../src/services/firestoreService';
import {
  ContentReport,
  PostComment,
  getAllPostComments,
  getAllReports,
} from '../../../src/services/socialService';
import logger from '../../../src/utils/logger';
import {
  AdminCommentItem,
  AdminDashboardStats,
  AdminSelectedSpotDetails,
  AdminSpotMetric,
  SpotActivityFilter,
  buildDashboardStats,
  buildFilteredComments,
  buildFilteredReports,
  buildFilteredSpots,
  buildFilteredUsers,
  buildReviewsBySpotId,
  buildSelectedSpotDetails,
  buildSpotMetrics,
  buildUserActivityByUserId,
} from './adminPanelShared';

type UseAdminPanelDataArgs = {
  search: string;
  selectedSpotId: string | null;
  spotFilter: SpotActivityFilter;
  notAuthorizedMessage: string;
  accessCheckFailedMessage: string;
  onLoadError: () => void;
};

type UseAdminPanelDataResult = {
  accessError: string | null;
  checkingAccess: boolean;
  dashboardStats: AdminDashboardStats;
  filteredComments: AdminCommentItem[];
  filteredReports: ContentReport[];
  filteredSpots: AdminSpotMetric[];
  filteredUsers: UserProfile[];
  isAdmin: boolean;
  loadAdminData: (withRefresh?: boolean) => Promise<void>;
  loading: boolean;
  refreshing: boolean;
  selectedSpotDetails: AdminSelectedSpotDetails | null;
  spotsById: Record<string, Spot>;
  userActivityByUserId: Record<
    string,
    {
      commentsCount: number;
      ratingsCount: number;
      spotsCount: number;
    }
  >;
  usersById: Record<string, UserProfile>;
};

export const useAdminPanelData = ({
  search,
  selectedSpotId,
  spotFilter,
  notAuthorizedMessage,
  accessCheckFailedMessage,
  onLoadError,
}: UseAdminPanelDataArgs): UseAdminPanelDataResult => {
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [postComments, setPostComments] = useState<PostComment[]>([]);
  const [reports, setReports] = useState<ContentReport[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [dataSnapshotTimeMs, setDataSnapshotTimeMs] = useState(() => Date.now());

  const loadAdminData = useCallback(
    async (withRefresh = false) => {
      if (withRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const [
          fetchedSpots,
          fetchedReviews,
          fetchedPostComments,
          fetchedReports,
          fetchedUsers,
        ] = await Promise.all([
          getAllSpotsForAdmin(),
          getAllReviews({includeModerated: true}),
          getAllPostComments({includeModerated: true}),
          getAllReports(),
          getAllUsers(),
        ]);

        setSpots(fetchedSpots);
        setReviews(fetchedReviews);
        setPostComments(fetchedPostComments);
        setReports(fetchedReports);
        setUsers(fetchedUsers);
      } catch (loadError) {
        logger.error('[Admin] Failed to load admin data', loadError);
        onLoadError();
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onLoadError],
  );

  useEffect(() => {
    let cancelled = false;

    const checkAccess = async () => {
      try {
        setCheckingAccess(true);
        const adminAccess = await isCurrentUserAdmin();
        if (cancelled) {
          return;
        }
        setIsAdmin(adminAccess);
        if (!adminAccess) {
          setAccessError(notAuthorizedMessage);
          return;
        }
        setAccessError(null);
        await loadAdminData();
      } catch (checkError) {
        if (cancelled) {
          return;
        }
        logger.error('[Admin] access check failed', checkError);
        setAccessError(accessCheckFailedMessage);
      } finally {
        if (!cancelled) {
          setCheckingAccess(false);
        }
      }
    };

    checkAccess();
    return () => {
      cancelled = true;
    };
  }, [accessCheckFailedMessage, loadAdminData, notAuthorizedMessage]);

  const normalizedSearch = search.trim().toLowerCase();
  const usersById = useMemo(
    () => Object.fromEntries(users.filter(user => user.id).map(user => [user.id!, user])),
    [users],
  );
  const spotsById = useMemo(
    () => Object.fromEntries(spots.filter(spot => spot.id).map(spot => [spot.id!, spot])),
    [spots],
  );
  const reviewsBySpotId = useMemo(() => buildReviewsBySpotId(reviews), [reviews]);
  const spotMetrics = useMemo(
    () => buildSpotMetrics(spots, reviewsBySpotId),
    [reviewsBySpotId, spots],
  );
  const userActivityByUserId = useMemo(
    () => buildUserActivityByUserId(spots, reviews),
    [reviews, spots],
  );

  useEffect(() => {
    setDataSnapshotTimeMs(Date.now());
  }, [postComments, reports, reviews, spots, users.length]);

  const nowMs = dataSnapshotTimeMs;
  const last24hMs = nowMs - 24 * 60 * 60 * 1000;
  const last7dMs = nowMs - 7 * 24 * 60 * 60 * 1000;

  const dashboardStats = useMemo(
    () =>
      buildDashboardStats({
        spots,
        reviews,
        postComments,
        reports,
        usersCount: users.length,
        nowMs,
      }),
    [nowMs, postComments, reports, reviews, spots, users.length],
  );

  const filteredSpots = useMemo(
    () =>
      buildFilteredSpots({
        last24hMs,
        last7dMs,
        normalizedSearch,
        spotFilter,
        spotMetrics,
        usersById,
      }),
    [last24hMs, last7dMs, normalizedSearch, spotFilter, spotMetrics, usersById],
  );

  const filteredComments = useMemo(
    () =>
      buildFilteredComments({
        normalizedSearch,
        postComments,
        reviews,
        spotsById,
        usersById,
      }),
    [normalizedSearch, postComments, reviews, spotsById, usersById],
  );

  const filteredUsers = useMemo(
    () =>
      buildFilteredUsers({
        normalizedSearch,
        users,
      }),
    [normalizedSearch, users],
  );

  const filteredReports = useMemo(
    () =>
      buildFilteredReports({
        normalizedSearch,
        reports,
      }),
    [normalizedSearch, reports],
  );

  const selectedSpotDetails = useMemo(
    () =>
      buildSelectedSpotDetails({
        reviewsBySpotId,
        selectedSpotId,
        spotsById,
      }),
    [reviewsBySpotId, selectedSpotId, spotsById],
  );

  return {
    accessError,
    checkingAccess,
    dashboardStats,
    filteredComments,
    filteredReports,
    filteredSpots,
    filteredUsers,
    isAdmin,
    loadAdminData,
    loading,
    refreshing,
    selectedSpotDetails,
    spotsById,
    userActivityByUserId,
    usersById,
  };
};
