import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useTranslation} from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  Spot,
  UserModerationStatus,
  UserProfile,
  deleteReviewAsAdmin,
  deleteSpotAsAdmin,
  setReviewModerationStatus,
  setSpotFeaturedState,
  setSpotHiddenState,
  setUserModerationStatus,
} from '../../src/services/firestoreService';
import {
  ContentReport,
  deletePostCommentAsAdmin,
  setPostCommentModerationStatus,
  updateReportStatus,
} from '../../src/services/socialService';
import {palette, radii, shadows} from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import AdminSpotDetailsModal from '../components/admin/AdminSpotDetailsModal';
import {
  ADMIN_SECTION_VALUES,
  AdminCommentItem,
  AdminSection,
  REPORT_STATUS_ORDER,
  SPOT_ACTIVITY_FILTER_VALUES,
  STATUS_OPTIONS,
  SpotActivityFilter,
  formatAdminDate,
} from '../features/admin/adminPanelShared';
import {useAdminPanelData} from '../features/admin/useAdminPanelData';

export default function AdminPanelScreen() {
  const {t} = useTranslation();

  const [section, setSection] = useState<AdminSection>('dashboard');
  const [spotFilter, setSpotFilter] = useState<SpotActivityFilter>('all');
  const [search, setSearch] = useState('');
  const [actionBusyMap, setActionBusyMap] = useState<Record<string, boolean>>({});
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);

  const handleLoadError = useCallback(() => {
    Alert.alert(t('alerts.error'), t('admin.errors.loadData'));
  }, [t]);

  const setActionBusy = useCallback((actionKey: string, busy: boolean) => {
    setActionBusyMap(prev => ({
      ...prev,
      [actionKey]: busy,
    }));
  }, []);

  const {
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
  } = useAdminPanelData({
    search,
    selectedSpotId,
    spotFilter,
    notAuthorizedMessage: t('admin.errors.notAuthorized'),
    accessCheckFailedMessage: t('admin.errors.accessCheckFailed'),
    onLoadError: handleLoadError,
  });

  const runAdminAction = useCallback(
    async ({
      actionKey,
      errorMessage,
      logMessage,
      task,
    }: {
      actionKey: string;
      errorMessage: string;
      logMessage: string;
      task: () => Promise<void>;
    }) => {
      setActionBusy(actionKey, true);
      try {
        await task();
        await loadAdminData(true);
      } catch (actionError) {
        logger.error(logMessage, actionError);
        Alert.alert(t('alerts.error'), errorMessage);
      } finally {
        setActionBusy(actionKey, false);
      }
    },
    [loadAdminData, setActionBusy, t],
  );

  const dashboardCards = useMemo(
    () => [
      {
        title: t('admin.dashboard.totalSpots'),
        value: dashboardStats.totalSpots,
      },
      {
        title: t('admin.dashboard.totalUsers'),
        value: dashboardStats.totalUsers,
      },
      {
        title: t('admin.dashboard.totalComments'),
        value: dashboardStats.totalComments,
      },
      {
        title: t('admin.dashboard.totalSpotComments'),
        value: dashboardStats.totalSpotComments,
      },
      {
        title: t('admin.dashboard.totalPostComments'),
        value: dashboardStats.totalPostComments,
      },
      {
        title: t('admin.dashboard.totalRatings'),
        value: dashboardStats.totalRatings,
      },
      {
        title: t('admin.dashboard.totalReports'),
        value: dashboardStats.totalReports,
      },
      {
        title: t('admin.dashboard.openReports'),
        value: dashboardStats.openReports,
      },
      {
        title: t('admin.dashboard.hiddenSpots'),
        value: dashboardStats.hiddenSpots,
      },
      {
        title: t('admin.dashboard.newSpots24h'),
        value: dashboardStats.newSpots24h,
      },
      {
        title: t('admin.dashboard.newSpots7d'),
        value: dashboardStats.newSpots7d,
      },
      {
        title: t('admin.dashboard.activity24h'),
        value: dashboardStats.activity24h,
      },
      {
        title: t('admin.dashboard.activity7d'),
        value: dashboardStats.activity7d,
      },
    ],
    [dashboardStats, t],
  );

  const confirmDeleteSpot = useCallback((spot: Spot) => {
    if (!spot.id) {
      return;
    }

    Alert.alert(
      t('admin.spots.deleteConfirmTitle'),
      t('admin.spots.deleteConfirmMessage', {name: spot.name || t('feed.untitled')}),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            runAdminAction({
              actionKey: `spot-delete-${spot.id}`,
              errorMessage: t('admin.errors.deleteSpot'),
              logMessage: '[Admin] delete spot failed',
              task: async () => {
                await deleteSpotAsAdmin(spot.id!);
              },
            }),
        },
      ],
    );
  }, [runAdminAction, t]);

  const confirmDeleteComment = useCallback((comment: AdminCommentItem) => {
    if (!comment.id) {
      return;
    }

    Alert.alert(
      t('admin.comments.deleteConfirmTitle'),
      t('admin.comments.deleteConfirmMessage'),
      [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            runAdminAction({
              actionKey: `comment-delete-${comment.id}`,
              errorMessage: t('admin.errors.deleteComment'),
              logMessage: '[Admin] delete comment failed',
              task: async () => {
                if (comment.kind === 'spotReview') {
                  await deleteReviewAsAdmin(comment.id);
                  return;
                }
                await deletePostCommentAsAdmin(comment.id);
              },
            }),
        },
      ],
    );
  }, [runAdminAction, t]);

  const toggleSpotVisibility = useCallback((spot: Spot) => {
    if (!spot.id) {
      return;
    }
    return runAdminAction({
      actionKey: `spot-hide-${spot.id}`,
      errorMessage: t('admin.errors.toggleSpotVisibility'),
      logMessage: '[Admin] toggle spot visibility failed',
      task: async () => {
        await setSpotHiddenState(spot.id, !spot.isHidden);
      },
    });
  }, [runAdminAction, t]);

  const toggleSpotFeature = useCallback((spot: Spot) => {
    if (!spot.id) {
      return;
    }
    return runAdminAction({
      actionKey: `spot-feature-${spot.id}`,
      errorMessage: t('admin.errors.toggleSpotFeature'),
      logMessage: '[Admin] toggle feature failed',
      task: async () => {
        await setSpotFeaturedState(spot.id, !spot.featured);
      },
    });
  }, [runAdminAction, t]);

  const toggleCommentVisibility = useCallback((comment: AdminCommentItem) => {
    if (!comment.id) {
      return;
    }
    const isHidden = comment.moderationStatus === 'hidden';
    const nextStatus = isHidden ? 'approved' : 'hidden';
    return runAdminAction({
      actionKey: `comment-hide-${comment.id}`,
      errorMessage: t('admin.errors.toggleCommentVisibility'),
      logMessage: '[Admin] toggle comment visibility failed',
      task: async () => {
        const adminNote =
          nextStatus === 'hidden' ? t('admin.comments.hiddenByAdminNote') : null;
        if (comment.kind === 'spotReview') {
          await setReviewModerationStatus(comment.id, nextStatus, adminNote);
          return;
        }
        await setPostCommentModerationStatus(comment.id, nextStatus, adminNote);
      },
    });
  }, [runAdminAction, t]);

  const updateUserStatus = useCallback((
    userProfile: UserProfile,
    nextStatus: UserModerationStatus,
  ) => {
    if (!userProfile.id) {
      return;
    }
    return runAdminAction({
      actionKey: `user-status-${userProfile.id}-${nextStatus}`,
      errorMessage: t('admin.errors.updateUserStatus'),
      logMessage: '[Admin] update user status failed',
      task: async () => {
        await setUserModerationStatus(userProfile.id, nextStatus);
      },
    });
  }, [runAdminAction, t]);

  const changeReportStatus = useCallback((
    report: ContentReport,
    status: NonNullable<ContentReport['status']>,
  ) => {
    if (!report.id || report.status === status) {
      return;
    }
    return runAdminAction({
      actionKey: `report-status-${report.id}-${status}`,
      errorMessage: t('admin.errors.updateReportStatus'),
      logMessage: '[Admin] update report status failed',
      task: async () => {
        await updateReportStatus(report.id, status);
      },
    });
  }, [runAdminAction, t]);

  const renderDashboard = () => {
    return (
      <View style={styles.sectionContainer}>
        <Text style={styles.sectionTitle}>{t('admin.dashboard.title')}</Text>
        <View style={styles.dashboardGrid}>
          {dashboardCards.map(card => (
            <View key={card.title} style={styles.dashboardCard}>
              <Text style={styles.dashboardValue}>{card.value}</Text>
              <Text style={styles.dashboardLabel}>{card.title}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  };

  const renderSpots = () => {
    return (
      <View style={styles.sectionContainer}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>{t('admin.spots.title')}</Text>
          <View style={styles.inlineFilterRow}>
            {SPOT_ACTIVITY_FILTER_VALUES.map(filterValue => (
              <TouchableOpacity
                key={filterValue}
                style={[
                  styles.inlineFilter,
                  spotFilter === filterValue && styles.inlineFilterActive,
                ]}
                onPress={() => setSpotFilter(filterValue)}>
                <Text
                  style={[
                    styles.inlineFilterText,
                    spotFilter === filterValue && styles.inlineFilterTextActive,
                  ]}>
                  {t(`admin.spots.filters.${filterValue}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {filteredSpots.map(item => {
          const spot = item.spot;
          const author = usersById[spot.createdBy]?.displayName || t('common.unknownUser');
          const actionBusyHide = actionBusyMap[`spot-hide-${spot.id}`];
          const actionBusyFeature = actionBusyMap[`spot-feature-${spot.id}`];
          const actionBusyDelete = actionBusyMap[`spot-delete-${spot.id}`];
          return (
            <View key={spot.id} style={styles.listCard}>
              <View style={styles.spotTopRow}>
                {spot.mainImage ? (
                  <Image source={{uri: spot.mainImage}} style={styles.spotThumb} />
                ) : (
                  <View style={[styles.spotThumb, styles.spotThumbFallback]}>
                    <Icon name="image-off-outline" size={20} color={palette.textMuted} />
                  </View>
                )}
                <View style={styles.spotMainInfo}>
                  <Text style={styles.listCardTitle}>{spot.name || t('feed.untitled')}</Text>
                  <Text style={styles.listCardMeta}>{t('admin.spots.author')}: {author}</Text>
                  <Text style={styles.listCardMeta}>
                    {t('admin.spots.createdAt')}: {formatAdminDate(spot.createdAt, t)}
                  </Text>
                  <Text style={styles.listCardMeta}>
                    {t('admin.spots.lastActivity')}:{' '}
                    {item.lastActivityMs ? new Date(item.lastActivityMs).toLocaleString() : t('common.na')}
                  </Text>
                  <Text style={styles.listCardMeta}>
                    {t('admin.spots.rating')}: {Number(spot.averageRating || 0).toFixed(1)} (
                    {spot.ratingCount ?? spot.reviewCount ?? 0})
                  </Text>
                  <Text style={styles.listCardMeta}>
                    {t('admin.spots.commentsCount')}: {item.commentCount}
                  </Text>
                </View>
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => toggleSpotVisibility(spot)}
                  disabled={Boolean(actionBusyHide)}>
                  {actionBusyHide ? <ActivityIndicator size="small" /> : null}
                  <Text style={styles.actionPillText}>
                    {spot.isHidden ? t('admin.spots.show') : t('admin.spots.hide')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => toggleSpotFeature(spot)}
                  disabled={Boolean(actionBusyFeature)}>
                  {actionBusyFeature ? <ActivityIndicator size="small" /> : null}
                  <Text style={styles.actionPillText}>
                    {spot.featured ? t('admin.spots.unfeature') : t('admin.spots.feature')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => setSelectedSpotId(spot.id ?? null)}>
                  <Text style={styles.actionPillText}>{t('admin.spots.openDetail')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionPill, styles.actionPillDanger]}
                  onPress={() => confirmDeleteSpot(spot)}
                  disabled={Boolean(actionBusyDelete)}>
                  {actionBusyDelete ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={[styles.actionPillText, styles.actionPillDangerText]}>
                    {t('common.delete')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderComments = () => {
    return (
      <View style={styles.sectionContainer}>
        <Text style={styles.sectionTitle}>{t('admin.comments.title')}</Text>

        {filteredComments.map(comment => {
          const spot = comment.spotId ? spotsById[comment.spotId] : null;
          const author = usersById[comment.userId]?.displayName || t('common.unknownUser');
          const isHidden = (comment.moderationStatus || 'approved') === 'hidden';
          const actionBusyHide = actionBusyMap[`comment-hide-${comment.id}`];
          const actionBusyDelete = actionBusyMap[`comment-delete-${comment.id}`];

          return (
            <View key={comment.id} style={styles.listCard}>
              <Text style={styles.listCardMeta}>@{author}</Text>
              <Text style={styles.listCardTitle}>
                {spot?.name || (comment.kind === 'postComment'
                  ? t('admin.comments.feedPost')
                  : t('feed.untitled'))}
              </Text>
              <Text style={styles.commentBody}>{comment.text}</Text>
              <Text style={styles.listCardMeta}>
                {t('admin.comments.status')}: {comment.moderationStatus || 'approved'}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.comments.createdAt')}: {formatAdminDate(comment.createdAt, t)}
              </Text>
              {comment.kind === 'postComment' ? (
                <Text style={styles.listCardMeta}>
                  {t('admin.comments.source')}: {comment.postId}
                </Text>
              ) : null}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => toggleCommentVisibility(comment)}
                  disabled={Boolean(actionBusyHide)}>
                  {actionBusyHide ? <ActivityIndicator size="small" /> : null}
                  <Text style={styles.actionPillText}>
                    {isHidden ? t('admin.comments.show') : t('admin.comments.hide')}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.actionPill}
                  onPress={() => {
                    if (comment.spotId) {
                      setSelectedSpotId(comment.spotId);
                    }
                  }}
                  disabled={!comment.spotId}>
                  <Text style={styles.actionPillText}>{t('admin.comments.openSpot')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionPill, styles.actionPillDanger]}
                  onPress={() => confirmDeleteComment(comment)}
                  disabled={Boolean(actionBusyDelete)}>
                  {actionBusyDelete ? <ActivityIndicator size="small" color="#fff" /> : null}
                  <Text style={[styles.actionPillText, styles.actionPillDangerText]}>
                    {t('common.delete')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderUsers = () => {
    return (
      <View style={styles.sectionContainer}>
        <Text style={styles.sectionTitle}>{t('admin.users.title')}</Text>

        {filteredUsers.map(userProfile => {
          const userActivity = userActivityByUserId[userProfile.id ?? ''] ?? {
            commentsCount: 0,
            ratingsCount: 0,
            spotsCount: 0,
          };
          const moderationStatus = userProfile.moderationStatus || 'active';

          return (
            <View key={userProfile.id} style={styles.listCard}>
              <Text style={styles.listCardTitle}>
                {userProfile.displayName || t('common.unknownUser')}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.users.location')}: {userProfile.cityRegion || t('common.na')}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.users.activity')}: {t('admin.users.activitySummary', {
                  spots: userActivity.spotsCount,
                  comments: userActivity.commentsCount,
                  ratings: userActivity.ratingsCount,
                })}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.users.status')}: {moderationStatus}
              </Text>

              <View style={styles.statusRow}>
                {STATUS_OPTIONS.map(status => {
                  const selected = moderationStatus === status;
                  const actionBusy = actionBusyMap[`user-status-${userProfile.id}-${status}`];
                  return (
                    <TouchableOpacity
                      key={`${userProfile.id}-${status}`}
                      style={[
                        styles.statusButton,
                        selected && styles.statusButtonActive,
                      ]}
                      disabled={Boolean(actionBusy)}
                      onPress={() => updateUserStatus(userProfile, status)}>
                      {actionBusy ? <ActivityIndicator size="small" /> : null}
                      <Text
                        style={[
                          styles.statusButtonText,
                          selected && styles.statusButtonTextActive,
                        ]}>
                        {t(`admin.users.statusValues.${status}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderReports = () => {
    return (
      <View style={styles.sectionContainer}>
        <Text style={styles.sectionTitle}>{t('admin.reports.title')}</Text>

        {filteredReports.map(report => {
          const currentStatus = report.status || 'open';
          return (
            <View key={report.id} style={styles.listCard}>
              <Text style={styles.listCardTitle}>
                {t('admin.reports.target')}: {report.targetType} / {report.targetId}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.reports.reasons')}: {(report.reasons ?? []).join(', ')}
              </Text>
              {report.note ? (
                <Text style={styles.commentBody}>{report.note}</Text>
              ) : null}
              <Text style={styles.listCardMeta}>
                {t('admin.reports.createdAt')}: {formatAdminDate(report.createdAt, t)}
              </Text>
              <Text style={styles.listCardMeta}>
                {t('admin.reports.status')}: {currentStatus}
              </Text>

              <View style={styles.statusRow}>
                {REPORT_STATUS_ORDER.map(status => {
                  const selected = currentStatus === status;
                  const actionBusy = actionBusyMap[`report-status-${report.id}-${status}`];
                  return (
                    <TouchableOpacity
                      key={`${report.id}-${status}`}
                      style={[styles.statusButton, selected && styles.statusButtonActive]}
                      onPress={() => changeReportStatus(report, status)}
                      disabled={Boolean(actionBusy)}>
                      {actionBusy ? <ActivityIndicator size="small" /> : null}
                      <Text
                        style={[
                          styles.statusButtonText,
                          selected && styles.statusButtonTextActive,
                        ]}>
                        {t(`admin.reports.statusValues.${status}`)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  };

  const renderSection = () => {
    if (section === 'dashboard') {
      return renderDashboard();
    }
    if (section === 'spots') {
      return renderSpots();
    }
    if (section === 'comments') {
      return renderComments();
    }
    if (section === 'reports') {
      return renderReports();
    }
    return renderUsers();
  };

  if (checkingAccess) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color={palette.highlight} />
        <Text style={styles.stateText}>{t('admin.loadingAccess')}</Text>
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={styles.centeredState}>
        <Icon name="shield-lock-outline" size={34} color={palette.textMuted} />
        <Text style={styles.stateTitle}>{t('admin.errors.noAccessTitle')}</Text>
        <Text style={styles.stateText}>{accessError || t('admin.errors.notAuthorized')}</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centeredState}>
        <ActivityIndicator size="large" color={palette.highlight} />
        <Text style={styles.stateText}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>{t('admin.title')}</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={() => loadAdminData(true)}>
          {refreshing ? (
            <ActivityIndicator size="small" color={palette.highlight} />
          ) : (
            <Icon name="refresh" size={18} color={palette.highlight} />
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.sectionTabs}>
        {ADMIN_SECTION_VALUES.map(value => (
          <TouchableOpacity
            key={value}
            style={[styles.sectionTab, section === value && styles.sectionTabActive]}
            onPress={() => setSection(value)}>
            <Text
              style={[
                styles.sectionTabText,
                section === value && styles.sectionTabTextActive,
              ]}>
              {t(`admin.tabs.${value}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {section !== 'dashboard' ? (
        <View style={styles.searchBoxWrapper}>
          <Icon name="magnify" size={18} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('admin.searchPlaceholder')}
            placeholderTextColor={palette.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scrollContent}>{renderSection()}</ScrollView>

      <AdminSpotDetailsModal
        onClose={() => setSelectedSpotId(null)}
        selectedSpotDetails={selectedSpotDetails}
        t={t}
        usersById={usersById}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f6fb',
  },
  topBar: {
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  sectionTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  sectionTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
  },
  sectionTabActive: {
    borderColor: palette.highlight,
    backgroundColor: '#eaf2ff',
  },
  sectionTabText: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionTabTextActive: {
    color: palette.highlight,
  },
  searchBoxWrapper: {
    marginHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    height: 42,
  },
  searchInput: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 14,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 28,
  },
  sectionContainer: {
    gap: 10,
  },
  sectionHeaderRow: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  inlineFilterRow: {
    flexDirection: 'row',
    gap: 6,
  },
  inlineFilter: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
  },
  inlineFilterActive: {
    borderColor: palette.highlight,
    backgroundColor: '#eaf2ff',
  },
  inlineFilterText: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineFilterTextActive: {
    color: palette.highlight,
  },
  dashboardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  dashboardCard: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    padding: 12,
    ...shadows.subtle,
  },
  dashboardValue: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.highlight,
  },
  dashboardLabel: {
    marginTop: 4,
    fontSize: 12,
    color: palette.textSecondary,
  },
  listCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 12,
    padding: 10,
    gap: 8,
    ...shadows.subtle,
  },
  spotTopRow: {
    flexDirection: 'row',
    gap: 10,
  },
  spotMainInfo: {
    flex: 1,
  },
  spotThumb: {
    width: 72,
    height: 72,
    borderRadius: 8,
  },
  spotThumbFallback: {
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listCardTitle: {
    color: palette.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  listCardMeta: {
    color: palette.textMuted,
    fontSize: 12,
  },
  commentBody: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  commentAuthor: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionPill: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionPillText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  actionPillDanger: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  actionPillDangerText: {
    color: '#fff',
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statusButton: {
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusButtonActive: {
    borderColor: palette.highlight,
    backgroundColor: '#eaf2ff',
  },
  statusButtonText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  statusButtonTextActive: {
    color: palette.highlight,
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 30,
  },
  stateTitle: {
    color: palette.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateText: {
    color: palette.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    padding: 14,
  },
  modalCard: {
    maxHeight: '84%',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    padding: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 10,
  },
  modalTitle: {
    flex: 1,
    color: palette.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  modalMeta: {
    color: palette.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  modalDescription: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginVertical: 10,
  },
  modalSubTitle: {
    color: palette.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 6,
  },
  modalImage: {
    width: 160,
    height: 100,
    borderRadius: 8,
    marginRight: 8,
  },
  modalVideoBadge: {
    marginTop: 8,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalCommentRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
    paddingVertical: 6,
  },
});
