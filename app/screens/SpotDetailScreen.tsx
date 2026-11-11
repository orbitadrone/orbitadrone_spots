import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, Image, Linking, TouchableOpacity, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Spot, Review, UserProfile, getSpot, getReviewsForSpot, getUserProfile, deleteSpot } from '../../src/services/firestoreService';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import ImageViewing from 'react-native-image-viewing';
import { Rating } from 'react-native-ratings';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../context/AuthContext';
import { BUNNY_LIBRARY_ID } from '../../src/constants/bunnyEnv';
import { buildSpotShareUrl } from '../../src/constants/links';
import { palette, radii, shadows } from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import ReportReasonModal, {ReportReasonOption} from '../components/ReportReasonModal';
import SpotDetailVideoModal, {SpotDetailVideoInfo} from '../components/SpotDetailVideoModal';
import SpotReviewCard from '../components/SpotReviewCard';
import {
  buildBunnyEmbedUrl,
  buildVideoSourceCandidates,
  extractBunnyVideoGuid,
  isBunnyVideoUrl,
  normalizeRemoteVideoUrl,
} from '../../src/utils/videoPlayback';
import type {AppStackScreenProps} from '../../src/navigation/types';

const createReasonState = (options: Array<{ key: string }>) =>
  Object.fromEntries(options.map(option => [option.key, false])) as Record<string, boolean>;

type DisplayReview = {
  review: Review;
  authorName: string;
  authorProfileId: string | null;
};

