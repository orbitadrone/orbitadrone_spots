import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Alert, ActivityIndicator, Image, TouchableOpacity, ScrollView, Linking, Modal } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addSpot, updateSpot, Spot, deleteSpot } from '../../src/services/firestoreService';
import { uploadImage } from '../../src/services/storageService';
import { launchImageLibrary, launchCamera, ImageLibraryOptions, Asset, ImagePickerResponse } from 'react-native-image-picker';
import CheckBox from '@react-native-community/checkbox';
import Icon from 'react-native-vector-icons/FontAwesome';
import { geocode } from '../../src/utils/geocoding';
import { Video } from 'react-native-compressor';
import { adManager } from '../../src/services/adManager';
import { useAds } from '../context/AdContext';
import { useAuthContext } from '../context/AuthContext';

import { flightStylesOptions } from '../../src/constants/flightStyles';
import { requestMediaPermission, requestCameraPermission } from '../../src/utils/permissions';
import { uploadVideoToBunny } from '../../src/services/bunnyStreamService';

const VIDEO_LIMITS = {
  maxDurationSeconds: 60,
  // ~HD (720p) 1 min ≈ 40–80 MB dependiendo del bitrate.
  // Dejamos un margen razonable sin acercarnos al límite de 500 MB del backend.
  maxSizeMB: 80,
  // A partir de aquí intentamos comprimir para aligerar la subida.
  compressionThresholdMB: 40,
} as const;

const BYTES_PER_MB = 1024 * 1024;

