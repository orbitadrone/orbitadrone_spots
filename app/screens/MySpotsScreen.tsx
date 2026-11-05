import React, {useCallback, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect, useNavigation} from '@react-navigation/native';
import {useTranslation} from 'react-i18next';
import Icon from 'react-native-vector-icons/FontAwesome';

import {authInstance as auth} from '../../src/firebaseConfig';
import {deleteSpot, getSpotsByUserId, Spot} from '../../src/services/firestoreService';
import {deletePost, getSocialPostsByUser, SocialPost} from '../../src/services/socialService';
import {deleteEvent, DroneEvent, getEventsByUser} from '../../src/services/eventService';
import {palette, radii, shadows} from '../../src/constants/theme';
import {getVideoPreviewCandidatesFromUrl, isBunnyVideoUrl} from '../../src/utils/videoPlayback';
import logger from '../../src/utils/logger';
import {formatEventDateTime} from '../features/events/eventsShared';
import type {MainTabScreenNavigationProp} from '../../src/navigation/types';

type PublicationsTab = 'all' | 'spots' | 'drones' | 'events';

type PublicationItem =
  | {kind: 'spot'; id: string; createdAtMs: number; spot: Spot}
  | {kind: 'drone'; id: string; createdAtMs: number; post: SocialPost}
  | {kind: 'event'; id: string; createdAtMs: number; event: DroneEvent};

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

const buildDroneSummary = (post: SocialPost, t: (key: string, options?: any) => string) => {
  const trimmedText = (post.text ?? '').trim();
  if (trimmedText.length > 0) {
    return trimmedText;
  }

  const imageCount = post.media?.images?.filter(Boolean).length ?? 0;
  const hasVideo = Boolean(post.media?.videoUrl);
  const metaParts: string[] = [];
  if (imageCount > 0) {
    metaParts.push(t('mySpots.photoCount', {count: imageCount}));
  }
  if (hasVideo) {
    metaParts.push(t('mySpots.hasVideo'));
  }

  if (metaParts.length > 0) {
    return metaParts.join(' · ');
  }
  return t('mySpots.dronePostUntitled');
};

