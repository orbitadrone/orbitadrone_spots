import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, {MapPressEvent, Marker, Region} from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import {Asset, ImageLibraryOptions, launchImageLibrary} from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Video from 'react-native-video';
import {useTranslation} from 'react-i18next';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

import CustomButton from '../components/CustomButton';
import {useAuthContext} from '../context/AuthContext';
import {
  formatDateInput,
  formatTimeInput,
  isValidCoordinate,
  MAX_EVENT_CHECKLIST_ITEMS,
  MAX_EVENT_IMAGES,
  MAX_EVENT_LINKS,
  parseEventDateTime,
} from '../features/events/eventsShared';
import {
  LocalImageAsset,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_SIZE_MB,
  bytesToMb,
  prepareUploadableUri,
  safeUnlinkManagedMediaUri,
} from '../features/createDronePost/createDronePostShared';
import {prepareSelectedVideoAsset} from '../features/createDronePost/createDronePostPublishing';
import {palette, radii, shadows} from '../../src/constants/theme';
import {uploadImage} from '../../src/services/storageService';
import {uploadVideoToBunny} from '../../src/services/bunnyStreamService';
import {
  createEvent,
  DEFAULT_EVENT_PUBLIC_JOIN_MODE,
  DroneEventLink,
  EventPublicJoinMode,
} from '../../src/services/eventService';
import {getAllUsers, UserProfile} from '../../src/services/firestoreService';
import {geocode} from '../../src/utils/geocoding';
import {requestLocationPermission} from '../../src/utils/permissions';
import logger from '../../src/utils/logger';
import type {AppStackScreenProps} from '../../src/navigation/types';

const DEFAULT_REGION: Region = {
  latitude: 41.3851,
  longitude: 2.1734,
  latitudeDelta: 0.08,
  longitudeDelta: 0.05,
};

const sanitizeValue = (value: string) => value.trim();

