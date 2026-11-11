import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Share,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Video from 'react-native-video';
import {useTranslation} from 'react-i18next';

import CustomButton from '../components/CustomButton';
import {useAuthContext} from '../context/AuthContext';
import {
  formatEventDateTime,
  getParticipantStatusTone,
} from '../features/events/eventsShared';
import {palette, radii, shadows} from '../../src/constants/theme';
import {
  deleteEvent,
  DroneEvent,
  EventParticipant,
  getEvent,
  getEventParticipants,
  joinPublicEvent,
  respondToEventInvitation,
  resolveEventPublicJoinMode,
  setEventParticipantStatus,
} from '../../src/services/eventService';
import {
  buildEventShareUrl,
  buildGoogleMapsDirectionsUrl,
  PLAY_STORE_URL,
} from '../../src/constants/links';
import {getUserProfile, UserProfile} from '../../src/services/firestoreService';
import logger from '../../src/utils/logger';
import type {AppStackScreenProps} from '../../src/navigation/types';

const EventDetailScreen = ({navigation, route}: AppStackScreenProps<'EventDetail'>) => {
  const {t, i18n} = useTranslation();
  const {user} = useAuthContext();
  const {eventId} = route.params;

  const [event, setEvent] = useState<DroneEvent | null>(null);
  const [participants, setParticipants] = useState<EventParticipant[]>([]);
  const [profilesByUserId, setProfilesByUserId] = useState<Record<string, UserProfile | null>>({});
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState(false);

  const refreshEvent = useCallback(async () => {
    if (!eventId) {
      setEvent(null);
      setParticipants([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const [nextEvent, nextParticipants] = await Promise.all([
        getEvent(eventId),
        getEventParticipants(eventId),
      ]);
      setEvent(nextEvent);
      setParticipants(nextParticipants);
      const userIds = Array.from(
        new Set(
          [nextEvent?.createdBy, ...nextParticipants.map(participant => participant.userId)].filter(
            Boolean,
          ) as string[],
        ),
      );
      const entries = await Promise.all(
        userIds.map(async userId => {
          try {
            const profile = await getUserProfile(userId);
            return [userId, profile] as const;
          } catch (error) {
            logger.warn('[EventDetail] profile lookup failed', {userId, error});
            return [userId, null] as const;
          }
        }),
      );
      setProfilesByUserId(Object.fromEntries(entries));
    } catch (error) {
      logger.error('[EventDetail] load failed', error);
      Alert.alert(t('alerts.error'), t('events.loadError'));
      setEvent(null);
      setParticipants([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, t]);

  useEffect(() => {
    refreshEvent();
  }, [refreshEvent]);

  const currentParticipant = useMemo(() => {
    if (!user?.uid) {
      return null;
    }
    return participants.find(participant => participant.userId === user.uid) ?? null;
  }, [participants, user?.uid]);

  const isOwner = Boolean(user?.uid && event?.createdBy === user.uid);
  const publicJoinMode = resolveEventPublicJoinMode(event);
  const isOpenPublicEvent = Boolean(event?.isPublic && publicJoinMode === 'open');

  const groupedParticipants = useMemo(() => {
    const sortWeight: Record<string, number> = {
      host: 0,
      going: 1,
      invited: 2,
      requested: 3,
      declined: 4,
    };
    return [...participants].sort(
      (a, b) => (sortWeight[a.status] ?? 99) - (sortWeight[b.status] ?? 99),
    );
  }, [participants]);

  const handleRsvp = async (status: 'going' | 'declined') => {
    try {
      setSavingAction(true);
      await respondToEventInvitation({eventId, status});
      await refreshEvent();
    } catch (error) {
      logger.error('[EventDetail] RSVP failed', error);
      Alert.alert(t('alerts.error'), t('events.actionError'));
    } finally {
      setSavingAction(false);
    }
  };

  const handleJoinPublicEvent = async () => {
    try {
      setSavingAction(true);
      await joinPublicEvent(eventId);
      await refreshEvent();
    } catch (error) {
      logger.error('[EventDetail] public join failed', error);
      if (error instanceof Error && error.message === 'event_participation_managed_by_host') {
        Alert.alert(t('alerts.error'), t('events.managedByHostOnly'));
      } else {
        Alert.alert(t('alerts.error'), t('events.actionError'));
      }
    } finally {
      setSavingAction(false);
    }
  };

  const handleOwnerParticipantAction = async (
    participantUserId: string,
    status: 'invited' | 'declined',
  ) => {
    try {
      setSavingAction(true);
      await setEventParticipantStatus({
        eventId,
        participantUserId,
        status,
      });
      await refreshEvent();
    } catch (error) {
      logger.error('[EventDetail] participant action failed', error);
      Alert.alert(t('alerts.error'), t('events.actionError'));
    } finally {
      setSavingAction(false);
    }
  };

  const handleDelete = async () => {
    Alert.alert(t('events.deleteTitle'), t('events.deleteMessage'), [
      {
        text: t('common.cancel'),
        style: 'cancel',
      },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            setSavingAction(true);
            await deleteEvent(eventId);
            navigation.goBack();
          } catch (error) {
            logger.error('[EventDetail] delete failed', error);
            Alert.alert(t('alerts.error'), t('events.deleteError'));
          } finally {
            setSavingAction(false);
          }
        },
      },
    ]);
  };

  const openLink = async (url: string) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      logger.warn('[EventDetail] open link failed', error);
      Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
    }
  };

  const handleShare = async () => {
    if (!event) {
      return;
    }

    try {
      const resolvedEventId = event.id ?? eventId;
      const shareUrl = resolvedEventId ? buildEventShareUrl(resolvedEventId) : null;
      const shareMessageBase = t('feed.shareMessageEvent', {
        eventName: event.title || t('events.createTitle'),
      });
      const sharePayload = shareUrl
        ? {
            message: `${shareMessageBase}\n${shareUrl}\n${PLAY_STORE_URL}`,
            url: shareUrl,
          }
        : {message: `${shareMessageBase}\n${PLAY_STORE_URL}`};
      await Share.share(sharePayload);
    } catch (error) {
      logger.warn('[EventDetail] share failed', error);
      Alert.alert(t('alerts.error'), t('feed.shareError'));
    }
  };

  const handleDirections = async () => {
    if (!event) {
      return;
    }

    const coordinates = event.coordinates as {latitude?: number; longitude?: number} | null;
    const directionsUrl = buildGoogleMapsDirectionsUrl({
      latitude: typeof coordinates?.latitude === 'number' ? coordinates.latitude : null,
      longitude: typeof coordinates?.longitude === 'number' ? coordinates.longitude : null,
      address: event.locationAddress,
      label: event.locationLabel,
    });

    if (!directionsUrl) {
      Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      return;
    }

    await openLink(directionsUrl);
  };

  const handleViewOnMap = () => {
    if (!event) {
      return;
    }

    const coordinates = event.coordinates as {latitude?: number; longitude?: number} | null;
    if (
      typeof coordinates?.latitude !== 'number' ||
      typeof coordinates?.longitude !== 'number'
    ) {
      Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      return;
    }

    navigation.navigate('Main', {
      screen: 'Map',
      params: {
        focusEventId: event.id ?? eventId,
        focusLatitude: coordinates.latitude,
        focusLongitude: coordinates.longitude,
        focusRequestedAt: Date.now(),
      },
    });
  };

  const visibilityBadgeStyle = event?.isPublic ? styles.publicBadge : styles.privateBadge;

  const statusLabel = (status?: EventParticipant['status'] | null) => {
    if (status === 'host') {
      return t('events.status.host');
    }
    if (status === 'going') {
      return t('events.status.going');
    }
    if (status === 'invited') {
      return t('events.status.invited');
    }
    if (status === 'requested') {
      return t('events.status.requested');
    }
    return t('events.status.declined');
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={palette.highlight} />
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>{t('events.notFoundTitle')}</Text>
        <Text style={styles.emptyText}>{t('events.notFoundMessage')}</Text>
        <CustomButton title={t('common.ok')} onPress={() => navigation.goBack()} />
      </View>
    );
  }

  const coverImage = event.media?.images?.[0] ?? event.media?.thumbnailUrl ?? null;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-left" size={22} color={palette.textPrimary} />
      </TouchableOpacity>

      {coverImage ? <Image source={{uri: coverImage}} style={styles.heroImage} /> : null}
      {event.media?.videoUrl ? (
        <View style={styles.videoWrap}>
          <Video source={{uri: event.media.videoUrl}} style={styles.video} controls paused />
        </View>
      ) : null}

      <View style={styles.headerCard}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{event.title}</Text>
          <View style={[styles.visibilityBadge, visibilityBadgeStyle]}>
            <Text style={styles.visibilityBadgeText}>
              {event.isPublic ? t('events.publicBadge') : t('events.privateBadge')}
            </Text>
          </View>
        </View>

        <Text style={styles.dateText}>{formatEventDateTime(event, i18n.language)}</Text>
        {event.locationLabel || event.locationAddress ? (
          <View style={styles.infoRow}>
            <Icon name="map-marker" size={18} color="#f59e0b" />
            <Text style={styles.infoText}>
              {event.locationLabel || event.locationAddress}
            </Text>
          </View>
        ) : null}
        <View style={styles.infoRow}>
          <Icon name="account-group" size={18} color="#0ea5e9" />
          <Text style={styles.infoText}>
            {t('events.participantCount', {count: participants.length})}
          </Text>
        </View>
        {event.isPublic ? (
          <View style={styles.infoRow}>
            <Icon
              name={isOpenPublicEvent ? 'account-multiple-plus-outline' : 'account-lock-outline'}
              size={18}
              color={isOpenPublicEvent ? '#15803d' : '#92400e'}
            />
            <Text style={styles.infoText}>
              {isOpenPublicEvent
                ? t('events.publicJoinModeOpenSummary')
                : t('events.publicJoinModeApprovalSummary')}
            </Text>
          </View>
        ) : null}
        <View style={styles.headerActionsRow}>
          <TouchableOpacity style={styles.headerActionButton} onPress={handleDirections}>
            <Icon name="directions" size={18} color="#0f766e" />
            <Text style={styles.headerActionText}>{t('spotDetail.directionsButton')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionButton} onPress={handleViewOnMap}>
            <Icon name="map-search-outline" size={18} color="#b45309" />
            <Text style={styles.headerActionText}>{t('feed.viewOnMap')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionButton} onPress={handleShare}>
            <Icon name="share-variant-outline" size={18} color={palette.highlight} />
            <Text style={styles.headerActionText}>{t('feed.share')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('events.descriptionLabel')}</Text>
        <Text style={styles.bodyText}>{event.description}</Text>
      </View>

      {event.checklist?.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.materialsLabel')}</Text>
          {event.checklist.map(item => (
            <View key={item} style={styles.checklistRow}>
              <Icon name="checkbox-marked-circle-outline" size={18} color="#16a34a" />
              <Text style={styles.bodyText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {event.links?.length ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.linksLabel')}</Text>
          {event.links.map(link => (
            <TouchableOpacity
              key={`${link.label}-${link.url}`}
              style={styles.linkButton}
              onPress={() => openLink(link.url)}>
              <View style={styles.linkButtonTextWrap}>
                <Text style={styles.linkButtonTitle}>{link.label}</Text>
                <Text style={styles.linkButtonUrl} numberOfLines={1}>
                  {link.url}
                </Text>
              </View>
              <Icon name="open-in-new" size={18} color="#0ea5e9" />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('events.participantsTitle')}</Text>
        {groupedParticipants.map(participant => {
          const participantProfile = profilesByUserId[participant.userId];
          const tone = getParticipantStatusTone(participant.status);
          const ownerCanApprove =
            isOwner &&
            participant.userId !== user?.uid &&
            (participant.status === 'requested' || participant.status === 'declined');
          const ownerCanDecline =
            isOwner &&
            participant.userId !== user?.uid &&
            participant.status !== 'declined';
          return (
            <View key={participant.userId} style={styles.participantCard}>
              <View style={styles.participantMeta}>
                <Text style={styles.participantName}>
                  {participantProfile?.displayName || t('common.unknownUser')}
                </Text>
                <View style={[styles.statusPill, {backgroundColor: `${tone}18`}]}>
                  <Text style={[styles.statusPillText, {color: tone}]}>
                    {statusLabel(participant.status)}
                  </Text>
                </View>
              </View>

              {ownerCanApprove || ownerCanDecline ? (
                <View style={styles.ownerActionRow}>
                  {ownerCanApprove ? (
                    <TouchableOpacity
                      style={[styles.ownerActionButton, styles.ownerActionApprove]}
                      onPress={() => handleOwnerParticipantAction(participant.userId, 'invited')}>
                      <Text style={styles.ownerActionText}>
                        {participant.status === 'requested'
                          ? t('events.approve')
                          : t('events.reinviteAction')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {ownerCanDecline ? (
                    <TouchableOpacity
                      style={[styles.ownerActionButton, styles.ownerActionDecline]}
                      onPress={() => handleOwnerParticipantAction(participant.userId, 'declined')}>
                      <Text style={styles.ownerActionText}>
                        {participant.status === 'requested'
                          ? t('events.reject')
                          : t('events.removeParticipant')}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      {!isOwner ? (
        <View style={styles.actionCard}>
          {currentParticipant?.status === 'invited' ? (
            <>
              <CustomButton
                title={savingAction ? t('common.loading') : t('events.attendAction')}
                onPress={() => handleRsvp('going')}
                disabled={savingAction}
                style={styles.actionButton}
              />
              <CustomButton
                title={t('events.declineAction')}
                onPress={() => handleRsvp('declined')}
                disabled={savingAction}
                variant="outline"
                style={styles.actionButton}
              />
            </>
          ) : currentParticipant?.status === 'requested' ? (
            <Text style={styles.pendingText}>{t('events.requestPending')}</Text>
          ) : currentParticipant?.status === 'going' ? (
            <Text style={styles.pendingText}>{t('events.alreadyGoing')}</Text>
          ) : currentParticipant?.status === 'declined' ? (
            <Text style={styles.pendingText}>{t('events.managedByHostOnly')}</Text>
          ) : event.isPublic ? (
            <CustomButton
              title={
                savingAction
                  ? t('common.loading')
                  : isOpenPublicEvent
                    ? t('events.joinOpenAction')
                    : t('events.requestJoinAction')
              }
              onPress={handleJoinPublicEvent}
              disabled={savingAction}
            />
          ) : (
            <Text style={styles.pendingText}>{t('events.privateAccessOnly')}</Text>
          )}
        </View>
      ) : (
        <View style={styles.actionCard}>
          <CustomButton
            title={savingAction ? t('common.loading') : t('events.deleteAction')}
            onPress={handleDelete}
            disabled={savingAction}
            color="#dc2626"
          />
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    marginTop: 12,
    color: palette.textSecondary,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: palette.textPrimary,
    marginBottom: 8,
  },
  emptyText: {
    color: palette.textSecondary,
    marginBottom: 16,
    textAlign: 'center',
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 12,
  },
  heroImage: {
    width: '100%',
    height: 220,
    borderRadius: 24,
    marginBottom: 12,
  },
  videoWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
    marginBottom: 12,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: radii.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 12,
    ...shadows.subtle,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: 28,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  visibilityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  publicBadge: {
    backgroundColor: '#fef3c7',
  },
  privateBadge: {
    backgroundColor: '#e0e7ff',
  },
  visibilityBadgeText: {
    fontWeight: '700',
    color: '#92400e',
  },
  dateText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  infoText: {
    flex: 1,
    color: palette.textSecondary,
    fontWeight: '600',
  },
  headerActionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  headerActionText: {
    color: palette.textPrimary,
    fontWeight: '800',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radii.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 12,
    ...shadows.subtle,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.textPrimary,
    marginBottom: 12,
  },
  bodyText: {
    color: palette.textSecondary,
    lineHeight: 22,
  },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  linkButtonTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  linkButtonTitle: {
    color: palette.textPrimary,
    fontWeight: '700',
  },
  linkButtonUrl: {
    color: palette.textSecondary,
    marginTop: 2,
  },
  participantCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  participantMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  participantName: {
    flex: 1,
    color: palette.textPrimary,
    fontWeight: '700',
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: {
    fontWeight: '700',
    fontSize: 12,
  },
  ownerActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  ownerActionButton: {
    flex: 1,
    borderRadius: radii.lg,
    paddingVertical: 10,
    alignItems: 'center',
  },
  ownerActionApprove: {
    backgroundColor: '#dcfce7',
  },
  ownerActionDecline: {
    backgroundColor: '#fee2e2',
  },
  ownerActionText: {
    fontWeight: '700',
    color: palette.textPrimary,
  },
  actionCard: {
    backgroundColor: '#ffffff',
    borderRadius: radii.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    ...shadows.subtle,
  },
  actionButton: {
    marginBottom: 10,
  },
  pendingText: {
    color: palette.textSecondary,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default EventDetailScreen;
