import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Button,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  TouchableOpacity,
  ImageBackground,
  Modal,
  Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import {
  getUserProfile,
  saveUserProfile,
  deleteUserAccount,
  UserProfile,
  setPilotMarker,
  clearPilotMarker,
  PilotMarkerPayload,
} from '../../src/services/firestoreService';
import { auth } from '../../src/firebaseConfig';
import { uploadImage } from '../../src/services/storageService';
import ImagePicker from 'react-native-image-crop-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { sendPasswordResetEmail, signOut, EmailAuthProvider } from '@react-native-firebase/auth';
import LanguageSelector from '../components/LanguageSelector';
import Purchases from 'react-native-purchases';
import Toast from 'react-native-toast-message';

import { flightStylesOptions } from '../../src/constants/flightStyles';

import RemoveAdsModal from '../components/RemoveAdsModal';
import { useAuthContext } from '../context/AuthContext';
import { useAds } from '../context/AdContext';
import { adManager } from '../../src/services/adManager';
import MapView, { Marker, MapPressEvent, Region } from 'react-native-maps';
import Geolocation from '@react-native-community/geolocation';
import { requestLocationPermission } from '../../src/utils/permissions';
import { geocode } from '../../src/utils/geocoding';

const pilotTypeCanonicalMap: Record<string, string> = {
  piloto: 'pilot',
  pilot: 'pilot',
  empresa: 'company',
  company: 'company',
  fotografo: 'photographer',
  'fotógrafo': 'photographer',
  photographer: 'photographer',
};

const pilotTypeOptions = [
  { key: 'pilot', labelKey: 'profile.pilotTypePilot' },
  { key: 'photographer', labelKey: 'profile.pilotTypePhotographer' },
  { key: 'company', labelKey: 'profile.pilotTypeCompany' },
];

const canonicalizePilotType = (value?: string | null): string | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const mapped = pilotTypeCanonicalMap[trimmed.toLowerCase()];
  return mapped || trimmed;
};

const normalizePilotTypes = (profile?: { pilotType?: string | string[] | null; pilotTypes?: string[] | null } | null): string[] => {
  const result = new Set<string>();
  const addFromSource = (source?: string | string[] | null) => {
    if (!source) {
      return;
    }
    if (Array.isArray(source)) {
      source.forEach(item => addFromSource(item));
      return;
    }
    const canonical = canonicalizePilotType(source);
    if (canonical) {
      result.add(canonical);
    }
  };

  if (profile) {
    addFromSource(profile.pilotTypes);
    addFromSource(profile.pilotType);
  }

  return Array.from(result);
};