const SpotDetailScreen = ({navigation, route}: AppStackScreenProps<'SpotDetail'>) => {
  const { t } = useTranslation();
  const { spotId } = route.params;
  const [spot, setSpot] = useState<Spot | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewAuthors, setReviewAuthors] = useState<Record<string, UserProfile | null>>({});
  const [creatorProfile, setCreatorProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useAuthContext();
  
  // Estado unificado para el modal de video
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [currentVideoInfo, setCurrentVideoInfo] = useState<SpotDetailVideoInfo | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const spotReportOptions = useMemo<ReportReasonOption[]>(
    () => [
      { key: 'photo', label: t('reportReasons.photo') },
      { key: 'video', label: t('reportReasons.video') },
      { key: 'text', label: t('reportReasons.text') },
      { key: 'other', label: t('reportReasons.other') },
    ],
    [t],
  );
  const reviewReportOptions = useMemo<ReportReasonOption[]>(
    () => [
      { key: 'text', label: t('reportReasons.text') },
      { key: 'spam', label: t('reportReasons.spam') },
      { key: 'misinfo', label: t('reportReasons.misinfo') },
      { key: 'other', label: t('reportReasons.other') },
    ],
    [t],
  );
  const [spotReportModalVisible, setSpotReportModalVisible] = useState(false);
  const [spotReportReasons, setSpotReportReasons] = useState<Record<string, boolean>>({});
  const [spotReportNotes, setSpotReportNotes] = useState('');
  const [reviewReportModalVisible, setReviewReportModalVisible] = useState(false);
  const [reviewReportTarget, setReviewReportTarget] = useState<Review | null>(null);
  const [reviewReportReasons, setReviewReportReasons] = useState<Record<string, boolean>>({});
  const [reviewReportNotes, setReviewReportNotes] = useState('');
  const closeVideoModal = useCallback(() => {
    setVideoModalVisible(false);
    setCurrentVideoInfo(null);
  }, []);
  const closeImageModal = useCallback(() => {
    setImageModalVisible(false);
  }, []);
  const navigateToUserProfile = useCallback(
    (userId: string) => {
      navigation.navigate('UserProfile', {userId});
    },
    [navigation],
  );
  const galleryImages = useMemo(
    () =>
      (spot?.galleryImages ?? []).filter(
        (uri): uri is string => typeof uri === 'string' && uri.trim().length > 0,
      ),
    [spot?.galleryImages],
  );
  const displayReviews = useMemo<DisplayReview[]>(
    () =>
      reviews.reduce<DisplayReview[]>((accumulator, review) => {
        const hasRating = typeof review.rating === 'number' && review.rating > 0;
        const hasText = typeof review.text === 'string' && review.text.trim().length > 0;
        if (!hasRating && !hasText) {
          return accumulator;
        }
        const authorProfile = reviewAuthors[review.userId];
        accumulator.push({
          review,
          authorName:
            authorProfile?.displayName?.trim()?.length
              ? authorProfile.displayName
              : t('common.unknownUser'),
          authorProfileId: authorProfile?.id ?? null,
        });
        return accumulator;
      }, []),
    [reviewAuthors, reviews, t],
  );

  const openImageModal = useCallback((index: number) => {
    setCurrentImageIndex(index);
    setImageModalVisible(true);
  }, []);

  const openSpotReportModal = useCallback(() => {
    setSpotReportReasons(createReasonState(spotReportOptions));
    setSpotReportNotes('');
    setSpotReportModalVisible(true);
  }, [spotReportOptions]);

  const closeSpotReportModal = useCallback(() => {
    setSpotReportModalVisible(false);
  }, []);

  const toggleSpotReportReason = (key: string) => {
    setSpotReportReasons(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmitSpotReport = useCallback(async () => {
    if (!spot) {
      return;
    }
    const selectedReasons = spotReportOptions.filter(option => spotReportReasons[option.key]);
    if (!selectedReasons.length) {
      Alert.alert(t('alerts.attention'), t('alerts.selectAtLeastOneReason'));
      return;
    }
    const subject = `Denuncia Spot: ${spot.name ?? spot.id}`;
    const bodyLines = [
      `Spot ID: ${spot.id}`,
      `Nombre: ${spot.name ?? 'N/D'}`,
      `Razones:`,
      ...selectedReasons.map(option => `- ${option.label}`),
      ``,
      `Notas adicionales: ${spotReportNotes.trim() || 'N/D'}`,
    ];
    if (spot.id) {
      bodyLines.push('', `Enlace: ${buildSpotShareUrl(spot.id)}`);
    }
    const emailUrl = `mailto:orbitadrone22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    try {
      await Linking.openURL(emailUrl);
      setSpotReportModalVisible(false);
    } catch {
      Alert.alert(t('alerts.error'), t('alerts.emailNotSupported'));
    }
  }, [spot, spotReportOptions, spotReportReasons, spotReportNotes, t]);

  const openReviewReportModal = useCallback((review: Review) => {
    setReviewReportTarget(review);
    setReviewReportReasons(createReasonState(reviewReportOptions));
    setReviewReportNotes('');
    setReviewReportModalVisible(true);
  }, [reviewReportOptions]);

  const closeReviewReportModal = useCallback(() => {
    setReviewReportModalVisible(false);
    setReviewReportTarget(null);
  }, []);

  const toggleReviewReportReason = (key: string) => {
    setReviewReportReasons(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSubmitReviewReport = useCallback(async () => {
    if (!spot || !reviewReportTarget) {
      return;
    }
    const selectedReasons = reviewReportOptions.filter(option => reviewReportReasons[option.key]);
    if (!selectedReasons.length) {
      Alert.alert(t('alerts.attention'), t('alerts.selectAtLeastOneReason'));
      return;
    }
    const authorProfile = reviewAuthors[reviewReportTarget.userId];
    const subject = `Denuncia Reseña: ${spot.name ?? spot.id}`;
    const bodyLines = [
      `Spot ID: ${spot.id}`,
      `Spot: ${spot.name ?? 'N/D'}`,
      `Review ID: ${reviewReportTarget.id ?? 'N/D'}`,
      `Autor: ${authorProfile?.displayName ?? reviewReportTarget.userId}`,
      `Razones:`,
      ...selectedReasons.map(option => `- ${option.label}`),
    ];
    if (reviewReportTarget.text) {
      bodyLines.push('', 'Texto de la reseña:', reviewReportTarget.text);
    }
    if (typeof reviewReportTarget.rating === 'number') {
      bodyLines.push('', `Valoración: ${reviewReportTarget.rating}`);
    }
    if (reviewReportNotes.trim()) {
      bodyLines.push('', `Notas adicionales: ${reviewReportNotes.trim()}`);
    }
    if (spot.id) {
      bodyLines.push('', `Enlace: ${buildSpotShareUrl(spot.id)}`);
    }
    const emailUrl = `mailto:orbitadrone22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join('\n'))}`;
    try {
      await Linking.openURL(emailUrl);
      closeReviewReportModal();
    } catch {
      Alert.alert(t('alerts.error'), t('alerts.emailNotSupported'));
    }
  }, [spot, reviewReportTarget, reviewReportOptions, reviewReportReasons, reviewReportNotes, reviewAuthors, closeReviewReportModal, t]);

  useFocusEffect(
    useCallback(() => {
      const fetchSpotDetails = async () => {
        setLoading(true);
        try {
          const fetchedSpot = await getSpot(spotId);
          if (fetchedSpot) {
            setSpot(fetchedSpot);
            const fetchedReviews = await getReviewsForSpot(spotId);
            setReviews(fetchedReviews);
            if (fetchedReviews.length > 0) {
              const uniqueAuthorIds = Array.from(
                new Set(
                  fetchedReviews
                    .map(review => review.userId)
                    .filter((id): id is string => typeof id === 'string' && id.length > 0),
                ),
              );
              const authorEntries = await Promise.all(
                uniqueAuthorIds.map(async id => {
                  try {
                    const profile = await getUserProfile(id);
                    return [id, profile] as const;
                  } catch (error) {
                    logger.warn('[SpotDetail] Failed to load review author profile', error);
                    return [id, null] as const;
                  }
                }),
              );
              setReviewAuthors(prev => ({
                ...prev,
                ...Object.fromEntries(authorEntries),
              }));
            } else {
              setReviewAuthors({});
            }
            if (fetchedSpot.createdBy) {
              const profile = await getUserProfile(fetchedSpot.createdBy);
              setCreatorProfile(profile);
            }
          } else {
            Alert.alert(t('alerts.error'), t('alerts.spotNotFound'));
            navigation.goBack();
          }
        } catch (error) {
          logger.error('Error fetching spot details:', error);
          Alert.alert(t('alerts.error'), t('alerts.fetchSpotError'));
          navigation.goBack();
        } finally {
          setLoading(false);
        }
      };

      fetchSpotDetails();

      return () => {
        // Limpiar el estado al salir de la pantalla
        setSpot(null);
        setReviews([]);
        setCreatorProfile(null);
        setReviewAuthors({});
        setVideoModalVisible(false);
        setCurrentVideoInfo(null);
      };
    }, [spotId, navigation, t])
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('blur', () => {
      closeVideoModal();
    });
    return unsubscribe;
  }, [closeVideoModal, navigation]);

  const onShare = async () => {
    if (!spot) return;
    try {
      const shareUrl = spot.id ? buildSpotShareUrl(spot.id) : null;
      const shareMessageBase = t('spotDetail.shareMessage', { spotName: spot.name });
      const sharePayload = shareUrl
        ? {
            message: `${shareMessageBase}\n${shareUrl}`,
            url: shareUrl,
          }
        : { message: shareMessageBase };
      await Share.share(sharePayload);
    } catch (error) {
      Alert.alert((error as Error).message);
    }
  };

  const onGetDirections = () => {
    if (!spot) return;
    const { latitude, longitude } = spot.coordinates;
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    Linking.openURL(url);
  };

  const handleLinkPress = async (url: string, type: 'web' | 'whatsapp' | 'email') => {
    let finalUrl = url;
    if (type === 'email') {
      finalUrl = `mailto:${url}`;
    } else if (type === 'whatsapp') {
      // Limpiar número, probar app y luego web sin quedarse en un canOpenURL falso
      const cleanNumber = url.replace(/\D/g, '');
      if (!cleanNumber || cleanNumber.length < 8) {
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
        return;
      }
      const appUrl = `whatsapp://send?phone=${cleanNumber}`;
      const webUrl = `https://wa.me/${cleanNumber}`;
      try {
        const canOpenApp = await Linking.canOpenURL(appUrl);
        if (canOpenApp) {
          await Linking.openURL(appUrl);
          return;
        }
      } catch (err) {
        logger.warn('[WhatsApp] canOpenURL failed', err);
      }
      try {
        await Linking.openURL(webUrl);
        return;
      } catch (err) {
        logger.warn('[WhatsApp] fallback web failed', err);
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
        return;
      }
    } else if (!url.startsWith('http')) {
      finalUrl = `https://${url}`;
    }

    const supported = await Linking.canOpenURL(finalUrl);
    if (supported) {
      await Linking.openURL(finalUrl);
    } else {
      Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
    }
  };

  const handleDeleteSpot = async () => {
    if (!spot || !currentUser || spot.createdBy !== currentUser.uid) {
      Alert.alert(t('alerts.error'), t('alerts.notAuthorizedToDelete'));
      return;
    }

    Alert.alert(
      t('alerts.confirmDeleteTitle'),
      t('alerts.confirmDeleteMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          onPress: async () => {
            try {
              await deleteSpot(spot.id!);
              Alert.alert(t('alerts.success'), t('alerts.spotDeletedSuccessfully'));
              navigation.goBack(); // Navegar de vuelta después de eliminar
            } catch (error) {
              logger.error('Error deleting spot:', error);
              Alert.alert(t('alerts.error'), t('alerts.deleteSpotError'));
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const openVideoModal = useCallback((url: string) => {
    const trimmedUrl = normalizeRemoteVideoUrl(url || '');
    if (!trimmedUrl) {
      return;
    }

    logger.log('[Video] openVideoModal', trimmedUrl);

    const isFirebaseUrl = trimmedUrl.includes('firebasestorage.googleapis.com');
    const bunnyGuid = extractBunnyVideoGuid(trimmedUrl);
    const isBunnyUrl =
      isBunnyVideoUrl(trimmedUrl) || /\.m3u8(\?|$)/i.test(trimmedUrl) || Boolean(bunnyGuid);
    const isDirectFile =
      /\.(mp4|mov|m4v|webm)(\?|$)/i.test(trimmedUrl);

    logger.log('[Video] classify', {
      isFirebaseUrl,
      isBunnyUrl,
      isDirectFile,
      hasGuid: !!bunnyGuid,
    });

    const shouldUseBunnyEmbed = Boolean(BUNNY_LIBRARY_ID);

    if (isBunnyUrl && bunnyGuid && shouldUseBunnyEmbed) {
      const embedUrl = buildBunnyEmbedUrl(BUNNY_LIBRARY_ID, bunnyGuid, {autoplay: false});
      logger.log('[Video] using bunny embed', embedUrl);
      setCurrentVideoInfo({
        url: embedUrl,
        type: 'bunny',
        guid: bunnyGuid,
      });
      setVideoModalVisible(true);
      return;
    }

    const shouldBeNative = isFirebaseUrl || isDirectFile || !isBunnyUrl;
    if (shouldBeNative) {
      logger.log('[Video] using native player', trimmedUrl);
      const nativeCandidates = buildVideoSourceCandidates(trimmedUrl);
      setCurrentVideoInfo({
        url: nativeCandidates[0],
        type: 'native',
        fallbackUrls: nativeCandidates.slice(1),
      });
      setVideoModalVisible(true);
      return;
    }

    const nativeCandidates = buildVideoSourceCandidates(trimmedUrl);
    setCurrentVideoInfo({
      url: nativeCandidates[0],
      type: 'native',
      fallbackUrls: nativeCandidates.slice(1),
    });
    setVideoModalVisible(true);
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!spot) {
    return (
      <View style={styles.container}>
        <Text>{t('alerts.spotNotFound')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
        <Icon name="close" size={22} color={palette.textPrimary} />
      </TouchableOpacity>
      
      {spot.mainImage && (
        <Image source={{ uri: spot.mainImage }} style={styles.spotImage} />
      )}

      {spot.flightStyles && spot.flightStyles.length > 0 && (
        <View style={styles.flightStylesContainer}>
          {spot.flightStyles.map(style => (
            <View key={style} style={styles.flightStyleTag}>
              <Text style={styles.flightStyleTagText}>{t(`flightStyles.${style}`)}</Text>
            </View>
          ))}
        </View>
      )}

      <Text style={styles.title}>{spot.name}</Text>

      <View style={styles.actionsContainer}>
        <TouchableOpacity style={styles.actionButton} onPress={onShare}>
          <Icon name="share-variant" size={24} color="#007BFF" />
          <Text style={styles.actionButtonText}>{t('spotDetail.shareButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionButton} onPress={onGetDirections}>
          <Icon name="directions" size={24} color="#007BFF" />
          <Text style={styles.actionButtonText}>{t('spotDetail.directionsButton')}</Text>
        </TouchableOpacity>
      </View>

      {creatorProfile && (
        <View style={styles.creatorInfoContainer}>
          <TouchableOpacity onPress={() => navigateToUserProfile(spot.createdBy)} style={styles.creatorTouchable}>
            {creatorProfile.profilePictureUrl ? (
              <Image source={{ uri: creatorProfile.profilePictureUrl }} style={styles.creatorAvatar} />
            ) : (
              <Icon name="account-circle" size={40} color="#cccccc" style={styles.creatorAvatar} />
            )}
            <View style={styles.creatorTextContainer}>
              <Text style={styles.creatorName}>{creatorProfile.displayName}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.socialIconsContainer}>
            {creatorProfile.socials?.youtube && (
              <TouchableOpacity onPress={() => handleLinkPress(creatorProfile.socials!.youtube!, 'web')}>
                <Icon name="youtube" size={24} color="#FF0000" style={styles.socialIcon} />
              </TouchableOpacity>
            )}
            {creatorProfile.socials?.instagram && (
              <TouchableOpacity onPress={() => handleLinkPress(creatorProfile.socials!.instagram!, 'web')}>
                <Icon name="instagram" size={24} color="#C13584" style={styles.socialIcon} />
              </TouchableOpacity>
            )}
            {creatorProfile.socials?.whatsapp && (
              <TouchableOpacity onPress={() => handleLinkPress(creatorProfile.socials!.whatsapp!, 'whatsapp')}>
                <Icon name="whatsapp" size={24} color="#25D366" style={styles.socialIcon} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <Text style={styles.description}>{spot.description}</Text>

      {spot.address && (
        <View style={styles.addressContainer}>
          <Icon name="map-marker-outline" size={16} color="gray" />
          <Text style={styles.addressText}>{spot.address}</Text>
        </View>
      )}

      <View style={styles.ratingActionContainer}>
        <View style={styles.ratingContainer}>
          <Rating
            type="star"
            ratingCount={5}
            imageSize={20}
            readonly
            startingValue={spot.averageRating}
            style={styles.rating}
          />
          <Text style={styles.reviewCountText}>
            ({(spot.ratingCount ?? spot.reviewCount) ?? 0} {t('spotDetail.ratingCountLabel')})
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addReviewButton}
          onPress={() =>
            navigation.navigate('AddReview', {
              spotId: spot.id,
              mode: 'rating',
            })
          }
        >
          <Icon name="plus-circle-outline" size={24} color="#007BFF" />
          <Text style={styles.addReviewButtonText}>{t('spotDetail.addReviewButton')}</Text>
        </TouchableOpacity>
      </View>

      {galleryImages.length > 0 && (
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>{t('spotDetail.gallery')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {galleryImages.map((url, index) => (
              <TouchableOpacity
                key={index}
                activeOpacity={0.8}
                onPress={() => openImageModal(index)}
              >
                <Image source={{ uri: url }} style={styles.galleryImage} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.reportSpotContainer}>
        <TouchableOpacity
          style={styles.reportSpotButton}
          onPress={openSpotReportModal}
        >
          <Icon name="flag-outline" size={16} color="#666" />
          <Text style={styles.reportSpotText}>{t('spotDetail.reportSpotButton')}</Text>
        </TouchableOpacity>
      </View>

      {spot.videoUrl && (
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>{t('spotDetail.videoTitle')}</Text>
          <TouchableOpacity onPress={() => openVideoModal(spot.videoUrl!)} style={styles.videoThumbnail}>
            <View style={styles.playIconContainer}>
              <Icon name="play-circle" size={60} color="rgba(255, 255, 255, 0.8)" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {currentUser && spot.createdBy === currentUser.uid && (
        <View style={styles.adminActionsContainer}>
          <TouchableOpacity
            style={[styles.manageButton, styles.manageButtonNeutral]}
            onPress={() => navigation.navigate('AddSpot', {spot})}
          >
            <Text style={styles.manageButtonText}>{t('spotDetail.editSpotButton')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.manageButton, styles.manageButtonDanger]}
            onPress={handleDeleteSpot}
          >
            <Text style={styles.manageButtonTextDanger}>{t('spotDetail.deleteSpotButton')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {currentUser && spot.createdBy !== currentUser.uid && (
        <View style={styles.improveButtonContainer}>
          <TouchableOpacity
            style={[styles.manageButton, styles.manageButtonNeutral]}
            onPress={() => navigation.navigate('AddSpot', {originalSpot: spot})}
          >
            <Text style={styles.manageButtonText}>{t('spotDetail.improveSpotButton')}</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.reviewsHeader}>
        <Text style={styles.reviewsTitle}>{t('spotDetail.reviewsTitle')}</Text>
        <TouchableOpacity
          style={styles.addReviewTextButton}
          onPress={() =>
            navigation.navigate('AddReview', {
              spotId: spot.id,
              mode: 'comment',
            })
          }
        >
          <Icon name="pencil-plus-outline" size={20} color="#007BFF" />
          <Text style={styles.addReviewTextButtonText}>{t('spotDetail.writeReview')}</Text>
        </TouchableOpacity>
      </View>

      {displayReviews.length === 0 ? (
        <TouchableOpacity
          style={styles.noReviewsContainer}
          onPress={() =>
            navigation.navigate('AddReview', {
              spotId: spot.id,
              mode: 'comment',
            })
          }
        >
          <Icon name="star-plus-outline" size={40} color="#007BFF" />
          <Text style={styles.noReviewsTitle}>{t('spotDetail.beTheFirst')}</Text>
          <Text style={styles.noReviewsText}>{t('spotDetail.noReviewsYet')}</Text>
        </TouchableOpacity>
      ) : (
        displayReviews.map(({review, authorName, authorProfileId}) => (
          <SpotReviewCard
            key={review.id}
            review={review}
            authorName={authorName}
            authorProfileId={authorProfileId}
            reportLabel={t('spotDetail.reportReviewButton')}
            viewVideoLabel={t('spotDetail.viewVideo')}
            onPressAuthor={navigateToUserProfile}
            onOpenVideo={openVideoModal}
            onReport={() => openReviewReportModal(review)}
          />
        ))
      )}

      <ReportReasonModal
        visible={spotReportModalVisible}
        title={t('spotDetail.reportSpotTitle')}
        description={t('spotDetail.reportSpotDescription')}
        options={spotReportOptions}
        selectedReasons={spotReportReasons}
        notes={spotReportNotes}
        notesPlaceholder={t('spotDetail.reportNotesPlaceholder')}
        cancelLabel={t('spotDetail.reportCancelButton')}
        submitLabel={t('spotDetail.reportSubmitButton')}
        onToggleReason={toggleSpotReportReason}
        onChangeNotes={setSpotReportNotes}
        onClose={closeSpotReportModal}
        onSubmit={handleSubmitSpotReport}
      />

      <ReportReasonModal
        visible={reviewReportModalVisible}
        title={t('spotDetail.reportReviewTitle')}
        description={t('spotDetail.reportReviewDescription')}
        options={reviewReportOptions}
        selectedReasons={reviewReportReasons}
        notes={reviewReportNotes}
        notesPlaceholder={t('spotDetail.reportNotesPlaceholder')}
        cancelLabel={t('spotDetail.reportCancelButton')}
        submitLabel={t('spotDetail.reportSubmitButton')}
        onToggleReason={toggleReviewReportReason}
        onChangeNotes={setReviewReportNotes}
        onClose={closeReviewReportModal}
        onSubmit={handleSubmitReviewReport}
      />

      <ImageViewing
        images={galleryImages.map(uri => ({uri}))}
        imageIndex={currentImageIndex}
        visible={imageModalVisible}
        onRequestClose={closeImageModal}
      />

      <SpotDetailVideoModal
        visible={videoModalVisible && !!currentVideoInfo}
        videoInfo={currentVideoInfo}
        playbackErrorTitle={t('alerts.error')}
        playbackErrorMessage={t('alerts.videoPlaybackError')}
        onClose={closeVideoModal}
        onChangeVideoInfo={setCurrentVideoInfo}
      />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: palette.backgroundLight,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 8,
    color: palette.textPrimary,
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 10,
    marginBottom: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.borderLight,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  actionButtonText: {
    marginLeft: 8,
    fontSize: 16,
    color: palette.highlight,
    fontWeight: 'bold',
  },
  description: {
    fontSize: 16,
    marginBottom: 8,
    color: palette.textSecondary,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  addressText: {
    fontSize: 14,
    color: palette.textSecondary,
    marginLeft: 8,
    flex: 1, // Para que el texto se ajuste si es muy largo
  },
  ratingActionContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    paddingRight: 8,
  },
  reviewCountText: {
    fontSize: 16,
    color: palette.textSecondary,
  },
  addReviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.backgroundCard,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  addReviewButtonText: {
    marginLeft: 8,
    color: palette.highlight,
    fontWeight: 'bold',
  },
  creatorInfoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 16,
  },
  creatorTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  creatorAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  creatorTextContainer: {
    justifyContent: 'center',
  },
  creatorName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: palette.textPrimary,
  },
  socialIconsContainer: {
    flexDirection: 'row',
  },
  socialIcon: {
    marginLeft: 15,
  },
  sectionContainer: {
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 12,
    color: palette.textPrimary,
  },
  galleryImage: {
    width: 120,
    height: 120,
    borderRadius: radii.lg,
    marginRight: 10,
  },
  videoThumbnail: {
    width: '100%',
    height: 200,
    borderRadius: radii.lg,
    backgroundColor: '#000',
  },
  playIconContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reviewsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  reviewsTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: palette.textPrimary,
  },
  addReviewTextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addReviewTextButtonText: {
    marginLeft: 6,
    color: palette.highlight,
    fontWeight: 'bold',
    fontSize: 14,
  },
  noReviewsContainer: {
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.lg,
    padding: 20,
    alignItems: 'center',
    marginVertical: 16,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  noReviewsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: palette.textPrimary,
    marginTop: 12,
  },
  noReviewsText: {
    fontSize: 14,
    color: palette.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  adminActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
    gap: 12,
  },
  improveButtonContainer: {
    marginTop: 10,
    marginBottom: 20,
  },
  manageButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.borderLight,
    backgroundColor: palette.backgroundCard,
    alignItems: 'center',
    ...shadows.subtle,
  },
  manageButtonNeutral: {
    borderColor: palette.borderLight,
  },
  manageButtonDanger: {
    borderColor: '#e53935',
  },
  manageButtonText: {
    color: palette.textPrimary,
    fontWeight: '600',
  },
  manageButtonTextDanger: {
    color: '#e53935',
    fontWeight: '600',
  },
  reportSpotContainer: {
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  reportSpotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  reportSpotText: {
    marginLeft: 6,
    color: '#666',
    textDecorationLine: 'underline',
    fontSize: 13,
  },
  spotImage: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
    marginBottom: 16,
    borderRadius: 8,
  },
  flightStylesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  flightStyleTag: {
    backgroundColor: '#e0e0e0',
    borderRadius: 15,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginRight: 8,
    marginBottom: 8,
  },
  flightStyleTagText: {
    color: '#333',
    fontSize: 12,
    fontWeight: 'bold',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: palette.backgroundCard,
    padding: 8,
    borderRadius: radii.lg,
    zIndex: 1,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
});

export default SpotDetailScreen;