const CreateEventScreen = ({navigation, route}: AppStackScreenProps<'CreateEvent'>) => {
  const {t} = useTranslation();
  const {user} = useAuthContext();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const locationResolveRequestIdRef = useRef(0);

  const initialCoordinate = route.params?.coordinate ?? null;
  const topInset =
    insets.top > 0
      ? insets.top
      : Platform.OS === 'android'
        ? (StatusBar.currentHeight ?? 0)
        : 0;
  const initialDate = useMemo(() => {
    const nextHour = new Date();
    nextHour.setHours(nextHour.getHours() + 2, 0, 0, 0);
    return nextHour;
  }, []);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateInput, setDateInput] = useState(formatDateInput(initialDate));
  const [timeInput, setTimeInput] = useState(formatTimeInput(initialDate));
  const [isPublic, setIsPublic] = useState(true);
  const [publicJoinMode, setPublicJoinMode] = useState<EventPublicJoinMode>(
    DEFAULT_EVENT_PUBLIC_JOIN_MODE,
  );
  const [locationLabel, setLocationLabel] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [isResolvingLocation, setResolvingLocation] = useState(false);
  const [coordinate, setCoordinate] = useState(initialCoordinate);
  const [mapRegion, setMapRegion] = useState<Region>(
    initialCoordinate
      ? {...DEFAULT_REGION, latitude: initialCoordinate.latitude, longitude: initialCoordinate.longitude}
      : DEFAULT_REGION,
  );
  const [isMapModalVisible, setMapModalVisible] = useState(false);

  const [images, setImages] = useState<LocalImageAsset[]>([]);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoType, setVideoType] = useState<string | null>(null);
  const [preparingVideo, setPreparingVideo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [checklistInput, setChecklistInput] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [linkLabelInput, setLinkLabelInput] = useState('');
  const [linkUrlInput, setLinkUrlInput] = useState('');
  const [links, setLinks] = useState<DroneEventLink[]>([]);

  const [inviteQuery, setInviteQuery] = useState('');
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [selectedInviteeIds, setSelectedInviteeIds] = useState<string[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadUsers = async () => {
      if (!user) {
        return;
      }
      try {
        setLoadingUsers(true);
        const usersList = await getAllUsers();
        if (!cancelled) {
          setAllUsers(
            usersList.filter(candidate => Boolean(candidate.id) && candidate.id !== user.uid),
          );
        }
      } catch (error) {
        logger.warn('[CreateEvent] failed to load users', error);
      } finally {
        if (!cancelled) {
          setLoadingUsers(false);
        }
      }
    };
    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const filteredInvitees = useMemo(() => {
    const queryValue = inviteQuery.trim().toLowerCase();
    const selectedIds = new Set(selectedInviteeIds);
    return allUsers.filter(candidate => {
      if (!candidate.id || selectedIds.has(candidate.id)) {
        return false;
      }
      if (!queryValue) {
        return true;
      }
      const haystack = `${candidate.displayName ?? ''} ${candidate.cityRegion ?? ''}`.toLowerCase();
      return haystack.includes(queryValue);
    });
  }, [allUsers, inviteQuery, selectedInviteeIds]);

  const selectedInvitees = useMemo(
    () =>
      selectedInviteeIds
        .map(inviteeId => allUsers.find(candidate => candidate.id === inviteeId))
        .filter((value): value is UserProfile => Boolean(value)),
    [allUsers, selectedInviteeIds],
  );

  const canSubmit = useMemo(
    () =>
      Boolean(
        sanitizeValue(title) &&
          sanitizeValue(description) &&
          parseEventDateTime(dateInput, timeInput) &&
          coordinate,
      ),
    [coordinate, dateInput, description, timeInput, title],
  );

  const hydrateLocationFromCoordinate = useCallback(
    async (
      nextCoordinate: {latitude: number; longitude: number},
      options: {overwriteLabel?: boolean} = {},
    ) => {
      const requestId = ++locationResolveRequestIdRef.current;
      setResolvingLocation(true);
      try {
        const result = await geocode(nextCoordinate.latitude, nextCoordinate.longitude);
        if (requestId !== locationResolveRequestIdRef.current) {
          return;
        }

        const formattedAddress =
          typeof result?.formatted_address === 'string'
            ? result.formatted_address.trim()
            : '';
        const derivedLabel = formattedAddress.split(',')[0]?.trim() ?? '';

        if (formattedAddress) {
          setLocationAddress(formattedAddress);
        }
        if ((options.overwriteLabel || !sanitizeValue(locationLabel)) && derivedLabel) {
          setLocationLabel(derivedLabel);
        }
      } catch (error) {
        if (requestId !== locationResolveRequestIdRef.current) {
          return;
        }
        logger.warn('[CreateEvent] reverse geocoding failed', error);
      } finally {
        if (requestId === locationResolveRequestIdRef.current) {
          setResolvingLocation(false);
        }
      }
    },
    [locationLabel],
  );

  useEffect(() => {
    if (!initialCoordinate) {
      return;
    }
    if (sanitizeValue(locationAddress)) {
      return;
    }
    hydrateLocationFromCoordinate(initialCoordinate);
  }, [hydrateLocationFromCoordinate, initialCoordinate, locationAddress]);

  const pickImages = () => {
    if (submitting || preparingVideo) {
      return;
    }
    const remaining = Math.max(0, MAX_EVENT_IMAGES - images.length);
    if (!remaining) {
      Alert.alert(t('alerts.attention'), t('events.maxImagesReached'));
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
      const nextImages = response.assets.reduce<LocalImageAsset[]>((acc, asset) => {
        if (!asset.uri) {
          return acc;
        }
        acc.push({
          uri: asset.uri,
          fileName: asset.fileName ?? null,
          type: asset.type ?? null,
        });
        return acc;
      }, []);
      if (!nextImages.length) {
        return;
      }
      setImages(previous => [...previous, ...nextImages].slice(0, MAX_EVENT_IMAGES));
    });
  };

  const pickVideo = () => {
    if (submitting || preparingVideo) {
      return;
    }

    launchImageLibrary(
      {
        mediaType: 'video',
        selectionLimit: 1,
        videoQuality: 'medium',
      },
      async response => {
        if (response.errorCode) {
          Alert.alert(t('alerts.error'), response.errorMessage || t('alerts.imagePickerError'));
          return;
        }
        if (response.didCancel || !response.assets?.length) {
          return;
        }

        const asset = response.assets[0] as Asset;
        if (!asset.uri) {
          return;
        }
        const duration = Number(asset.duration ?? 0);
        if (duration > MAX_VIDEO_DURATION_SECONDS) {
          Alert.alert(
            t('addSpot.videoTooLongTitle'),
            t('addSpot.videoTooLongMessage', {maxDuration: MAX_VIDEO_DURATION_SECONDS}),
          );
          return;
        }
        const sizeMb = bytesToMb(asset.fileSize);
        if (sizeMb > MAX_VIDEO_SIZE_MB) {
          Alert.alert(
            t('addSpot.videoTooLargeTitle'),
            t('addSpot.videoTooLargeMessage', {maxSize: MAX_VIDEO_SIZE_MB}),
          );
          return;
        }

        setPreparingVideo(true);
        try {
          const prepared = await prepareSelectedVideoAsset({
            asset,
            currentVideoUri: videoUri,
            isMounted: () => true,
          });
          setVideoUri(prepared.videoUri);
          setVideoName(prepared.videoName);
          setVideoType(prepared.videoType);
        } catch (error) {
          logger.error('[CreateEvent] video selection failed', error);
          Alert.alert(t('alerts.error'), t('alerts.videoUploadError'));
        } finally {
          setPreparingVideo(false);
        }
      },
    );
  };

  const handleUseCurrentLocation = useCallback(async () => {
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert(t('alerts.locationPermissionDenied'), t('alerts.locationPermissionDeniedMessage'));
      return;
    }

    Geolocation.getCurrentPosition(
      async position => {
        const nextCoordinate = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const nextRegion = {
          ...mapRegion,
          latitude: nextCoordinate.latitude,
          longitude: nextCoordinate.longitude,
        };
        setCoordinate(nextCoordinate);
        setMapRegion(nextRegion);
        mapRef.current?.animateToRegion(nextRegion, 400);
        await hydrateLocationFromCoordinate(nextCoordinate);
      },
      error => {
        logger.warn('[CreateEvent] current location failed', error);
        Alert.alert(t('alerts.error'), t('alerts.locationError'));
      },
      {enableHighAccuracy: true, timeout: 15000, maximumAge: 1000},
    );
  }, [hydrateLocationFromCoordinate, mapRegion, t]);

  const handleMapPress = async (event: MapPressEvent) => {
    const nextCoordinate = event.nativeEvent.coordinate;
    setCoordinate(nextCoordinate);
    setMapRegion(previous => ({
      ...previous,
      latitude: nextCoordinate.latitude,
      longitude: nextCoordinate.longitude,
    }));
    await hydrateLocationFromCoordinate(nextCoordinate);
  };

  const handleAddChecklistItem = () => {
    const value = sanitizeValue(checklistInput);
    if (!value) {
      return;
    }
    if (checklist.length >= MAX_EVENT_CHECKLIST_ITEMS) {
      Alert.alert(t('alerts.attention'), t('events.maxChecklistReached'));
      return;
    }
    setChecklist(previous => [...previous, value]);
    setChecklistInput('');
  };

  const handleAddLink = () => {
    const url = sanitizeValue(linkUrlInput);
    if (!url) {
      return;
    }
    if (links.length >= MAX_EVENT_LINKS) {
      Alert.alert(t('alerts.attention'), t('events.maxLinksReached'));
      return;
    }
    setLinks(previous => [
      ...previous,
      {
        label: sanitizeValue(linkLabelInput) || url,
        url,
      },
    ]);
    setLinkLabelInput('');
    setLinkUrlInput('');
  };

  const uploadPreparedImages = async () => {
    const uploadedUrls: string[] = [];
    const tempPaths: string[] = [];
    try {
      for (const image of images) {
        if (/^https?:\/\//i.test(image.uri)) {
          uploadedUrls.push(image.uri);
          continue;
        }
        const prepared = await prepareUploadableUri({
          uri: image.uri,
          fileName: image.fileName,
          mimeType: image.type,
          fallbackExtension: 'jpg',
          preferStableCopy: true,
        });
        if (prepared.tempPath) {
          tempPaths.push(prepared.tempPath);
        }
        const remoteUrl = await uploadImage(
          prepared.uploadUri,
          `events/images/${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        );
        uploadedUrls.push(remoteUrl);
      }
      return uploadedUrls;
    } finally {
      await Promise.all(tempPaths.map(tempPath => safeUnlinkManagedMediaUri(`file://${tempPath}`)));
    }
  };

  const uploadPreparedVideo = async () => {
    if (!videoUri || /^https?:\/\//i.test(videoUri)) {
      return videoUri;
    }
    const result = await uploadVideoToBunny({
      uri: videoUri,
      name: videoName ?? `event_${Date.now()}.mp4`,
      contentType: videoType ?? 'video/mp4',
      title: sanitizeValue(title) || 'Orbitadrone Event',
      fallbackStoragePrefix: 'events/videos',
      allowStorageFallback: false,
      onProgress: ({loaded, total}) => {
        if (total > 0) {
          setUploadProgress(Math.min(loaded / total, 1));
        }
      },
    });
    return result.playbackUrl;
  };

  const handleSubmit = async () => {
    if (!user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }
    const startsAt = parseEventDateTime(dateInput, timeInput);
    if (!startsAt) {
      Alert.alert(t('alerts.error'), t('events.invalidDateTime'));
      return;
    }
    if (startsAt.getTime() <= Date.now()) {
      Alert.alert(t('alerts.error'), t('events.futureDateRequired'));
      return;
    }
    if (!coordinate) {
      Alert.alert(t('alerts.error'), t('events.locationRequired'));
      return;
    }

    setSubmitting(true);
    setUploadProgress(0);
    try {
      let resolvedLocationLabel = sanitizeValue(locationLabel);
      let resolvedLocationAddress = sanitizeValue(locationAddress);

      if (!resolvedLocationLabel || !resolvedLocationAddress) {
        try {
          const geocodeResult = await geocode(coordinate.latitude, coordinate.longitude);
          resolvedLocationAddress =
            resolvedLocationAddress || geocodeResult?.formatted_address || '';
          const firstPart = resolvedLocationAddress.split(',')[0]?.trim();
          resolvedLocationLabel = resolvedLocationLabel || firstPart || resolvedLocationAddress;
        } catch (error) {
          logger.warn('[CreateEvent] geocoding failed', error);
        }
      }

      const uploadedImages = await uploadPreparedImages();
      const uploadedVideoUrl = await uploadPreparedVideo();
      const created = await createEvent({
        title,
        description,
        startsAt,
        isPublic,
        publicJoinMode: isPublic ? publicJoinMode : DEFAULT_EVENT_PUBLIC_JOIN_MODE,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
        locationLabel: resolvedLocationLabel || null,
        locationAddress: resolvedLocationAddress || null,
        images: uploadedImages,
        videoUrl: uploadedVideoUrl ?? null,
        thumbnailUrl: uploadedImages[0] ?? null,
        checklist,
        links,
        invitedUserIds: selectedInviteeIds,
      });

      Alert.alert(t('alerts.success'), t('events.createdSuccess'));
      navigation.replace('EventDetail', {eventId: created.eventId});
    } catch (error) {
      logger.error('[CreateEvent] submit failed', error);
      Alert.alert(t('alerts.error'), t('events.createError'));
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {paddingTop: topInset + 14, paddingBottom: insets.bottom + 24},
        ]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <Icon name="close" size={22} color={palette.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.title}>{t('events.createTitle')}</Text>
        <Text style={styles.subtitle}>{t('events.createSubtitle')}</Text>

        <View style={styles.card}>
          <Text style={styles.label}>{t('events.titleLabel')}</Text>
          <TextInput
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder={t('events.titlePlaceholder')}
            placeholderTextColor={palette.textMuted}
          />

          <Text style={styles.label}>{t('events.descriptionLabel')}</Text>
          <TextInput
            style={[styles.input, styles.textarea]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('events.descriptionPlaceholder')}
            placeholderTextColor={palette.textMuted}
            multiline
          />

          <View style={styles.inlineFields}>
            <View style={styles.inlineField}>
              <Text style={styles.label}>{t('events.dateLabel')}</Text>
              <TextInput
                style={styles.input}
                value={dateInput}
                onChangeText={setDateInput}
                placeholder="2026-03-13"
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={palette.textMuted}
              />
            </View>
            <View style={styles.inlineField}>
              <Text style={styles.label}>{t('events.timeLabel')}</Text>
              <TextInput
                style={styles.input}
                value={timeInput}
                onChangeText={setTimeInput}
                placeholder="18:30"
                autoCapitalize="none"
                autoCorrect={false}
                placeholderTextColor={palette.textMuted}
              />
            </View>
          </View>

          <Text style={styles.inputHint}>{t('events.dateTimeHint')}</Text>

          <View style={styles.visibilitySection}>
            <Text style={styles.label}>{t('events.visibilityLabel')}</Text>
            <Text style={styles.visibilityHelper}>{t('events.visibilityHelper')}</Text>

            <View style={styles.visibilityOptions}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={[
                  styles.visibilityOptionCard,
                  isPublic && styles.visibilityOptionCardActive,
                ]}
                onPress={() => setIsPublic(true)}>
                <View style={styles.visibilityOptionHeader}>
                  <View style={[styles.visibilityIconWrap, styles.visibilityPublicIconWrap]}>
                    <Icon name="earth" size={18} color="#b45309" />
                  </View>
                  <View style={styles.visibilityOptionTitleWrap}>
                    <Text style={styles.visibilityOptionTitle}>{t('events.publicBadge')}</Text>
                    <Text style={styles.visibilityOptionHint}>{t('events.visibilityPublicHint')}</Text>
                  </View>
                  {isPublic ? (
                    <Icon name="check-circle" size={20} color="#f59e0b" />
                  ) : null}
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                style={[
                  styles.visibilityOptionCard,
                  !isPublic && styles.visibilityOptionCardActive,
                ]}
                onPress={() => setIsPublic(false)}>
                <View style={styles.visibilityOptionHeader}>
                  <View style={[styles.visibilityIconWrap, styles.visibilityPrivateIconWrap]}>
                    <Icon name="lock-outline" size={18} color="#1d4ed8" />
                  </View>
                  <View style={styles.visibilityOptionTitleWrap}>
                    <Text style={styles.visibilityOptionTitle}>{t('events.privateBadge')}</Text>
                    <Text style={styles.visibilityOptionHint}>{t('events.visibilityPrivateHint')}</Text>
                  </View>
                  {!isPublic ? (
                    <Icon name="check-circle" size={20} color={palette.highlight} />
                  ) : null}
                </View>
              </TouchableOpacity>
            </View>

            {isPublic ? (
              <View style={styles.publicJoinModeSection}>
                <Text style={styles.label}>{t('events.publicJoinModeLabel')}</Text>
                <Text style={styles.visibilityHelper}>{t('events.publicJoinModeHelper')}</Text>

                <View style={styles.visibilityOptions}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={[
                      styles.visibilityOptionCard,
                      publicJoinMode === 'approval_required' &&
                        styles.visibilityOptionCardActive,
                    ]}
                    onPress={() => setPublicJoinMode('approval_required')}>
                    <View style={styles.visibilityOptionHeader}>
                      <View style={[styles.visibilityIconWrap, styles.visibilityClosedJoinIconWrap]}>
                        <Icon name="account-lock-outline" size={18} color="#92400e" />
                      </View>
                      <View style={styles.visibilityOptionTitleWrap}>
                        <Text style={styles.visibilityOptionTitle}>
                          {t('events.publicJoinModeApprovalTitle')}
                        </Text>
                        <Text style={styles.visibilityOptionHint}>
                          {t('events.publicJoinModeApprovalHint')}
                        </Text>
                      </View>
                      {publicJoinMode === 'approval_required' ? (
                        <Icon name="check-circle" size={20} color="#f59e0b" />
                      ) : null}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={[
                      styles.visibilityOptionCard,
                      publicJoinMode === 'open' && styles.visibilityOptionCardActive,
                    ]}
                    onPress={() => setPublicJoinMode('open')}>
                    <View style={styles.visibilityOptionHeader}>
                      <View style={[styles.visibilityIconWrap, styles.visibilityOpenJoinIconWrap]}>
                        <Icon name="account-multiple-plus-outline" size={18} color="#166534" />
                      </View>
                      <View style={styles.visibilityOptionTitleWrap}>
                        <Text style={styles.visibilityOptionTitle}>
                          {t('events.publicJoinModeOpenTitle')}
                        </Text>
                        <Text style={styles.visibilityOptionHint}>
                          {t('events.publicJoinModeOpenHint')}
                        </Text>
                      </View>
                      {publicJoinMode === 'open' ? (
                        <Icon name="check-circle" size={20} color={palette.highlight} />
                      ) : null}
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('events.locationLabel')}</Text>
            <TouchableOpacity style={styles.mapPickerButton} onPress={() => setMapModalVisible(true)}>
              <Icon name="map-marker-radius" size={18} color="#fff" />
              <Text style={styles.mapPickerButtonText}>{t('events.pickOnMap')}</Text>
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.input}
            value={locationLabel}
            onChangeText={setLocationLabel}
            placeholder={t('events.locationNamePlaceholder')}
            placeholderTextColor={palette.textMuted}
          />
          <TextInput
            style={styles.input}
            value={locationAddress}
            onChangeText={setLocationAddress}
            placeholder={t('events.locationAddressPlaceholder')}
            placeholderTextColor={palette.textMuted}
          />
          {isResolvingLocation ? (
            <View style={styles.locationLoadingRow}>
              <ActivityIndicator size="small" color={palette.highlight} />
              <Text style={styles.locationLoadingText}>{t('events.locationResolving')}</Text>
            </View>
          ) : null}
          <View style={styles.coordinatePill}>
            <Icon name="crosshairs-gps" size={16} color="#f59e0b" />
            <Text style={styles.coordinateText}>
              {coordinate
                ? `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`
                : t('events.locationRequired')}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.mediaLabel')}</Text>
          <View style={styles.mediaActionRow}>
            <TouchableOpacity style={styles.mediaButton} onPress={pickImages}>
              <Icon name="image-multiple" size={18} color={palette.textPrimary} />
              <Text style={styles.mediaButtonText}>{t('feed.addPhotos')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mediaButton} onPress={pickVideo}>
              <Icon name="video-plus" size={18} color={palette.textPrimary} />
              <Text style={styles.mediaButtonText}>{t('feed.addVideo')}</Text>
            </TouchableOpacity>
          </View>

          {images.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.mediaPreviewRow}>
              {images.map(image => (
                <View key={image.uri} style={styles.imagePreviewWrap}>
                  <Image source={{uri: image.uri}} style={styles.imagePreview} />
                  <TouchableOpacity
                    style={styles.mediaRemove}
                    onPress={() => setImages(previous => previous.filter(item => item.uri !== image.uri))}>
                    <Icon name="close" size={14} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : null}

          {videoUri ? (
            <View style={styles.videoPreviewWrap}>
              <Video source={{uri: videoUri}} style={styles.videoPreview} paused resizeMode="cover" />
              <TouchableOpacity
                style={styles.mediaRemove}
                onPress={() => {
                  safeUnlinkManagedMediaUri(videoUri);
                  setVideoUri(null);
                  setVideoName(null);
                  setVideoType(null);
                }}>
                <Icon name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}

          {preparingVideo ? (
            <View style={styles.progressRow}>
              <ActivityIndicator size="small" color={palette.highlight} />
              <Text style={styles.progressText}>{t('feed.videoPreparingMessage')}</Text>
            </View>
          ) : null}
          {submitting && uploadProgress > 0 ? (
            <Text style={styles.progressText}>
              {t('events.uploadProgress', {percent: Math.round(uploadProgress * 100)})}
            </Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.materialsLabel')}</Text>
          <View style={styles.inlineActionRow}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={checklistInput}
              onChangeText={setChecklistInput}
              placeholder={t('events.materialPlaceholder')}
              placeholderTextColor={palette.textMuted}
            />
            <TouchableOpacity style={styles.addChipButton} onPress={handleAddChecklistItem}>
              <Icon name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.chipsWrap}>
            {checklist.map(item => (
              <View key={item} style={styles.chip}>
                <Text style={styles.chipText}>{item}</Text>
                <TouchableOpacity
                  onPress={() => setChecklist(previous => previous.filter(value => value !== item))}>
                  <Icon name="close" size={16} color={palette.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.linksLabel')}</Text>
          <TextInput
            style={styles.input}
            value={linkLabelInput}
            onChangeText={setLinkLabelInput}
            placeholder={t('events.linkLabelPlaceholder')}
            placeholderTextColor={palette.textMuted}
          />
          <View style={styles.inlineActionRow}>
            <TextInput
              style={[styles.input, styles.inlineInput]}
              value={linkUrlInput}
              onChangeText={setLinkUrlInput}
              placeholder={t('events.linkUrlPlaceholder')}
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity style={styles.addChipButton} onPress={handleAddLink}>
              <Icon name="plus" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={styles.linkList}>
            {links.map(link => (
              <View key={`${link.label}-${link.url}`} style={styles.linkRow}>
                <View style={styles.linkTextWrap}>
                  <Text style={styles.linkLabel}>{link.label}</Text>
                  <Text style={styles.linkUrl} numberOfLines={1}>
                    {link.url}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    setLinks(previous => previous.filter(item => item.url !== link.url))
                  }>
                  <Icon name="trash-can-outline" size={18} color={palette.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t('events.invitesLabel')}</Text>
          <TextInput
            style={styles.input}
            value={inviteQuery}
            onChangeText={setInviteQuery}
            placeholder={t('events.invitesSearchPlaceholder')}
            placeholderTextColor={palette.textMuted}
          />

          {selectedInvitees.length ? (
            <View style={styles.chipsWrap}>
              {selectedInvitees.map(invitee => (
                <View key={invitee.id} style={styles.chip}>
                  <Text style={styles.chipText}>{invitee.displayName}</Text>
                  <TouchableOpacity
                    onPress={() =>
                      setSelectedInviteeIds(previous =>
                        previous.filter(value => value !== invitee.id),
                      )
                    }>
                    <Icon name="close" size={16} color={palette.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}

          {loadingUsers ? (
            <ActivityIndicator size="small" color={palette.highlight} />
          ) : (
            filteredInvitees.slice(0, 8).map(candidate => (
              <TouchableOpacity
                key={candidate.id}
                style={styles.inviteeRow}
                onPress={() =>
                  candidate.id &&
                  setSelectedInviteeIds(previous => [...previous, candidate.id!])
                }>
                <View>
                  <Text style={styles.inviteeName}>{candidate.displayName}</Text>
                  {candidate.cityRegion ? (
                    <Text style={styles.inviteeMeta}>{candidate.cityRegion}</Text>
                  ) : null}
                </View>
                <Icon name="plus-circle" size={22} color="#0ea5e9" />
              </TouchableOpacity>
            ))
          )}
        </View>

        <CustomButton
          title={submitting ? t('common.loading') : t('feed.publishEvent')}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting || preparingVideo}
          style={styles.submitButton}
        />
      </ScrollView>

      <Modal
        visible={isMapModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMapModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.mapModalCard}>
            <View style={styles.mapModalHeader}>
              <Text style={styles.mapModalTitle}>{t('events.locationPickerTitle')}</Text>
              <TouchableOpacity onPress={() => setMapModalVisible(false)}>
                <Icon name="close" size={22} color={palette.textPrimary} />
              </TouchableOpacity>
            </View>

            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={mapRegion}
              onPress={handleMapPress}>
              {isValidCoordinate(coordinate) ? (
                <Marker
                  coordinate={coordinate!}
                  pinColor="#facc15"
                />
              ) : null}
            </MapView>

            <View style={styles.mapActions}>
              <CustomButton
                title={t('profile.pilotMarkerUseCurrentLocation')}
                variant="outline"
                onPress={handleUseCurrentLocation}
                style={styles.mapActionSecondary}
              />
              <CustomButton
                title={t('profile.pilotMarkerSaveButton')}
                onPress={() => setMapModalVisible(false)}
                style={styles.mapActionPrimary}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    paddingHorizontal: 16,
  },
  closeButton: {
    alignSelf: 'flex-end',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  subtitle: {
    color: palette.textSecondary,
    marginTop: 6,
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radii.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 14,
    ...shadows.subtle,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.textPrimary,
    marginBottom: 8,
  },
  input: {
    minHeight: 48,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#d6e0ea',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    color: palette.textPrimary,
    marginBottom: 12,
  },
  textarea: {
    minHeight: 120,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  inlineFields: {
    flexDirection: 'row',
    gap: 10,
  },
  inlineField: {
    flex: 1,
  },
  inputHint: {
    marginTop: -4,
    color: palette.textSecondary,
    fontSize: 12,
  },
  visibilitySection: {
    marginTop: 12,
  },
  visibilityHelper: {
    marginTop: 2,
    color: palette.textSecondary,
    fontSize: 12,
  },
  visibilityOptions: {
    marginTop: 12,
    gap: 10,
  },
  publicJoinModeSection: {
    marginTop: 14,
  },
  visibilityOptionCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: '#d6e0ea',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  visibilityOptionCardActive: {
    borderColor: palette.highlight,
    backgroundColor: '#eff6ff',
  },
  visibilityOptionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  visibilityIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityPublicIconWrap: {
    backgroundColor: '#fef3c7',
  },
  visibilityPrivateIconWrap: {
    backgroundColor: '#dbeafe',
  },
  visibilityClosedJoinIconWrap: {
    backgroundColor: '#ffedd5',
  },
  visibilityOpenJoinIconWrap: {
    backgroundColor: '#dcfce7',
  },
  visibilityOptionTitleWrap: {
    flex: 1,
  },
  visibilityOptionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  visibilityOptionHint: {
    color: palette.textSecondary,
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  mapPickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radii.lg,
  },
  mapPickerButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  coordinatePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: '#fff7ed',
  },
  coordinateText: {
    color: '#92400e',
    fontWeight: '600',
  },
  locationLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -2,
    marginBottom: 10,
  },
  locationLoadingText: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  mediaActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  mediaButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#d6e0ea',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  mediaButtonText: {
    color: palette.textPrimary,
    fontWeight: '700',
  },
  mediaPreviewRow: {
    marginBottom: 8,
  },
  imagePreviewWrap: {
    marginRight: 12,
    width: 110,
    height: 110,
    borderRadius: 18,
    overflow: 'hidden',
  },
  imagePreview: {
    width: '100%',
    height: '100%',
  },
  videoPreviewWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0f172a',
  },
  videoPreview: {
    width: '100%',
    height: '100%',
  },
  mediaRemove: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  progressText: {
    marginTop: 8,
    color: palette.textSecondary,
  },
  inlineActionRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  inlineInput: {
    flex: 1,
    marginBottom: 0,
  },
  addChipButton: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0ea5e9',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#eff6ff',
  },
  chipText: {
    color: '#1e3a8a',
    fontWeight: '600',
  },
  linkList: {
    marginTop: 12,
    gap: 10,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  linkTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  linkLabel: {
    color: palette.textPrimary,
    fontWeight: '700',
  },
  linkUrl: {
    color: palette.textSecondary,
    marginTop: 2,
  },
  inviteeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#edf2f7',
  },
  inviteeName: {
    color: palette.textPrimary,
    fontWeight: '700',
  },
  inviteeMeta: {
    color: palette.textSecondary,
    marginTop: 2,
  },
  submitButton: {
    minHeight: 54,
    marginTop: 4,
    marginBottom: 8,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
  },
  mapModalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    padding: 16,
    minHeight: '70%',
  },
  mapModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  mapModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  map: {
    flex: 1,
    minHeight: 380,
    borderRadius: radii.xl,
    overflow: 'hidden',
  },
  mapActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  mapActionSecondary: {
    flex: 1,
  },
  mapActionPrimary: {
    flex: 1,
  },
});

export default CreateEventScreen;