const AddSpotScreen = ({ navigation, route }: { navigation: any, route: { params?: { spot?: Spot, originalSpot?: Spot, coordinate?: { latitude: number, longitude: number } } } }) => {
  const { t } = useTranslation();
  const { spot = null, originalSpot = null, coordinate: initialCoordinate } = route.params || {};
  const { areAdsDisabled } = useAds();
  const { user: currentUser } = useAuthContext();
  
  const spotToEdit = spot || originalSpot;
  const isEditing = !!spot;
  const isImproving = !!originalSpot;


  const [spotName, setSpotName] = useState(spotToEdit?.name || '');
  const [spotAddress, setSpotAddress] = useState(spotToEdit?.address || '');
  const [spotDescription, setSpotDescription] = useState(spotToEdit?.description || '');
  const [spotImage, setSpotImage] = useState<string | null>(spotToEdit?.mainImage || null);
  const [galleryImages, setGalleryImages] = useState<string[]>(spotToEdit?.galleryImages || []);
  const [videoUri, setVideoUri] = useState<string | null>(spotToEdit?.videoUrl || null);
  const [flightStyles, setFlightStyles] = useState<string[]>(spotToEdit?.flightStyles || []);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [showTipsModal, setShowTipsModal] = useState(false);
  const [coordinate] = useState(initialCoordinate || (spotToEdit && spotToEdit.coordinates ? { latitude: spotToEdit.coordinates.latitude, longitude: spotToEdit.coordinates.longitude } : null));
  const [loading, setLoading] = useState(false);
  const [geocodingLoading, setGeocodingLoading] = useState(false);
  const [compressingVideo, setCompressingVideo] = useState(false);
  const ensureMediaPermissions = async () => {
    const mediaGranted = await requestMediaPermission();
    const cameraGranted = await requestCameraPermission();
    if (!mediaGranted || !cameraGranted) {
      Alert.alert(
        t('alerts.mediaPermissionDeniedTitle'),
        t('alerts.mediaPermissionDeniedMessage'),
      );
      return false;
    }
    return true;
  };

  const pickImagesWithPrompt = async (options: ImageLibraryOptions) => {
    const canProceed = await ensureMediaPermissions();
    if (!canProceed) {
      return null;
    }

    return new Promise<Asset[] | null>((resolve) => {
      let resolved = false;
      const finish = (assets: Asset[] | null) => {
        if (resolved) return;
        resolved = true;
        resolve(assets);
      };

      const handleResponse = (response: ImagePickerResponse) => {
        if (!response || response.didCancel) {
          finish(null);
          return;
        }
        if (response.errorCode) {
          console.log('ImagePicker Error: ', response.errorCode, response.errorMessage);
          Alert.alert(t('alerts.error'), t('alerts.imagePickerError'));
          finish(null);
          return;
        }
        const assets = (response.assets || []).filter((asset): asset is Asset => !!asset?.uri);
        finish(assets.length ? assets : null);
      };

      const openLibrary = () => launchImageLibrary(options, handleResponse);
      const openCamera = () =>
        launchCamera(
          {
            mediaType: options.mediaType ?? 'photo',
            quality: options.quality ?? 0.8,
            saveToPhotos: true,
            cameraType: 'back',
          },
          handleResponse,
        );

      Alert.alert(
        t('common.chooseImageSource'),
        '',
        [
          { text: t('common.cancel'), style: 'cancel', onPress: () => finish(null) },
          { text: t('common.imageSourceCamera'), onPress: openCamera },
          { text: t('common.imageSourceGallery'), onPress: openLibrary },
        ],
        { cancelable: true },
      );
    });
  };

  const handleToggleStyle = (style: string) => {
    setFlightStyles(prevStyles => 
      prevStyles.includes(style) 
        ? prevStyles.filter(s => s !== style) 
        : [...prevStyles, style]
    );
  };

  useEffect(() => {
    if (!isEditing && coordinate && !spotAddress) {
      const fetchAddress = async () => {
        setGeocodingLoading(true);
        try {
          const result = await geocode(coordinate.latitude, coordinate.longitude);
          if (result && result.formatted_address) {
            setSpotAddress(result.formatted_address);
          }
        } catch (error) {
          console.error("Error geocoding: ", error);
          Alert.alert(t('alerts.error'), t('alerts.locationError'));
        } finally {
          setGeocodingLoading(false);
        }
      };
      fetchAddress();
    }
  }, [isEditing, coordinate, spotAddress, t]);

  const handleChooseSpotImage = async () => {
    const assets = await pickImagesWithPrompt({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });
    const uri = assets?.[0]?.uri ?? null;
    if (uri) {
      setSpotImage(uri);
    }
  };

  const handleChooseGallery = async () => {
    const remainingSlots = Math.max(0, 5 - galleryImages.length);
    if (!remainingSlots) {
      Alert.alert(t('alerts.attention'), t('addSpot.galleryLimitReached'));
      return;
    }
    const assets = await pickImagesWithPrompt({ mediaType: 'photo', quality: 0.5, selectionLimit: remainingSlots });
    if (assets && assets.length > 0) {
      const uris = assets
        .map(asset => asset.uri)
        .filter((uri): uri is string => !!uri);
      if (uris.length) {
        setGalleryImages(prev => [...prev, ...uris].slice(0, 5));
      }
    }
  };

  const ensureFileLikeUri = (input?: string | null) => {
    if (!input) {
      return null;
    }
    if (input.startsWith('file://') || input.startsWith('content://')) {
      return input;
    }
    if (input.startsWith('/')) {
      return `file://${input}`;
    }
    return `file:///${input}`;
  };

  const normalizeVideoUri = (asset: Pick<Asset, 'uri' | 'path'> & Partial<Asset>) => {
    const { uri, path } = asset;
    if (uri?.startsWith('content://')) {
      return uri;
    }
    if (path?.startsWith('content://')) {
      return path;
    }

    const normalizedPath = ensureFileLikeUri(path);
    if (normalizedPath) {
      return normalizedPath;
    }

    return ensureFileLikeUri(uri);
  };

  const handleChooseVideo = async () => {
    const canProceed = await ensureMediaPermissions();
    if (!canProceed) {
      return;
    }
    const options: ImageLibraryOptions = { mediaType: 'video', includeExtra: true };
    const { maxDurationSeconds, maxSizeMB, compressionThresholdMB } = VIDEO_LIMITS;

    launchImageLibrary(options, async (response) => {
      if (response.didCancel || !response.assets || response.assets.length === 0) {
        return;
      }

      const videoAsset = response.assets[0];
      const originalWasContentUri =
        videoAsset.uri?.startsWith('content://') ?? false;
      const resolvedUri = normalizeVideoUri(videoAsset);
      if (!resolvedUri) {
        Alert.alert(t('alerts.error'), t('alerts.videoCompressErrorMessage'));
        return;
      }
      // Validación de Duración
      if (videoAsset.duration && videoAsset.duration > maxDurationSeconds) {
        Alert.alert(
          t('addSpot.videoTooLongTitle'),
          t('addSpot.videoTooLongMessage', {
            maxDuration: maxDurationSeconds,
          }),
        );
        return;
      }

      // Validación de Tamaño
      if (videoAsset.fileSize && videoAsset.fileSize > maxSizeMB * BYTES_PER_MB) {
        Alert.alert(t('addSpot.videoTooLargeTitle'), t('addSpot.videoTooLargeMessage', { maxSize: maxSizeMB }));
        return;
      }

      const requiresFileUriConversion = originalWasContentUri; // Android entrega content://; necesitamos file:// para XHR
      const shouldCompressForSize =
        videoAsset.fileSize !== undefined &&
        videoAsset.fileSize > compressionThresholdMB * BYTES_PER_MB;
      const alwaysCompressLocal = true;
      const shouldRunCompressor =
        originalWasContentUri ||
        shouldCompressForSize ||
        (alwaysCompressLocal && resolvedUri.startsWith('file://'));

      if (shouldRunCompressor) {
        setCompressingVideo(true);
        try {
          const compressedUri = await Video.compress(
            resolvedUri,
            { compressionMethod: 'auto' },
            (progress) => {
              console.log('Compression Progress: ', progress);
            }
          );
          const normalizedCompressedUri =
            normalizeVideoUri({ uri: compressedUri, path: compressedUri }) ?? compressedUri;
          console.log('Video compressed to URI:', normalizedCompressedUri);
          setVideoUri(normalizedCompressedUri);
        } catch (error) {
          console.error('Error compressing video:', error);
          Alert.alert(t('alerts.videoCompressErrorTitle'), t('alerts.videoCompressErrorMessage'));
          if (originalWasContentUri) {
            setVideoUri(null);
            return;
          }
          const fallbackUri =
            normalizeVideoUri({ uri: resolvedUri, path: resolvedUri }) ?? resolvedUri;
          setVideoUri(fallbackUri); // Fallback to original video when safe
        } finally {
          setCompressingVideo(false);
        }
      } else {
        const sanitizedUri =
          normalizeVideoUri({ uri: resolvedUri, path: resolvedUri }) ?? resolvedUri;
        setVideoUri(sanitizedUri);
        setCompressingVideo(false);
      }
    });
  };

  const removeGalleryImage = (uri: string) => {
    setGalleryImages(prev => prev.filter(imageUri => imageUri !== uri));
  };

  const handleSaveSpot = async () => {
    if (!currentUser) {
      Alert.alert(t('alerts.attention'), t('alerts.notAuthenticated'));
      return;
    }
    if (!spotName) {
      Alert.alert(t('alerts.attention'), t('alerts.enterSpotName'));
      return;
    }
    setLoading(true);
    try {
      const uploadImageIfNeeded = async (uri: string | null, pathPrefix: string) => {
        if (uri && uri.startsWith('file://')) {
          const path = `${pathPrefix}/${Date.now()}_${spotName.replace(/\s/g, '_')}`;
          return await uploadImage(uri, path);
        }
        return uri;
      };

      const uploadVideoIfNeeded = async (uri: string | null) => {
        if (uri && !uri.startsWith('http')) {
          setUploadingVideo(true);
          setVideoUploadProgress(0);
          try {
            const { playbackUrl } = await uploadVideoToBunny({
              uri,
              title: spotName || 'Orbitadrone Spot',
              name: `${spotName.replace(/\s/g, '_') || 'spot'}_${Date.now()}.mp4`,
              contentType: 'video/mp4',
              onProgress: ({ loaded, total }) => {
                if (total && total > 0) {
                  setVideoUploadProgress(Math.min(loaded / total, 1));
                }
              },
            });
            setVideoUploadProgress(1);
            return playbackUrl;
          } catch (error) {
            console.error('Error uploading video to Bunny:', error);
            Alert.alert(t('alerts.error'), t('alerts.videoUploadError'));
            throw { __bunnyUploadError: true, originalError: error };
          } finally {
            setUploadingVideo(false);
          }
        }
        return uri;
      };

      const finalSpotImageUrl = await uploadImageIfNeeded(spotImage, 'spot_images');
      const finalVideoUrl = await uploadVideoIfNeeded(videoUri);

      const uploadedGalleryUrls = await Promise.all(
        galleryImages.map(uri => uploadImageIfNeeded(uri, 'spot_gallery'))
      );
      const cleanedGalleryUrls = uploadedGalleryUrls.filter(
        (url): url is string => !!url,
      );

      const spotData: any = {
        name: spotName,
        address: spotAddress,
        description: spotDescription,
        flightStyles: flightStyles,
      };

      if (isEditing && spot) {
        spotData.mainImage = finalSpotImageUrl ?? null;
        spotData.videoUrl = finalVideoUrl ?? null;
        spotData.galleryImages = cleanedGalleryUrls;

        await updateSpot(spot.id!, spotData);
        Alert.alert(t('alerts.success'), t('alerts.spotUpdated'));
      } else if (coordinate) {
        // Si es una mejora, establecer el parentId.
        if (isImproving && originalSpot) {
          // Si el spot original ya era una versión, usamos su parentId. Si no, usamos su propio id.
          spotData.parentId = originalSpot.parentId || originalSpot.id;
        }

        if (finalSpotImageUrl) {
          spotData.mainImage = finalSpotImageUrl;
        }
        if (finalVideoUrl) {
          spotData.videoUrl = finalVideoUrl;
        }
        if (cleanedGalleryUrls.length > 0) {
          spotData.galleryImages = cleanedGalleryUrls;
        }

        await addSpot({
          ...(spotData as any),
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
        });
        Alert.alert(t('alerts.success'), t(isImproving ? 'alerts.spotImproved' : 'alerts.spotSaved'));
      } else {
        Alert.alert(t('alerts.error'), t('alerts.noCoordinates'));
      }
      // La navegación ahora ocurre solo después de que el anuncio se cierre.
      adManager.showInterstitialAd(() => {
        navigation.goBack();
      }, areAdsDisabled);
    } catch (error) {
      if ((error as any)?.__bunnyUploadError) {
        return;
      }
      console.error("Error saving spot: ", error);
      Alert.alert(t('alerts.error'), t('alerts.spotSaveError'));
    } finally {
      setLoading(false);
      setVideoUploadProgress(0);
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
              navigation.goBack();
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

  if (loading) {
    const savingMessage = uploadingVideo
      ? t('addSpot.uploadingVideoProgress', {
          percent: Math.round(Math.min(videoUploadProgress, 1) * 100),
        })
      : t(isEditing ? 'addSpot.updating' : 'addSpot.saving');

    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>{savingMessage}</Text>
        {uploadingVideo ? (
          <View style={styles.loadingProgressBar}>
            <View
              style={[
                styles.loadingProgressFill,
                { width: `${Math.round(Math.min(videoUploadProgress, 1) * 100)}%` },
              ]}
            />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeButton}>
        <Icon name="close" size={30} color="#000" />
      </TouchableOpacity>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.container}>
        <Text style={styles.title}>{t(isEditing ? 'addSpot.editTitle' : 'addSpot.title')}</Text>

        <View style={styles.imageHeader}>
          <TouchableOpacity onPress={handleChooseSpotImage} style={styles.spotImageContainer} activeOpacity={0.85}>
            {spotImage ? (
              <Image source={{ uri: spotImage }} style={styles.spotImage} />
            ) : (
              <View style={styles.spotImagePlaceholder}>
                <Icon name="camera" size={28} color="#666" />
                <Text style={styles.spotImagePlaceholderText}>{t('addSpot.addSpotPhoto')}</Text>
              </View>
            )}
            <TouchableOpacity onPress={handleChooseSpotImage} style={styles.cameraIconSpot}>
              <Icon name="camera" size={20} color="#fff" />
            </TouchableOpacity>
            {spotImage && (
              <TouchableOpacity
                onPress={() => setSpotImage(null)}
                style={styles.removeMainImageButton}
              >
                <Text style={styles.removeMainImageButtonText}>{t('common.remove')}</Text>
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.tipsLinkContainer}
          onPress={() => setShowTipsModal(true)}
          activeOpacity={0.7}
        >
          <Text style={styles.tipsLinkText}>{t('addSpot.tipsLink')}</Text>
        </TouchableOpacity>
        <Text style={styles.label}>{t('addSpot.namePlaceholder')}</Text>
        <TextInput style={styles.input} value={spotName} onChangeText={setSpotName} placeholder={t('addSpot.namePlaceholder')} />
        <Text style={styles.explanationText}>{t('addSpot.nameExplanation')}</Text>

        <Text style={styles.label}>{t('addSpot.descriptionPlaceholder')}</Text>
        <TextInput style={[styles.input, styles.bioInput]} value={spotDescription} onChangeText={setSpotDescription} placeholder={t('addSpot.descriptionPlaceholder')} multiline numberOfLines={4} />

        <View style={styles.sectionContainer}>
          <Text style={styles.label}>{t('addSpot.galleryTitle')}</Text>
          <ScrollView horizontal style={styles.galleryContainer}>
            <TouchableOpacity style={styles.addButton} onPress={handleChooseGallery}>
              <Icon name="camera" size={24} color="#888" />
              <Text style={styles.addButtonText}>{t('addSpot.galleryButton')}</Text>
            </TouchableOpacity>
            {galleryImages.map((uri, index) => (
              <View key={index} style={styles.thumbnailContainer}>
                <Image source={{ uri }} style={styles.thumbnail} />
                <TouchableOpacity onPress={() => removeGalleryImage(uri)} style={styles.removeButton}><Text style={styles.removeButtonText}>{t('common.remove')}</Text></TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.sectionContainer}>
          <Text style={styles.label}>{t('addSpot.videoTitle')}</Text>
          <Text style={styles.explanationText}>
            {t('addSpot.videoExplanation', {
              maxDuration: VIDEO_LIMITS.maxDurationSeconds,
              maxSize: VIDEO_LIMITS.maxSizeMB,
              compressionThreshold: VIDEO_LIMITS.compressionThresholdMB,
            })}
          </Text>
          <TouchableOpacity style={styles.addButton} onPress={handleChooseVideo} disabled={compressingVideo}>
            {compressingVideo ? (
              <>
                <ActivityIndicator size="small" />
                <Text style={styles.addButtonText}>{t('addSpot.compressingVideo')}</Text>
              </>
            ) : videoUri ? (
              <Text style={styles.addButtonText}>{t('addSpot.videoSelected')}</Text>
            ) : (
              <>
                <Icon name="video-camera" size={24} color="#888" />
                <Text style={styles.addButtonText}>{t('addSpot.addVideoButton')}</Text>
              </>
            )}
          </TouchableOpacity>
          {videoUri && !compressingVideo && (
            <TouchableOpacity
              style={styles.removeVideoButton}
              onPress={() => setVideoUri(null)}
            >
              <Text style={styles.removeVideoButtonText}>{t('common.remove')}</Text>
            </TouchableOpacity>
          )}
        </View>

        <Text style={styles.label}>{t('addSpot.addressPlaceholder')}</Text>
        {geocodingLoading ? <ActivityIndicator size="small" color="#0000ff" style={styles.loadingIndicator} /> : <TextInput style={styles.input} value={spotAddress} editable={false} placeholder={t('addSpot.addressPlaceholder')} />}
        <Text style={styles.label}>{t('addSpot.coordinatesLabel')}</Text>
        <Text style={styles.input}>{coordinate ? `${coordinate.latitude.toFixed(4)}, ${coordinate.longitude.toFixed(4)}` : t('common.na')}</Text>

        <View style={styles.sectionContainer}>
          <Text style={styles.label}>{t('addSpot.airSafetyLabel')}</Text>
          <Text style={styles.explanationText}>{t('addSpot.enaireExplanation')}</Text>
          <Button title={t('addSpot.openEnaireButton')} onPress={() => Linking.openURL('https://drones.enaire.es/')} />
        </View>

        <View style={styles.sectionContainer}>
          <Text style={styles.label}>{t('addSpot.flightStylesLabel')}</Text>
          <View style={styles.flightStylesContainer}>
            {flightStylesOptions.map(style => (
              <View key={style} style={styles.checkboxContainer}>
                <CheckBox
                  value={flightStyles.includes(style)}
                  onValue-Change={() => handleToggleStyle(style)}
                  tintColors={{ true: '#007BFF', false: '#ccc' }}
                />
                <Text 
                  style={styles.checkboxLabel} 
                  onPress={() => handleToggleStyle(style)}
                >
                  {t(`flightStyles.${style}`)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Button title={t(isEditing ? 'addSpot.updateButton' : 'addSpot.saveButton')} onPress={handleSaveSpot} />

        {isEditing && spot && currentUser && spot.createdBy === currentUser.uid && (
          <View style={styles.deleteButtonContainer}><Button title={t('spotDetail.deleteSpotButton')} onPress={handleDeleteSpot} color="#dc3545" /></View>
        )}
      </ScrollView>
      <Modal
        visible={showTipsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTipsModal(false)}
      >
        <View style={styles.tipsModalOverlay}>
          <View style={styles.tipsModalContent}>
            <Text style={styles.tipsModalTitle}>{t('addSpot.tipsTitle')}</Text>
            <Text style={styles.tipsModalText}>{t('addSpot.tipsBody')}</Text>
            <Button title={t('common.ok')} onPress={() => setShowTipsModal(false)} />
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    padding: 16,
    paddingTop: 50, // Añadir padding superior para dejar espacio al botón de cerrar
    paddingBottom: 100,
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
    zIndex: 10,
  },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 16, textAlign: 'center' },
  loadingProgressBar: {
    marginTop: 12,
    width: '80%',
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  loadingProgressFill: {
    height: '100%',
    backgroundColor: '#007BFF',
  },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 24 },
  label: { fontSize: 16, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  input: { borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 12, paddingHorizontal: 8, color: 'black' },
  bioInput: { height: 100, textAlignVertical: 'top' },
  explanationText: { fontSize: 12, color: 'gray', marginBottom: 12, textAlign: 'center' },
  imageHeader: { marginBottom: 24 },
  spotImageContainer: {
    width: '100%',
    height: 220,
    backgroundColor: '#f0f0f0',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  spotImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  spotImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  spotImagePlaceholderText: {
    color: '#666',
    fontSize: 16,
    marginTop: 8,
  },
  removeMainImageButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  removeMainImageButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  cameraIconSpot: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 10,
    borderRadius: 24,
  },
  loadingIndicator: { marginTop: 10, marginBottom: 10 },
  deleteButtonContainer: { marginTop: 20, marginBottom: 20 },
  sectionContainer: { marginVertical: 16 },
  galleryContainer: { marginTop: 10 },
  thumbnailContainer: { position: 'relative', marginRight: 10 },
  thumbnail: { width: 100, height: 100, borderRadius: 8 },
  removeButton: { position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  removeButtonText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  videoText: { marginTop: 10, fontStyle: 'italic', textAlign: 'center' },
  removeVideoButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f44336',
    borderRadius: 16,
  },
  removeVideoButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  tipsLinkContainer: { alignSelf: 'stretch', marginBottom: 4 },
  tipsLinkText: { color: '#007BFF', textDecorationLine: 'underline', fontSize: 15, textAlign: 'left', flex: 1 },
  tipsModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  tipsModalContent: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20, gap: 16 },
  tipsModalTitle: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  tipsModalText: { fontSize: 15, lineHeight: 22, color: '#333' },
  addButton: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#ccc',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    padding: 5,
  },
  addButtonText: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 5,
  },
  flightStylesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%', // Para crear dos columnas
    marginBottom: 10,
  },
  checkboxLabel: {
    marginLeft: 8,
    fontSize: 16,
    flex: 1,
  },
});

export default AddSpotScreen;