const DEFAULT_MODAL_REGION: Region = {
  latitude: 41.3851,
  longitude: 2.1734,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

const ProfileScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  
  const { user } = useAuthContext();
  const { disableAdsForSession } = useAds();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [profile, setProfile] = useState<Partial<UserProfile>>({});
  const [isPilotMarkerModalVisible, setPilotMarkerModalVisible] = useState(false);
  const [pilotMarkerDraft, setPilotMarkerDraft] = useState<PilotMarkerPayload | null>(null);
  const [pilotMarkerMapRegion, setPilotMarkerMapRegion] = useState<Region>(DEFAULT_MODAL_REGION);
  const [pilotMarkerModalKey, setPilotMarkerModalKey] = useState(0);
  const [pilotMarkerSaving, setPilotMarkerSaving] = useState(false);
  const pilotMarkerMapRef = useRef<MapView | null>(null);
  
  const [isDeleteModalVisible, setDeleteModalVisible] = useState(false);
  const [isCancelSubscriptionModalVisible, setCancelSubscriptionModalVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);
  const [isRemoveAdsModalVisible, setRemoveAdsModalVisible] = useState(false);

  useEffect(() => {
    if (user) {
      fetchProfile(user.uid);
    } else {
      setLoading(false);
    }
  }, [user, fetchProfile]);

  const fetchProfile = useCallback(async (uid: string) => {
    setLoading(true);
    try {
      const fetchedProfile = await getUserProfile(uid);
      if (fetchedProfile) {
        const normalizedPilotTypes = normalizePilotTypes(fetchedProfile);
        setProfile({
          ...fetchedProfile,
          pilotType: normalizedPilotTypes[0],
          pilotTypes: normalizedPilotTypes,
        });
      } else {
        setProfile({});
      }
    } catch (error) {
      console.error("Error fetching profile: ", error);
      Alert.alert(t('alerts.error'), t('alerts.fetchProfileError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const handleChoosePhoto = (type: 'profile' | 'background') => {
    const pickerOptions = {
      cropping: true,
      width: type === 'profile' ? 400 : 1200,
      height: type === 'profile' ? 400 : 600,
      cropperCircleOverlay: type === 'profile',
      compressImageQuality: 0.8,
      mediaType: 'photo' as const,
    };

    const applyImage = (uri: string) => {
      if (type === 'profile') {
        setProfile(p => ({ ...p, profilePictureUrl: uri }));
      } else {
        setProfile(p => ({ ...p, backgroundPictureUrl: uri }));
      }
    };

    const handlePickerResult = (image: { path: string }) => {
      const uri = image?.path;
      if (uri) {
        applyImage(uri);
      }
    };

    const handleError = (error: any) => {
      if (error?.code !== 'E_PICKER_CANCELLED') {
        Alert.alert(t('alerts.error'), t('alerts.imagePickerError'));
      }
    };

    Alert.alert(
      t('common.chooseImageSource'),
      '',
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
        },
        {
          text: t('common.imageSourceCamera'),
          onPress: () => {
            ImagePicker.openCamera(pickerOptions).then(handlePickerResult).catch(handleError);
          },
        },
        {
          text: t('common.imageSourceGallery'),
          onPress: () => {
            ImagePicker.openPicker(pickerOptions).then(handlePickerResult).catch(handleError);
          },
        },
      ],
      { cancelable: true },
    );
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      let profilePictureUrl = profile.profilePictureUrl;
      if (profilePictureUrl && !profilePictureUrl.startsWith('http')) {
        profilePictureUrl = await uploadImage(profilePictureUrl, `profile_pictures/${user.uid}/profile.jpg`);
      }

      let backgroundPictureUrl = profile.backgroundPictureUrl;
      if (backgroundPictureUrl && !backgroundPictureUrl.startsWith('http')) {
        backgroundPictureUrl = await uploadImage(backgroundPictureUrl, `background_pictures/${user.uid}/background.jpg`);
      }

      const pilotTypes = normalizePilotTypes(profile);

      const profileDataToSave = {
        displayName: profile.displayName || null,
        pilotType: pilotTypes[0] || null,
        pilotTypes,
        bio: profile.bio || null,
        cityRegion: profile.cityRegion || null,
        flightStyles: profile.flightStyles || [],
        socials: {
          youtube: profile.socials?.youtube || null,
          instagram: profile.socials?.instagram || null,
          facebook: profile.socials?.facebook || null,
          linkedin: profile.socials?.linkedin || null,
          website: profile.socials?.website || null,
          whatsapp: profile.socials?.whatsapp || null,
          email: profile.socials?.email || null,
        },
        profilePictureUrl: profilePictureUrl || null,
        backgroundPictureUrl: backgroundPictureUrl || null,
      };

      await saveUserProfile(user.uid, profileDataToSave);
      Alert.alert(t('alerts.success'), t('alerts.profileSaved'));
    } catch (error) {
      console.error("Error saving profile:", error);
      Alert.alert(t('alerts.error'), t('alerts.saveProfileError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordReset = async () => {
    if (user && user.email) {
      try {
        await sendPasswordResetEmail(auth, user.email);
        Alert.alert(t('alerts.passwordResetEmailSentTitle'), t('alerts.passwordResetEmailSentMessage', { email: user.email }));
      } catch (error: any) {
        Alert.alert(t('alerts.error'), t('alerts.passwordResetError'));
      }
    }
  };

  const handleLogout = () => {
    signOut(auth).catch(error => Alert.alert(t('alerts.error'), t('alerts.logoutError')));
  };

  const openCancelSubscriptionModal = () => {
    setPassword('');
    setCancelSubscriptionModalVisible(true);
  };

  const handleManageSubscription = async () => {
    try {
      await Purchases.manageSubscriptions();
      setCancelSubscriptionModalVisible(false);
    } catch (error) {
      console.error('[Profile] manageSubscriptions failed', error);
      Alert.alert(t('alerts.error'), t('alerts.manageSubscriptionError'));
    }
  };

  const handleDeleteAccountPress = () => {
    setDeleteModalVisible(true);
  };

  const handleReauthenticateAndDelete = async () => {
    if (!user || !password) {
      Alert.alert(t('alerts.attention'), t('alerts.enterPasswordPrompt'));
      return;
    }
    setReauthLoading(true);
    try {
      const credential = EmailAuthProvider.credential(user.email!, password);
      await user.reauthenticateWithCredential(credential);
      
      await deleteUserAccount(user.uid);
      setDeleteModalVisible(false);
      Alert.alert(t('alerts.accountDeletedSuccessTitle'), t('alerts.accountDeletedSuccessMessage'));
    } catch (error: any) {
      if (error.code === 'auth/wrong-password') Alert.alert(t('alerts.error'), t('alerts.wrongPasswordError'));
      else Alert.alert(t('alerts.error'), t('alerts.reauthFailedError'));
      console.error(error);
    } finally {
      setReauthLoading(false);
      setPassword('');
    }
  };

  const togglePilotType = (type: string) => {
    setProfile(p => {
      const current = Array.isArray(p.pilotTypes) ? p.pilotTypes : [];
      const exists = current.includes(type);
      const next = exists ? current.filter(item => item !== type) : [...current, type];
      return { ...p, pilotTypes: next, pilotType: next[0] };
    });
  };

  const toggleStyle = (style: string) => {
    const currentStyles = profile.flightStyles || [];
    const newStyles = currentStyles.includes(style) ? currentStyles.filter(s => s !== style) : [...currentStyles, style];
    setProfile(p => ({ ...p, flightStyles: newStyles }));
  };

  const updateSocial = (platform: string, value: string) => {
    setProfile(p => ({ ...p, socials: { ...p.socials, [platform]: value } }));
  };

  const handleClearPilotMarker = async () => {
    if (!user) return;
    try {
      await clearPilotMarker(user.uid);
      setProfile(p => ({ ...p, pilotMarker: undefined }));
    } catch (error) {
      console.error('[Profile] clearPilotMarker failed', error);
      Alert.alert(t('alerts.error'), t('alerts.error'));
    }
  };

  const openPilotMarkerModal = () => {
    const current = profile.pilotMarker;
    const region = current
      ? {
          latitude: current.latitude,
          longitude: current.longitude,
          latitudeDelta: 0.1,
          longitudeDelta: 0.1,
        }
      : DEFAULT_MODAL_REGION;
    setPilotMarkerMapRegion(region);
    setPilotMarkerModalKey(prev => prev + 1);
    setPilotMarkerDraft({
      latitude: region.latitude,
      longitude: region.longitude,
    });
    setPilotMarkerModalVisible(true);
  };

  const closePilotMarkerModal = () => {
    setPilotMarkerModalVisible(false);
  };

  const handleModalMapPress = (event: MapPressEvent) => {
    const { latitude, longitude } = event.nativeEvent.coordinate;
    setPilotMarkerDraft({ latitude, longitude });
    pilotMarkerMapRef.current?.animateToRegion(
      {
        latitude,
        longitude,
        latitudeDelta: pilotMarkerMapRegion.latitudeDelta,
        longitudeDelta: pilotMarkerMapRegion.longitudeDelta,
      },
      300,
    );
  };

  const handleUseCurrentLocation = async () => {
    if (!user) return;
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert(t('alerts.locationPermissionDenied'), t('alerts.locationPermissionDeniedMessage'));
      return;
    }
    Geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        const newRegion = {
          latitude,
          longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setPilotMarkerMapRegion(newRegion);
        pilotMarkerMapRef.current?.animateToRegion(newRegion, 400);
        setPilotMarkerDraft({ latitude, longitude });
        setPilotMarkerModalKey(prev => prev + 1);
      },
      error => {
        console.error('[Profile] current location failed', error);
        Alert.alert(t('alerts.error'), t('alerts.locationError'));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 1000 },
    );
  };

  const handleSavePilotMarker = async () => {
    if (!user) return;
    if (!pilotMarkerDraft) {
      Alert.alert(t('alerts.error'), t('profile.pilotMarkerNeedsLocation'));
      return;
    }
    setPilotMarkerSaving(true);
    let formattedAddress: string | null = null;
    try {
      const result = await geocode(pilotMarkerDraft.latitude, pilotMarkerDraft.longitude);
      formattedAddress = result?.formatted_address ?? null;
    } catch (error) {
      console.warn('[Profile] geocode failed', error);
    }
    try {
      await setPilotMarker(user.uid, pilotMarkerDraft);
      setProfile(p => ({
        ...p,
        pilotMarker: pilotMarkerDraft,
        cityRegion: formattedAddress ?? p.cityRegion,
      }));
      Toast.show({
        type: 'success',
        text1: t('profile.pilotMarkerSavedTitle'),
        text2: t('profile.pilotMarkerSavedMessage'),
      });
      if (formattedAddress) {
        await saveUserProfile(user.uid, { cityRegion: formattedAddress });
      }
      setPilotMarkerModalVisible(false);
      await fetchProfile(user.uid);
    } catch (error) {
      console.error('[Profile] setPilotMarker failed', error);
      Alert.alert(t('alerts.error'), t('alerts.error'));
    } finally {
      setPilotMarkerSaving(false);
    }
  };

  if (loading) return <View style={styles.loadingContainer}><ActivityIndicator size="large" /><Text>{t('common.loading')}</Text></View>;
  if (!user) return <View style={styles.container}><Text>{t('profile.notLoggedInProfile')}</Text></View>;

  const selectedPilotTypes = Array.isArray(profile.pilotTypes) ? profile.pilotTypes : [];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>{t('profile.title')}</Text>

      <View style={styles.profileHeader}>
        <TouchableOpacity style={{ width: '100%' }} onPress={() => handleChoosePhoto('background')}>
          <ImageBackground style={styles.backgroundImage} source={profile.backgroundPictureUrl ? { uri: profile.backgroundPictureUrl } : null} resizeMode="cover">
            {!profile.backgroundPictureUrl && <Text style={styles.placeholderText}>{t('profile.addBackgroundPhoto')}</Text>}
          </ImageBackground>
        </TouchableOpacity>
        <View style={styles.profilePictureWrapper}>
          <TouchableOpacity style={styles.profilePictureTouchable} onPress={() => handleChoosePhoto('profile')}>
            {profile.profilePictureUrl ? <Image source={{ uri: profile.profilePictureUrl }} style={styles.profilePictureImage} /> : <View style={styles.profilePicturePlaceholder}><Icon name="camera-plus" size={30} color="#fff" /></View>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.formContainer}>
        <View style={{marginBottom: 10}}>
          <Button title={t('profile.viewPublicProfileButton')} onPress={() => navigation.navigate('UserProfile' as never, { userId: user.uid } as never)} />
        </View>
        <Button title={t('profile.mySpotsButton')} onPress={() => navigation.navigate('MySpots')} />

        <Text style={styles.label}>{t('profile.displayNameLabel')}</Text>
        <TextInput style={styles.input} value={profile.displayName} onChangeText={text => setProfile(p => ({ ...p, displayName: text }))} placeholder={t('profile.displayNamePlaceholder')} />
        <Text style={styles.label}>{t('profile.cityRegionLabel')}</Text>
        <TextInput style={styles.input} value={profile.cityRegion} onChangeText={text => setProfile(p => ({ ...p, cityRegion: text }))} placeholder={t('profile.cityRegionPlaceholder')} />
        <View style={styles.pilotMarkerSection}>
          <Text style={styles.sectionHeading}>{t('profile.pilotMarkerSectionTitle')}</Text>
          <Text style={styles.pilotMarkerInfo}>
            {profile.pilotMarker
              ? t('profile.pilotMarkerVisibleAt', {
                  lat: profile.pilotMarker.latitude.toFixed(4),
                  lng: profile.pilotMarker.longitude.toFixed(4),
                })
              : t('profile.pilotMarkerNotSet')}
          </Text>
          <View style={styles.pilotMarkerActionRow}>
            <TouchableOpacity style={styles.pilotMarkerButton} onPress={openPilotMarkerModal}>
              <Text style={styles.pilotMarkerButtonText}>
                {profile.pilotMarker
                  ? t('profile.pilotMarkerUpdateButton')
                  : t('profile.pilotMarkerSetButton')}
              </Text>
            </TouchableOpacity>
            {profile.pilotMarker && (
              <TouchableOpacity
                style={[styles.pilotMarkerButton, styles.pilotMarkerButtonDestructive]}
                onPress={handleClearPilotMarker}>
                <Text style={[styles.pilotMarkerButtonText, styles.pilotMarkerButtonDestructiveText]}>
                  {t('profile.pilotMarkerClearButton')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        <Text style={styles.label}>{t('profile.pilotTypeLabel')}</Text>
        <View style={styles.radioContainer}>
          {pilotTypeOptions.map(option => (
            <TouchableOpacity
              key={option.key}
              style={styles.radioButton}
              onPress={() => togglePilotType(option.key)}>
              <View style={styles.checkbox}>
                {selectedPilotTypes.includes(option.key) && <View style={styles.checkboxChecked} />}
              </View>
              <Text style={styles.radioText}>{t(option.labelKey)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>{t('profile.flightStylesLabel')}</Text>
        <View style={styles.stylesContainer}>
          {flightStylesOptions.map(style => (
            <TouchableOpacity key={style} style={styles.checkboxContainer} onPress={() => toggleStyle(style)}>
              <View style={styles.checkbox}>{(profile.flightStyles || []).includes(style) && <View style={styles.checkboxChecked} />}</View>
              <Text style={styles.checkboxLabel}>{t(`flightStyles.${style}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>{t('profile.bioLabel')}</Text>
        <TextInput style={[styles.input, styles.bioInput]} value={profile.bio} onChangeText={text => setProfile(p => ({ ...p, bio: text }))} placeholder={t('profile.bioPlaceholder')} multiline />
        <Text style={styles.label}>{t('profile.socials')}</Text>
        <View style={styles.socialInputContainer}>
          <Icon name="youtube" size={20} color="#FF0000" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.youtube || ''} onChangeText={text => updateSocial('youtube', text)} placeholder={t('profile.youtubePlaceholder')} />
        </View>
        <View style={styles.socialInputContainer}>
          <Icon name="instagram" size={20} color="#C13584" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.instagram || ''} onChangeText={text => updateSocial('instagram', text)} placeholder={t('profile.instagramPlaceholder')} />
        </View>
        <View style={styles.socialInputContainer}>
          <Icon name="facebook" size={20} color="#4267B2" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.facebook || ''} onChangeText={text => updateSocial('facebook', text)} placeholder={t('profile.facebookPlaceholder')} />
        </View>
        <View style={styles.socialInputContainer}>
          <Icon name="linkedin" size={20} color="#0077B5" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.linkedin || ''} onChangeText={text => updateSocial('linkedin', text)} placeholder={t('profile.linkedinPlaceholder')} />
        </View>
        <View style={styles.socialInputContainer}>
          <Icon name="web" size={20} color="#000000" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.website || ''} onChangeText={text => updateSocial('website', text)} placeholder={t('profile.websitePlaceholder')} />
        </View>

        <Text style={styles.label}>{t('profile.contact')}</Text>
        <View style={styles.socialInputContainer}>
          <Icon name="whatsapp" size={20} color="#25D366" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.whatsapp || ''} onChangeText={text => updateSocial('whatsapp', text)} placeholder={t('profile.whatsappPlaceholder')} keyboardType="phone-pad" />
        </View>
        <View style={styles.socialInputContainer}>
          <Icon name="at" size={20} color="#000000" style={styles.socialIcon} />
          <TextInput style={styles.socialInput} value={profile.socials?.email || ''} onChangeText={text => updateSocial('email', text)} placeholder={t('profile.contactEmailPlaceholder')} keyboardType="email-address" />
        </View>

        <Button title={t('profile.saveButton')} onPress={handleSaveProfile} disabled={saving} />
        {saving && <ActivityIndicator style={styles.activityIndicator} size="small" />}

        <View style={styles.actionsSection}>
          <LanguageSelector />
          <View style={styles.actionButtonContainer}>
            <Button title={t('removeAds.title')} color="#2ecc71" onPress={() => setRemoveAdsModalVisible(true)} />
          </View>
          <View style={styles.actionButtonContainer}>
            <Button title={t('profile.changePasswordButton')} color="#3498db" onPress={handlePasswordReset} />
          </View>
          <View style={styles.actionButtonContainer}>
            <Button title={t('profile.logoutButton')} color="orange" onPress={handleLogout} />
          </View>
          <View style={styles.accountSection}>
            <Text style={styles.sectionHeading}>{t('profile.accountSectionTitle')}</Text>
            <View style={styles.actionButtonContainer}>
            <TouchableOpacity
                style={[styles.subtleButton, styles.subtleButtonPrimary]}
                onPress={openCancelSubscriptionModal}
              >
                <Text style={[styles.subtleButtonText, styles.subtleButtonPrimaryText]}>
                  {t('profile.manageSubscriptionButton')}
                </Text>
              </TouchableOpacity>
            </View>
            <View style={styles.actionButtonContainer}>
              <TouchableOpacity
                style={[styles.subtleButton, styles.subtleButtonDanger]}
                onPress={handleDeleteAccountPress}
              >
                <Text style={[styles.subtleButtonText, styles.subtleButtonDangerText]}>
                  {t('profile.deleteAccountButton')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      <Modal animationType="slide" transparent={true} visible={isDeleteModalVisible} onRequestClose={() => setDeleteModalVisible(false)}>
        <View style={styles.centeredView}><View style={styles.modalView}><Text style={styles.modalTitle}>{t('profile.deleteModal.title')}</Text><Text style={styles.modalText}>{t('profile.deleteModal.message')}</Text><TextInput style={styles.modalInput} placeholder={t('profile.deleteModal.passwordPlaceholder')} value={password} onChangeText={setPassword} secureTextEntry /><View style={styles.modalButtonContainer}>{reauthLoading ? <ActivityIndicator size="large" /> : <><Pressable style={[styles.button, styles.buttonCancel]} onPress={() => setDeleteModalVisible(false)}><Text style={styles.textStyle}>{t('profile.deleteModal.cancelButton')}</Text></Pressable><Pressable style={[styles.button, styles.buttonConfirm]} onPress={handleReauthenticateAndDelete}><Text style={styles.textStyle}>{t('profile.deleteModal.confirmButton')}</Text></Pressable></>}</View></View></View>
      </Modal>

      <RemoveAdsModal 
        isVisible={isRemoveAdsModalVisible} 
        onClose={() => setRemoveAdsModalVisible(false)}
        onWatchAd={() => {
          setRemoveAdsModalVisible(false);
          adManager.showRewardedAd(
            () => {
              disableAdsForSession();
              Alert.alert(t('removeAds.rewardEarnedTitle'), t('removeAds.rewardEarnedMessage'));
            },
            () => {
              Alert.alert(t('alerts.error'), t('removeAds.rewardNotReady'));
            },
          );
        }}
      />
      <Modal
        animationType="slide"
        visible={isPilotMarkerModalVisible}
        onRequestClose={closePilotMarkerModal}
      >
        <View style={styles.pilotMarkerModalContainer}>
          <Text style={styles.modalTitle}>{t('profile.pilotMarkerModalTitle')}</Text>
          <Text style={styles.pilotMarkerModalSubtitle}>{t('profile.pilotMarkerModalInstructions')}</Text>
          <MapView
            style={styles.pilotMarkerModalMap}
            ref={pilotMarkerMapRef}
            initialRegion={pilotMarkerMapRegion}
            key={pilotMarkerModalKey}
            onPress={handleModalMapPress}
          >
            {pilotMarkerDraft && (
              <Marker
                coordinate={{
                  latitude: pilotMarkerDraft.latitude,
                  longitude: pilotMarkerDraft.longitude,
                }}
              />
            )}
          </MapView>
          <View style={styles.pilotMarkerModalControls}>
            <TouchableOpacity style={styles.pilotMarkerLink} onPress={handleUseCurrentLocation}>
              <Text style={styles.pilotMarkerLinkText}>{t('profile.pilotMarkerUseCurrentLocation')}</Text>
            </TouchableOpacity>
            <View style={styles.pilotMarkerModalActions}>
              <TouchableOpacity style={styles.pilotMarkerModalButton} onPress={closePilotMarkerModal}>
                <Text style={styles.pilotMarkerButtonText}>{t('profile.pilotMarkerCancelButton')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.pilotMarkerModalButton, styles.pilotMarkerModalButtonPrimary]}
                onPress={handleSavePilotMarker}
                disabled={pilotMarkerSaving}
              >
                {pilotMarkerSaving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.pilotMarkerButtonText}>{t('profile.pilotMarkerSaveButton')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal animationType="slide" transparent={true} visible={isCancelSubscriptionModalVisible} onRequestClose={() => setCancelSubscriptionModalVisible(false)}>
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <Text style={styles.modalTitle}>{t('profile.cancelSubscriptionModal.title')}</Text>
            <Text style={styles.modalText}>{t('profile.cancelSubscriptionModal.message')}</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={t('profile.cancelSubscriptionModal.passwordPlaceholder')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <View style={styles.modalButtonContainer}>
              {reauthLoading ? (
                <ActivityIndicator size="large" />
              ) : (
                <>
                  <Pressable
                    style={[styles.button, styles.buttonCancel]}
                    onPress={() => {
                      setCancelSubscriptionModalVisible(false);
                      setPassword('');
                    }}
                  >
                    <Text style={styles.textStyle}>{t('profile.cancelSubscriptionModal.cancelButton')}</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.button, styles.buttonConfirm]}
                    onPress={async () => {
                      if (!user || !password) {
                        Alert.alert(t('alerts.attention'), t('alerts.enterPasswordPrompt'));
                        return;
                      }
                      setReauthLoading(true);
                      try {
                        const credential = EmailAuthProvider.credential(user.email!, password);
                        await user.reauthenticateWithCredential(credential);
                        await handleManageSubscription();
                      } catch (error: any) {
                        if (error?.code === 'auth/wrong-password') {
                          Alert.alert(t('alerts.error'), t('alerts.wrongPasswordError'));
                        } else {
                          console.error('[Profile] Subscription reauth failed', error);
                          Alert.alert(t('alerts.error'), t('alerts.reauthFailedError'));
                        }
                      } finally {
                        setReauthLoading(false);
                        setPassword('');
                      }
                    }}
                  >
                    <Text style={styles.textStyle}>{t('profile.cancelSubscriptionModal.confirmButton')}</Text>
                  </Pressable>
                </>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', marginVertical: 20, textAlign: 'center' },
  profileHeader: { marginBottom: 60, width: '100%' },
  backgroundImage: { width: '100%', height: 150, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#888' },
  profilePictureWrapper: { position: 'absolute', top: 100, alignSelf: 'center' },
  profilePictureTouchable: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#fff' },
  profilePictureImage: { width: '100%', height: '100%', borderRadius: 50 },
  profilePicturePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  formContainer: { paddingHorizontal: 20 },
  label: { fontSize: 16, fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
  input: { height: 40, borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 12, paddingHorizontal: 8, color: '#000' },
  bioInput: { height: 100, textAlignVertical: 'top' },
  radioContainer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 },
  radioButton: { flexDirection: 'row', alignItems: 'center', width: '48%', marginBottom: 8 },
  radioText: { fontSize: 16, flex: 1, flexWrap: 'wrap' },
  socialInputContainer: { flexDirection: 'row', alignItems: 'center', borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 12, paddingHorizontal: 8 },
  socialIcon: { marginRight: 10 },
  socialInput: { flex: 1, height: 40, color: '#000' },
  actionsSection: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 10 },
  actionButtonContainer: {
    marginBottom: 10,
  },
  accountSection: { marginTop: 20 },
  sectionHeading: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  subtleButton: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  subtleButtonPrimary: {
    backgroundColor: '#e9e4f8',
  },
  subtleButtonDanger: {
    backgroundColor: '#fbe9e9',
  },
  subtleButtonText: {
    color: '#333',
    fontWeight: '600',
  },
  subtleButtonPrimaryText: {
    color: '#5a3db3',
  },
  subtleButtonDangerText: {
    color: '#c0392b',
  },
  stylesContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 20 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center', width: '48%', marginBottom: 10 },
  checkbox: { height: 20, width: 20, borderRadius: 3, borderWidth: 1, borderColor: '#000', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxChecked: { width: 12, height: 12, backgroundColor: '#000' },
  checkboxLabel: { fontSize: 14, flex: 1 },
  activityIndicator: { marginTop: 10 },
  centeredView: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalView: { margin: 20, backgroundColor: 'white', borderRadius: 20, padding: 35, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5, width: '90%' },
  modalTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  modalText: { marginBottom: 15, textAlign: 'center' },
  modalInput: { width: '100%', height: 40, borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 20, paddingHorizontal: 8, color: '#000' },
  modalButtonContainer: { flexDirection: 'row', justifyContent: 'space-between', width: '100%' },
  button: { borderRadius: 20, padding: 10, elevation: 2, width: '48%' },
  buttonCancel: { backgroundColor: '#888' },
  buttonConfirm: { backgroundColor: 'red' },
  textStyle: { color: 'white', fontWeight: 'bold', textAlign: 'center' },
  pilotMarkerSection: {
    marginTop: 24,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    backgroundColor: '#f9f9f9',
  },
  pilotMarkerInfo: {
    marginTop: 8,
    fontSize: 14,
    color: '#333',
  },
  pilotMarkerActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  pilotMarkerButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#007bff',
    alignItems: 'center',
    marginRight: 8,
  },
  pilotMarkerButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  pilotMarkerButtonDestructive: {
    backgroundColor: '#e53935',
  },
  pilotMarkerButtonDestructiveText: {
    color: '#fff',
  },
  pilotMarkerModalContainer: {
    flex: 1,
    paddingTop: 60,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  pilotMarkerModalSubtitle: {
    fontSize: 14,
    color: '#555',
    marginBottom: 12,
    textAlign: 'center',
  },
  pilotMarkerModalMap: {
    height: 250,
    borderRadius: 12,
    marginBottom: 16,
  },
  pilotMarkerModalControls: {
    flex: 1,
  },
  pilotMarkerLink: {
    marginBottom: 12,
  },
  pilotMarkerLinkText: {
    color: '#007bff',
    fontWeight: '600',
  },
  pilotMarkerModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  pilotMarkerModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#ccc',
    alignItems: 'center',
    marginRight: 8,
  },
  pilotMarkerModalButtonPrimary: {
    backgroundColor: '#007bff',
  },
});

export default ProfileScreen;