const normalizeUri = (value?: string | null): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const buildThumbnailCandidates = (
  directCandidates: Array<string | null | undefined>,
  videoUrl?: string | null,
) => {
  const normalizedDirectCandidates = directCandidates
    .map(candidate => normalizeUri(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
  const videoCandidates = normalizeUri(videoUrl)
    ? getVideoPreviewCandidatesFromUrl(normalizeUri(videoUrl)!)
    : [];
  return Array.from(new Set([...normalizedDirectCandidates, ...videoCandidates]));
};

const getSpotThumbnailCandidates = (spot: Spot) =>
  buildThumbnailCandidates([spot.mainImage, spot.backgroundUrl, ...(spot.galleryImages ?? [])], spot.videoUrl);

const getPostThumbnailCandidates = (post: SocialPost) =>
  buildThumbnailCandidates([post.media?.thumbnailUrl, ...(post.media?.images ?? [])], post.media?.videoUrl);

const getEventThumbnailCandidates = (event: DroneEvent) =>
  buildThumbnailCandidates(
    [event.media?.thumbnailUrl, ...(event.media?.images ?? [])],
    event.media?.videoUrl ?? undefined,
  );

const BUNNY_MEDIA_HEADERS = {
  Referer: 'https://iframe.mediadelivery.net/',
  Origin: 'https://iframe.mediadelivery.net',
};

const getThumbnailSource = (uri: string) =>
  isBunnyVideoUrl(uri)
    ? {
        uri,
        headers: BUNNY_MEDIA_HEADERS,
      }
    : {uri};

const MySpotsScreen = () => {
  const {t, i18n} = useTranslation();
  const navigation = useNavigation<MainTabScreenNavigationProp<'MySpots'>>();

  const [activeTab, setActiveTab] = useState<PublicationsTab>('all');
  const [spots, setSpots] = useState<Spot[]>([]);
  const [dronePosts, setDronePosts] = useState<SocialPost[]>([]);
  const [events, setEvents] = useState<DroneEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingPublicationId, setDeletingPublicationId] = useState<string | null>(null);
  const [failedThumbnailByItemKey, setFailedThumbnailByItemKey] = useState<
    Record<string, boolean>
  >({});
  const [thumbnailVariantByItemKey, setThumbnailVariantByItemKey] = useState<
    Record<string, number>
  >({});

  const fetchPublications = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) {
      setError(t('alerts.notLoggedIn'));
      setLoading(false);
      setSpots([]);
      setDronePosts([]);
      setEvents([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [userSpots, userPosts, userEvents] = await Promise.all([
        getSpotsByUserId(user.uid),
        getSocialPostsByUser(user.uid),
        getEventsByUser(user.uid),
      ]);
      setSpots(userSpots);
      setDronePosts(userPosts.filter(post => post.type === 'drone'));
      setEvents(userEvents);
      setFailedThumbnailByItemKey({});
      setThumbnailVariantByItemKey({});
    } catch (fetchError) {
      logger.error('[MyPublications] fetch failed', fetchError);
      setError(t('mySpots.fetchError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      fetchPublications();
    }, [fetchPublications]),
  );

  const publicationItems = useMemo(() => {
    const spotItems: PublicationItem[] = spots
      .filter(spot => Boolean(spot.id))
      .map(spot => ({
        kind: 'spot',
        id: spot.id!,
        createdAtMs: getTimestampMillis(spot.createdAt),
        spot,
      }));

    const droneItems: PublicationItem[] = dronePosts
      .filter(post => Boolean(post.id))
      .map(post => ({
        kind: 'drone',
        id: post.id!,
        createdAtMs:
          getTimestampMillis(post.createdAt) ||
          (typeof post.createdAtMs === 'number' ? post.createdAtMs : 0),
        post,
      }));

    const eventItems: PublicationItem[] = events
      .filter(event => Boolean(event.id))
      .map(event => ({
        kind: 'event',
        id: event.id!,
        createdAtMs:
          getTimestampMillis(event.startsAt) ||
          (typeof event.startsAtMs === 'number' ? event.startsAtMs : 0),
        event,
      }));

    const sortByNewest = (a: PublicationItem, b: PublicationItem) => b.createdAtMs - a.createdAtMs;

    if (activeTab === 'spots') {
      return [...spotItems].sort(sortByNewest);
    }
    if (activeTab === 'drones') {
      return [...droneItems].sort(sortByNewest);
    }
    if (activeTab === 'events') {
      return [...eventItems].sort(sortByNewest);
    }
    return [...spotItems, ...droneItems, ...eventItems].sort(sortByNewest);
  }, [activeTab, dronePosts, events, spots]);

  const handleDeleteSpot = useCallback(
    (spotId: string) => {
      Alert.alert(t('mySpots.deleteConfirmTitle'), t('mySpots.deleteConfirmMessage'), [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingPublicationId(spotId);
            try {
              await deleteSpot(spotId);
              setSpots(previous => previous.filter(spot => spot.id !== spotId));
              Alert.alert(t('mySpots.deleteSuccessTitle'), t('mySpots.deleteSuccessMessage'));
            } catch (deleteError) {
              logger.error('[MyPublications] delete spot failed', deleteError);
              Alert.alert(t('alerts.error'), t('mySpots.deleteError'));
            } finally {
              setDeletingPublicationId(current => (current === spotId ? null : current));
            }
          },
        },
      ]);
    },
    [t],
  );

  const handleDeletePost = useCallback(
    (postId: string) => {
      Alert.alert(t('mySpots.deletePostConfirmTitle'), t('mySpots.deletePostConfirmMessage'), [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingPublicationId(postId);
            try {
              await deletePost(postId);
              setDronePosts(previous => previous.filter(post => post.id !== postId));
              Alert.alert(t('mySpots.deletePostSuccessTitle'), t('mySpots.deletePostSuccessMessage'));
            } catch (deleteError) {
              logger.error('[MyPublications] delete post failed', deleteError);
              Alert.alert(t('alerts.error'), t('mySpots.deletePostError'));
            } finally {
              setDeletingPublicationId(current => (current === postId ? null : current));
            }
          },
        },
      ]);
    },
    [t],
  );

  const handleDeleteEvent = useCallback(
    (eventId: string) => {
      Alert.alert(t('mySpots.deleteEventConfirmTitle'), t('mySpots.deleteEventConfirmMessage'), [
        {text: t('common.cancel'), style: 'cancel'},
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            setDeletingPublicationId(eventId);
            try {
              await deleteEvent(eventId);
              setEvents(previous => previous.filter(event => event.id !== eventId));
              Alert.alert(t('mySpots.deleteEventSuccessTitle'), t('mySpots.deleteEventSuccessMessage'));
            } catch (deleteError) {
              logger.error('[MyPublications] delete event failed', deleteError);
              Alert.alert(t('alerts.error'), t('mySpots.deleteEventError'));
            } finally {
              setDeletingPublicationId(current => (current === eventId ? null : current));
            }
          },
        },
      ]);
    },
    [t],
  );

  const openPublication = useCallback(
    (item: PublicationItem) => {
      if (item.kind === 'spot') {
        navigation.navigate('SpotDetail', {spotId: item.spot.id});
        return;
      }
      if (item.kind === 'event') {
        navigation.navigate('EventDetail', {eventId: item.event.id});
        return;
      }
      const postId = item.post.id;
      if (!postId) {
        return;
      }
      navigation.navigate('Feed', {
        refreshAt: Date.now(),
        postId,
      });
    },
    [navigation],
  );

  const renderTabButton = (tab: PublicationsTab, label: string) => (
    <TouchableOpacity
      key={tab}
      style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
      onPress={() => setActiveTab(tab)}>
      <Text style={[styles.tabButtonText, activeTab === tab && styles.tabButtonTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const renderPublicationItem = ({item}: {item: PublicationItem}) => {
    const isDeleting = deletingPublicationId === item.id;
    const isSpot = item.kind === 'spot';
    const isEvent = item.kind === 'event';
    const title = isSpot
      ? item.spot.name
      : isEvent
        ? item.event.title
        : t('mySpots.dronePostTitle');
    const description = isSpot
      ? item.spot.description
      : isEvent
        ? `${formatEventDateTime(item.event, i18n.language)} · ${
            item.event.locationLabel || item.event.locationAddress || t('events.noLocationLabel')
          }`
        : buildDroneSummary(item.post, t as (key: string, options?: any) => string);
    const itemKey = `${item.kind}-${item.id}`;
    const thumbnailCandidates = isSpot
      ? getSpotThumbnailCandidates(item.spot)
      : isEvent
        ? getEventThumbnailCandidates(item.event)
        : getPostThumbnailCandidates(item.post);
    const selectedThumbnailVariant = thumbnailVariantByItemKey[itemKey] ?? 0;
    const thumbnailUri = thumbnailCandidates[selectedThumbnailVariant] ?? null;
    const canRenderThumbnail = Boolean(thumbnailUri) && !failedThumbnailByItemKey[itemKey];
    const placeholderIcon = isEvent
      ? 'calendar'
      : !isSpot && item.post.media?.videoUrl
        ? 'film'
        : 'picture-o';

    return (
      <View style={styles.publicationCard}>
        <TouchableOpacity
          style={styles.publicationContent}
          disabled={isDeleting}
          onPress={() => openPublication(item)}>
          <View style={styles.publicationMedia}>
            {canRenderThumbnail ? (
              <Image
                source={getThumbnailSource(thumbnailUri!)}
                style={styles.publicationMediaImage}
                onError={() => {
                  if (selectedThumbnailVariant + 1 < thumbnailCandidates.length) {
                    setThumbnailVariantByItemKey(previous => ({
                      ...previous,
                      [itemKey]: selectedThumbnailVariant + 1,
                    }));
                    return;
                  }
                  setFailedThumbnailByItemKey(previous => ({
                    ...previous,
                    [itemKey]: true,
                  }));
                }}
              />
            ) : (
              <Icon name={placeholderIcon} size={20} color={palette.textMuted} />
            )}
          </View>
          <View style={styles.publicationTextContent}>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.typeBadge,
                  isSpot ? styles.spotBadge : isEvent ? styles.eventBadge : styles.droneBadge,
                ]}>
                <Text style={styles.typeBadgeText}>
                  {isSpot
                    ? t('mySpots.spotBadge')
                    : isEvent
                      ? t('mySpots.eventBadge')
                      : t('mySpots.droneBadge')}
                </Text>
              </View>
            </View>
            <Text style={styles.publicationTitle}>{title}</Text>
            {description ? (
              <Text style={styles.publicationDescription} numberOfLines={2}>
                {description}
              </Text>
            ) : null}
          </View>
        </TouchableOpacity>
        <View style={styles.actionsColumn}>
          <TouchableOpacity
            style={styles.actionButton}
            disabled={isDeleting}
            onPress={() => openPublication(item)}>
            <Icon name="external-link" size={18} color={palette.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionButton}
            disabled={isDeleting}
            onPress={() =>
              isSpot
                ? handleDeleteSpot(item.id)
                : isEvent
                  ? handleDeleteEvent(item.id)
                  : handleDeletePost(item.id)
            }>
            {isDeleting ? (
              <ActivityIndicator size="small" color="#E53935" />
            ) : (
              <Icon name="trash" size={20} color="#E53935" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const emptyMessage =
    activeTab === 'spots'
      ? t('mySpots.noSpots')
      : activeTab === 'drones'
        ? t('mySpots.noDronePosts')
        : activeTab === 'events'
          ? t('mySpots.noEvents')
        : t('mySpots.noPublications');

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchPublications}>
          <Text style={styles.retryButtonText}>{t('feed.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('mySpots.title')}</Text>
      <View style={styles.tabsRow}>
        {renderTabButton('all', t('mySpots.tabs.all'))}
        {renderTabButton('spots', t('mySpots.tabs.spots'))}
        {renderTabButton('drones', t('mySpots.tabs.drones'))}
        {renderTabButton('events', t('mySpots.tabs.events'))}
      </View>
      {publicationItems.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{emptyMessage}</Text>
        </View>
      ) : (
        <FlatList
          data={publicationItems}
          renderItem={renderPublicationItem}
          keyExtractor={item => `${item.kind}-${item.id}`}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 12,
    backgroundColor: palette.backgroundLight,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
    color: palette.textPrimary,
  },
  tabsRow: {
    flexDirection: 'row',
    marginBottom: 12,
    backgroundColor: '#eef2f7',
    borderRadius: radii.lg,
    padding: 4,
    gap: 6,
  },
  tabButton: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: palette.backgroundCard,
    ...shadows.subtle,
  },
  tabButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: palette.textSecondary,
  },
  tabButtonTextActive: {
    color: palette.textPrimary,
  },
  list: {
    paddingBottom: 18,
  },
  emptyText: {
    textAlign: 'center',
    color: palette.textSecondary,
    fontSize: 16,
  },
  publicationCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.borderLight,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    ...shadows.subtle,
  },
  publicationContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  publicationMedia: {
    width: 68,
    height: 68,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: palette.backgroundLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: 10,
  },
  publicationMediaImage: {
    width: '100%',
    height: '100%',
  },
  publicationTextContent: {
    flex: 1,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  typeBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  spotBadge: {
    backgroundColor: '#d1fae5',
  },
  droneBadge: {
    backgroundColor: '#dbeafe',
  },
  eventBadge: {
    backgroundColor: '#fef3c7',
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111827',
  },
  publicationTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  publicationDescription: {
    fontSize: 13,
    color: palette.textSecondary,
  },
  actionsColumn: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  actionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.backgroundLight,
  },
  errorText: {
    color: '#e53935',
    textAlign: 'center',
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: '#0ea5e9',
    borderRadius: radii.md,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default MySpotsScreen;
