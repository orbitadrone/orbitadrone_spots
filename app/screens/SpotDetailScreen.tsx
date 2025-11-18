import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, Button, Image, Linking, TouchableOpacity, Share, Modal, TextInput } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Spot, Review, UserProfile, getSpot, getReviewsForSpot, getUserProfile, deleteSpot, getSpotWithVersions } from '../../src/services/firestoreService';
import { navigateToSpotAfterAd } from '../../src/utils/spotsNavigation';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import CheckBox from '@react-native-community/checkbox';
import { Platform } from 'react-native';
import Video from 'react-native-video';

import { Rating } from 'react-native-ratings';
import { useTranslation } from 'react-i18next';
import { useAuthContext } from '../context/AuthContext';
import { BUNNY_LIBRARY_ID } from '../../src/constants/bunnyEnv';
import { buildSpotShareUrl } from '../../src/constants/links';

const createReasonState = (options: Array<{ key: string }>) =>
  Object.fromEntries(options.map(option => [option.key, false])) as Record<string, boolean>;


const SpotDetailScreen = ({ route }: { route: { params: { spotId: string } } }) => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const { spotId } = route.params;
  const [spot, setSpot] = useState<Spot | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewAuthors, setReviewAuthors] = useState<Record<string, UserProfile | null>>({});
  const [creatorProfile, setCreatorProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const { user: currentUser } = useAuthContext();
  
  // Estado unificado para el modal de video
  const [videoModalVisible, setVideoModalVisible] = useState(false);
  const [currentVideoInfo, setCurrentVideoInfo] = useState<{ url: string; type: 'native' | 'bunny'; guid?: string } | null>(null);
  const spotReportOptions = useMemo(
    () => [
      { key: 'photo', label: t('reportReasons.photo') },
      { key: 'video', label: t('reportReasons.video') },
      { key: 'text', label: t('reportReasons.text') },
      { key: 'other', label: t('reportReasons.other') },
    ],
    [t],
  );
  const reviewReportOptions = useMemo(
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
    } catch (error) {
      Alert.alert(t('alerts.error'), t('alerts.emailNotSupported'));
    }
  }, [spot, spotReportOptions, spotReportReasons, spotReportNotes, buildSpotShareUrl, t]);

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
    } catch (error) {
      Alert.alert(t('alerts.error'), t('alerts.emailNotSupported'));
    }
  }, [spot, reviewReportTarget, reviewReportOptions, reviewReportReasons, reviewReportNotes, buildSpotShareUrl, reviewAuthors, closeReviewReportModal, t]);

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
                    console.warn('[SpotDetail] Failed to load review author profile', error);
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
          console.error("Error fetching spot details: ", error);
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
      setVideoModalVisible(false);
      setCurrentVideoInfo(null);
    });
    return unsubscribe;
  }, [navigation]);

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
      // Asegurarse de que el número no tenga caracteres extraños y tenga el código de país
      const cleanNumber = url.replace(/[^0-9]/g, '');
      finalUrl = `https://wa.me/${cleanNumber}`;
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
              console.error("Error deleting spot: ", error);
              Alert.alert(t('alerts.error'), t('alerts.deleteSpotError'));
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const openVideoModal = (url: string) => {
    const trimmedUrl = url?.trim();
    if (!trimmedUrl) {
      return;
    }

    console.log('[Video] openVideoModal', trimmedUrl);

    const isFirebaseUrl = trimmedUrl.includes('firebasestorage.googleapis.com');
    const bunnyGuidMatch = trimmedUrl.match(
      /\/([0-9a-fA-F-]{36})(?:\/[^/]*)?(?:\?|$)/,
    );
    const isBunnyUrl =
      trimmedUrl.includes('.b-cdn.net') ||
      trimmedUrl.includes('video.bunnycdn.com') ||
      /\.m3u8(\?|$)/i.test(trimmedUrl) ||
      !!bunnyGuidMatch;
    const isDirectFile =
      /\.(mp4|mov|m4v|webm)(\?|$)/i.test(trimmedUrl);

    console.log('[Video] classify', {
      isFirebaseUrl,
      isBunnyUrl,
      isDirectFile,
      hasGuid: !!bunnyGuidMatch,
    });

    if (isBunnyUrl && bunnyGuidMatch) {
      const guid = bunnyGuidMatch[1];
      const embedUrl = `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${guid}?autoplay=false`;
      console.log('[Video] using bunny embed', embedUrl);
      setCurrentVideoInfo({
        url: embedUrl,
        type: 'bunny',
        guid,
      });
      setVideoModalVisible(true);
      return;
    }

    const shouldBeNative = isFirebaseUrl || isDirectFile || !isBunnyUrl;
    if (shouldBeNative) {
      console.log('[Video] using native player', trimmedUrl);
      setCurrentVideoInfo({ url: trimmedUrl, type: 'native' });
      setVideoModalVisible(true);
    }
  };

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
        <Icon name="close" size={24} color="#fff" />
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
          <TouchableOpacity onPress={() => navigation.navigate('UserProfile' as never, { userId: spot.createdBy } as never)} style={styles.creatorTouchable}>
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
            navigation.navigate(
              'AddReview' as never,
              { spotId: spot.id, mode: 'rating' } as never,
            )
          }
        >
          <Icon name="plus-circle-outline" size={24} color="#007BFF" />
          <Text style={styles.addReviewButtonText}>{t('spotDetail.addReviewButton')}</Text>
        </TouchableOpacity>
      </View>

      {spot.galleryImages && spot.galleryImages.length > 0 && (
        <View style={styles.sectionContainer}>
          <Text style={styles.sectionTitle}>{t('spotDetail.gallery')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {spot.galleryImages.map((url, index) => (
              <Image key={index} source={{ uri: url }} style={styles.galleryImage} />
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
          <View style={styles.adminButton}>
            <Button 
              title={t('spotDetail.editSpotButton')} 
              onPress={() => navigation.navigate('AddSpot' as never, { spot: spot } as never)}
            />
          </View>
          <View style={styles.adminButton}>
            <Button title={t('spotDetail.deleteSpotButton')} color="red" onPress={handleDeleteSpot} />
          </View>
        </View>
      )}

      {currentUser && spot.createdBy !== currentUser.uid && (
        <View style={styles.improveButtonContainer}>
          <Button 
            title={t('spotDetail.improveSpotButton')} 
            onPress={() => navigation.navigate('AddSpot' as never, { originalSpot: spot } as never)}
          />
        </View>
      )}

      <View style={styles.reviewsHeader}>
        <Text style={styles.reviewsTitle}>{t('spotDetail.reviewsTitle')}</Text>
        <TouchableOpacity
          style={styles.addReviewTextButton}
          onPress={() =>
            navigation.navigate(
              'AddReview' as never,
              { spotId: spot.id, mode: 'comment' } as never,
            )
          }
        >
          <Icon name="pencil-plus-outline" size={20} color="#007BFF" />
          <Text style={styles.addReviewTextButtonText}>{t('spotDetail.writeReview')}</Text>
        </TouchableOpacity>
      </View>

      {reviews.length === 0 ? (
        <TouchableOpacity
          style={styles.noReviewsContainer}
          onPress={() =>
            navigation.navigate(
              'AddReview' as never,
              { spotId: spot.id, mode: 'comment' } as never,
            )
          }
        >
          <Icon name="star-plus-outline" size={40} color="#007BFF" />
          <Text style={styles.noReviewsTitle}>{t('spotDetail.beTheFirst')}</Text>
          <Text style={styles.noReviewsText}>{t('spotDetail.noReviewsYet')}</Text>
        </TouchableOpacity>
      ) : (
        reviews.map(reviewItem => {
          const displayRating =
            typeof reviewItem.rating === 'number' && reviewItem.rating > 0;
          const displayText =
            typeof reviewItem.text === 'string' && reviewItem.text.trim().length > 0;
          if (!displayRating && !displayText) {
            return null;
          }
          const authorProfile = reviewAuthors[reviewItem.userId];
          const authorName =
            authorProfile?.displayName?.trim()?.length
              ? authorProfile.displayName
              : t('common.unknownUser');
          const goToAuthorProfile = () => {
            if (!authorProfile?.id) {
              return;
            }
            navigation.navigate('UserProfile' as never, { userId: authorProfile.id } as never);
          };
          return (
            <View key={reviewItem.id} style={styles.reviewCard}>
              <TouchableOpacity onPress={goToAuthorProfile} disabled={!authorProfile?.id}>
                <Text
                  style={[
                    styles.reviewAuthor,
                    authorProfile?.id ? styles.reviewAuthorLink : undefined,
                  ]}
                >
                  {authorName}
                </Text>
              </TouchableOpacity>
              {displayRating && (
                <Rating
                  type="star"
                  ratingCount={5}
                  imageSize={15}
                  readonly
                  startingValue={reviewItem.rating}
                  style={styles.reviewRating}
                />
              )}
              {displayText && <Text style={styles.reviewText}>{reviewItem.text}</Text>}
            {reviewItem.photos && reviewItem.photos.length > 0 && (
              <View style={styles.reviewPhotosContainer}>
                {reviewItem.photos.map((photoUri, index) => (
                  <Image key={index} source={{ uri: photoUri }} style={styles.reviewPhoto} />
                ))}
              </View>
            )}
            {reviewItem.videoUrl && (
              <Button title={t('spotDetail.viewVideo')} onPress={() => openVideoModal(reviewItem.videoUrl!)} />
            )}
            <TouchableOpacity
              style={styles.reviewReportButton}
              onPress={() => openReviewReportModal(reviewItem)}
            >
              <Icon name="flag-outline" size={16} color="#666" />
              <Text style={styles.reviewReportText}>{t('spotDetail.reportReviewButton')}</Text>
            </TouchableOpacity>
            </View>
          );
        })
      )}

      <Modal
        animationType="fade"
        transparent
        visible={spotReportModalVisible}
        onRequestClose={closeSpotReportModal}
      >
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModalContent}>
            <Text style={styles.reportModalTitle}>{t('spotDetail.reportSpotTitle')}</Text>
            <Text style={styles.reportModalDescription}>{t('spotDetail.reportSpotDescription')}</Text>
            {spotReportOptions.map(option => (
              <View key={option.key} style={styles.reportCheckboxRow}>
                <CheckBox
                  value={!!spotReportReasons[option.key]}
                  onValueChange={() => toggleSpotReportReason(option.key)}
                  tintColors={{ true: '#007BFF', false: '#ccc' }}
                />
                <Text style={styles.reportCheckboxLabel}>{option.label}</Text>
              </View>
            ))}
            <TextInput
              style={styles.reportNotesInput}
              placeholder={t('spotDetail.reportNotesPlaceholder')}
              placeholderTextColor="#888"
              value={spotReportNotes}
              onChangeText={setSpotReportNotes}
              multiline
            />
            <View style={styles.reportModalActions}>
              <TouchableOpacity
                style={[styles.reportActionButton, styles.reportCancelButton]}
                onPress={closeSpotReportModal}
              >
                <Text style={styles.reportCancelText}>{t('spotDetail.reportCancelButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportActionButton, styles.reportSubmitButton]}
                onPress={handleSubmitSpotReport}
              >
                <Text style={styles.reportSubmitText}>{t('spotDetail.reportSubmitButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={reviewReportModalVisible}
        onRequestClose={closeReviewReportModal}
      >
        <View style={styles.reportModalOverlay}>
          <View style={styles.reportModalContent}>
            <Text style={styles.reportModalTitle}>{t('spotDetail.reportReviewTitle')}</Text>
            <Text style={styles.reportModalDescription}>{t('spotDetail.reportReviewDescription')}</Text>
            {reviewReportOptions.map(option => (
              <View key={option.key} style={styles.reportCheckboxRow}>
                <CheckBox
                  value={!!reviewReportReasons[option.key]}
                  onValueChange={() => toggleReviewReportReason(option.key)}
                  tintColors={{ true: '#007BFF', false: '#ccc' }}
                />
                <Text style={styles.reportCheckboxLabel}>{option.label}</Text>
              </View>
            ))}
            <TextInput
              style={styles.reportNotesInput}
              placeholder={t('spotDetail.reportNotesPlaceholder')}
              placeholderTextColor="#888"
              value={reviewReportNotes}
              onChangeText={setReviewReportNotes}
              multiline
            />
            <View style={styles.reportModalActions}>
              <TouchableOpacity
                style={[styles.reportActionButton, styles.reportCancelButton]}
                onPress={closeReviewReportModal}
              >
                <Text style={styles.reportCancelText}>{t('spotDetail.reportCancelButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reportActionButton, styles.reportSubmitButton]}
                onPress={handleSubmitReviewReport}
              >
                <Text style={styles.reportSubmitText}>{t('spotDetail.reportSubmitButton')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="slide"
        transparent={false}
        visible={videoModalVisible && !!currentVideoInfo}
        onRequestClose={() => {
          setVideoModalVisible(false);
          setCurrentVideoInfo(null);
        }}
      >
        <View style={styles.modalContainer}>
          <TouchableOpacity
            style={styles.modalCloseButton}
            onPress={() => {
              setVideoModalVisible(false);
              setCurrentVideoInfo(null);
            }}
          >
            <Icon name="close" size={30} color="#fff" />
          </TouchableOpacity>
          
          {currentVideoInfo && (
            currentVideoInfo.type === 'bunny'
              ? // Lazy require WebView only on iOS to avoid Android build-time dependency
                (() => {
                  console.log('[Video] render bunny', currentVideoInfo);
                  const { WebView } = require('react-native-webview');
                  return (
                    <WebView
                      style={styles.webview}
                      javaScriptEnabled
                      domStorageEnabled
                      allowsFullscreenVideo
                      allowsInlineMediaPlayback
                      mediaPlaybackRequiresUserAction={false}
                      originWhitelist={['*']}
                      onShouldStartLoadWithRequest={(request: any) => {
                        const url = (request?.url || '').toLowerCase();
                        return url.startsWith('https://iframe.mediadelivery.net/');
                      }}
                      source={{ uri: currentVideoInfo.url }}
                      thirdPartyCookiesEnabled={false}
                      javaScriptCanOpenWindowsAutomatically={false}
                      setSupportMultipleWindows={false}
                      mixedContentMode="never"
                    />
                  );
                })()
              : (
                  <Video
                    // Simple render log; full error handling is in onError below
                    onReadyForDisplay={() =>
                      console.log('[Video] render native', currentVideoInfo)
                    }
                    source={{ uri: currentVideoInfo.url }}
                    style={styles.videoPlayer}
                    controls
                    resizeMode="contain"
                    onError={e => {
                      console.log('Video Error', e);
                      Alert.alert(
                        t('alerts.error'),
                        `${t('alerts.videoPlaybackError')}\n\n${JSON.stringify(e)}`,
                      );
                    }}
                  />
                )
          )}
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
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
  },
  actionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 10,
    marginBottom: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
  },
  actionButtonText: {
    marginLeft: 8,
    fontSize: 16,
    color: '#007BFF',
    fontWeight: 'bold',
  },
  description: {
    fontSize: 16,
    marginBottom: 8,
  },
  addressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  addressText: {
    fontSize: 14,
    color: 'gray',
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
    color: 'gray',
  },
  addReviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f8ff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  addReviewButtonText: {
    marginLeft: 8,
    color: '#007BFF',
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
  },
  galleryImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginRight: 10,
  },
  videoThumbnail: {
    width: '100%',
    height: 200,
    borderRadius: 8,
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
  },
  addReviewTextButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  addReviewTextButtonText: {
    marginLeft: 6,
    color: '#007BFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  noReviewsContainer: {
    backgroundColor: '#f0f8ff',
    borderRadius: 8,
    padding: 20,
    alignItems: 'center',
    marginVertical: 16,
  },
  noReviewsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#005a9e',
    marginTop: 12,
  },
  noReviewsText: {
    fontSize: 14,
    color: 'gray',
    marginTop: 4,
    textAlign: 'center',
  },
  reviewCard: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  reviewAuthor: {
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  reviewAuthorLink: {
    color: '#007BFF',
    textDecorationLine: 'underline',
  },
  reviewRating: {
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  reviewText: {
    fontSize: 14,
    color: '#444',
    lineHeight: 22,
  },
  reviewReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  reviewReportText: {
    marginLeft: 4,
    color: '#666',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
  reviewPhotosContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  reviewPhoto: {
    width: 100,
    height: 100,
    margin: 4,
    borderRadius: 8,
  },
  adminActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginVertical: 10,
  },
  adminButton: {
    flex: 1,
    marginHorizontal: 5,
  },
  improveButtonContainer: {
    marginTop: 10,
    marginBottom: 20,
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
  reportModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  reportModalContent: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
  },
  reportModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  reportModalDescription: {
    fontSize: 14,
    color: '#555',
    marginBottom: 16,
    textAlign: 'center',
  },
  reportCheckboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportCheckboxLabel: {
    marginLeft: 12,
    fontSize: 15,
    color: '#333',
    flex: 1,
    flexWrap: 'wrap',
  },
  reportNotesInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    color: '#000',
  },
  reportModalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  reportActionButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
  },
  reportCancelButton: {
    backgroundColor: '#f2f2f2',
  },
  reportSubmitButton: {
    backgroundColor: '#007BFF',
  },
  reportCancelText: {
    color: '#555',
    fontWeight: '600',
  },
  reportSubmitText: {
    color: '#fff',
    fontWeight: '600',
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
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
    zIndex: 1,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
  },
  modalCloseButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 2,
  },
  webview: {
    flex: 1,
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default SpotDetailScreen;
