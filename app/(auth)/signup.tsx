import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, ImageBackground, Linking, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { authInstance as auth } from '../../src/firebaseConfig';
import { createUserWithEmailAndPassword } from '@react-native-firebase/auth';
import { saveUserProfile } from '../../src/services/firestoreService';
import { uploadImage } from '../../src/services/storageService';
import ImagePicker from 'react-native-image-crop-picker';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import LanguageSelector from '../components/LanguageSelector';
import { useTranslation } from 'react-i18next';
import Toast from 'react-native-toast-message';

import { flightStylesOptions } from '../../src/constants/flightStyles';

const SignupScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [cityRegion, setCityRegion] = useState('');
  const [pilotTypes, setPilotTypes] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  
  // Estado para todas las redes sociales
  const [youtube, setYoutube] = useState('');
  const [instagram, setInstagram] = useState('');
  const [facebook, setFacebook] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [website, setWebsite] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [profilePictureUri, setProfilePictureUri] = useState<string | null>(null);
  const [backgroundPictureUri, setBackgroundPictureUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const handleSignUp = async () => {
    if (!email || !displayName || !password || !confirmPassword) {
      Toast.show({ type: 'info', text1: t('alerts.attention'), text2: t('signup.fillRequiredFields') });
      return;
    }
    if (password !== confirmPassword) {
      Toast.show({ type: 'error', text1: t('signup.passwordsDoNotMatch') });
      return;
    }
    setLoading(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      let profilePictureUrl = '';
      if (profilePictureUri) {
        profilePictureUrl = await uploadImage(profilePictureUri, `profile_pictures/${user.uid}.jpg`);
      }

      let backgroundPictureUrl = '';
      if (backgroundPictureUri) {
        backgroundPictureUrl = await uploadImage(backgroundPictureUri, `background_pictures/${user.uid}.jpg`);
      }

      const normalizedPilotTypes = Array.from(new Set(pilotTypes));

      await saveUserProfile(user.uid, {
        displayName,
        pilotType: normalizedPilotTypes[0] || null,
        pilotTypes: normalizedPilotTypes,
        bio,
        cityRegion,
        socials: { youtube, instagram, facebook, linkedin, website, whatsapp, email: contactEmail },
        profilePictureUrl,
        backgroundPictureUrl,
        flightStyles: selectedStyles,
      });

    } catch (error: any) {
      Toast.show({ type: 'error', text1: t('alerts.signupError') });
    } finally {
      setLoading(false);
    }
  };

  const handleChooseImage = (type: 'profile' | 'background') => {
    const pickerOptions = {
      width: type === 'background' ? 1200 : 400,
      height: type === 'background' ? 600 : 400,
      cropping: true,
      cropperCircleOverlay: type === 'profile',
      compressImageQuality: 0.8,
      mediaType: 'photo' as const,
    };

    const applyPath = (path: string) => {
      if (type === 'profile') {
        setProfilePictureUri(path);
      } else {
        setBackgroundPictureUri(path);
      }
    };

    const handlePicker = (image: { path: string }) => {
      if (image?.path) {
        applyPath(image.path);
      }
    };

    const handleError = (error: any) => {
      if (error?.code !== 'E_PICKER_CANCELLED') {
        console.log(error);
        Toast.show({
          type: 'error',
          text1: t('alerts.error'),
          text2: t('alerts.imagePickerError'),
        });
      }
    };

    Alert.alert(
      t('common.chooseImageSource'),
      '',
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.imageSourceCamera'),
          onPress: () => ImagePicker.openCamera(pickerOptions).then(handlePicker).catch(handleError),
        },
        {
          text: t('common.imageSourceGallery'),
          onPress: () => ImagePicker.openPicker(pickerOptions).then(handlePicker).catch(handleError),
        },
      ],
      { cancelable: true },
    );
  };

  const togglePilotType = (type: string) => {
    setPilotTypes(prev => (prev.includes(type) ? prev.filter(item => item !== type) : [...prev, type]));
  };

  const toggleStyle = (style: string) => {
    setSelectedStyles(prev => prev.includes(style) ? prev.filter(s => s !== style) : [...prev, style]);
  };

  const showLegal = async (type: 'terms' | 'privacy') => {
    const url =
      type === 'terms'
        ? 'https://orbitadrone.com/terminos-condiciones-app'
        : 'https://orbitadrone.com/politica-privacidad-app';
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        throw new Error('URL not supported');
      }
    } catch (error) {
      console.error('[Legal] Failed to open legal URL', error);
      Toast.show({ type: 'error', text1: t('alerts.error') });
    }
  };

  const legalTemplate = t('signup.legalTextWithLinks');
  const legalParts = legalTemplate.split('{termsLink}');
  const legalPrefix = legalParts[0] ?? '';
  const privacyPart = legalParts[1] ?? '';
  const privacyParts = privacyPart.split('{privacyLink}');
  const legalMiddle = privacyParts[0] ?? '';
  const legalSuffix = privacyParts[1] ?? '';

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-left" size={24} color="#000" />
      </TouchableOpacity>
      <Text style={styles.title}>{t('signup.title')}</Text>

      <View style={styles.profileHeader}>
        <TouchableOpacity style={{ width: '100%' }} onPress={() => handleChooseImage('background')}>
          <ImageBackground style={styles.backgroundImage} source={backgroundPictureUri ? { uri: backgroundPictureUri } : null} resizeMode="cover">
            {!backgroundPictureUri && <Text style={styles.placeholderText}>{t('signup.addBackgroundPhoto')}</Text>}
          </ImageBackground>
        </TouchableOpacity>
        <View style={styles.profilePictureWrapper}>
          <TouchableOpacity style={styles.profilePictureTouchable} onPress={() => handleChooseImage('profile')}>
            {profilePictureUri ? <Image source={{ uri: profilePictureUri }} style={styles.profilePictureImage} /> : <View style={styles.profilePicturePlaceholder}><Icon name="camera-plus" size={30} color="#fff" /></View>}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.formContainer}>
        <Text style={styles.sectionTitle}>{t('signup.accessInfo')}</Text>
        <Text style={styles.label}>{t('signup.emailLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.emailPlaceholder')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Text style={styles.label}>{t('signup.displayNameLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.displayNamePlaceholder')} value={displayName} onChangeText={setDisplayName} />
        <Text style={styles.label}>{t('signup.passwordLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.passwordPlaceholder')} value={password} onChangeText={setPassword} secureTextEntry />
        <Text style={styles.label}>{t('signup.confirmPasswordLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.confirmPasswordPlaceholder')} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />

        <Text style={styles.sectionTitle}>{t('signup.pilotInfo')}</Text>
        <Text style={styles.label}>{t('signup.bioLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.bioPlaceholder')} value={bio} onChangeText={setBio} maxLength={100} multiline />
        <Text style={styles.label}>{t('signup.locationLabel')}</Text>
        <TextInput style={styles.input} placeholder={t('signup.locationPlaceholder')} value={cityRegion} onChangeText={setCityRegion} />

        <View style={styles.radioContainer}>
          {[
            { key: 'pilot', label: t('signup.pilotTypePilot') },
            { key: 'photographer', label: t('signup.pilotTypePhotographer') },
            { key: 'company', label: t('signup.pilotTypeCompany') },
          ].map(option => (
            <TouchableOpacity
              key={option.key}
              style={styles.radioButton}
              onPress={() => togglePilotType(option.key)}>
              <View style={styles.checkbox}>
                {pilotTypes.includes(option.key) && <View style={styles.checkboxChecked} />}
              </View>
              <Text style={styles.radioLabel}>{option.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('signup.flightStylesLabel')}</Text>
        <View style={styles.stylesContainer}>
          {flightStylesOptions.map(style => (
            <TouchableOpacity key={style} style={styles.checkboxContainer} onPress={() => toggleStyle(style)}>
              <View style={styles.checkbox}>{selectedStyles.includes(style) && <View style={styles.checkboxChecked} />}</View>
              <Text style={styles.checkboxLabel}>{t(`flightStyles.${style}`)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('signup.socialMediaLabel')}</Text>
        <View style={styles.socialInputContainer}><Icon name="youtube" size={20} color="#FF0000" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.youtubePlaceholder')} value={youtube} onChangeText={setYoutube} autoCapitalize="none" /></View>
        <View style={styles.socialInputContainer}><Icon name="instagram" size={20} color="#C13584" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.instagramPlaceholder')} value={instagram} onChangeText={setInstagram} autoCapitalize="none" /></View>
        <View style={styles.socialInputContainer}><Icon name="facebook" size={20} color="#4267B2" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.facebookPlaceholder')} value={facebook} onChangeText={setFacebook} autoCapitalize="none" /></View>
        <View style={styles.socialInputContainer}><Icon name="linkedin" size={20} color="#0077B5" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.linkedinPlaceholder')} value={linkedin} onChangeText={setLinkedin} autoCapitalize="none" /></View>
        <View style={styles.socialInputContainer}><Icon name="web" size={20} color="#000000" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.websitePlaceholder')} value={website} onChangeText={setWebsite} autoCapitalize="none" /></View>
        <View style={styles.socialInputContainer}><Icon name="whatsapp" size={20} color="#25D366" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.whatsappPlaceholder')} value={whatsapp} onChangeText={setWhatsapp} keyboardType="phone-pad" /></View>
        <View style={styles.socialInputContainer}><Icon name="at" size={20} color="#000000" style={styles.socialIcon} /><TextInput style={styles.socialInput} placeholder={t('signup.contactEmailPlaceholder')} value={contactEmail} onChangeText={setContactEmail} keyboardType="email-address" autoCapitalize="none" /></View>

        <View style={styles.legalContainer}>
          <Text style={styles.legalText}>
            {legalPrefix}
            <Text style={styles.linkText} onPress={() => showLegal('terms')}>
              {t('login.termsLink')}
            </Text>
            {legalMiddle}
            <Text style={styles.linkText} onPress={() => showLegal('privacy')}>
              {t('login.privacyLink')}
            </Text>
            {legalSuffix}
          </Text>
        </View>
        {loading ? <ActivityIndicator size="large" color="#0000ff" /> : <Button title={t('signup.signupButton')} onPress={handleSignUp} />}
      </View>

      <LanguageSelector />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  backButton: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, alignSelf: 'flex-start' },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center', paddingHorizontal: 20, paddingTop: 20 },
  profileHeader: { marginBottom: 60, width: '100%' },
  backgroundImage: { width: '100%', height: 150, backgroundColor: '#f0f0f0', justifyContent: 'center', alignItems: 'center' },
  placeholderText: { color: '#888', flex: 1, textAlign: 'center' },
  profilePictureWrapper: { position: 'absolute', top: 100, alignSelf: 'center' },
  profilePictureTouchable: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#ccc', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#fff' },
  profilePictureImage: { width: '100%', height: '100%', borderRadius: 50 },
  profilePicturePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  formContainer: { paddingHorizontal: 20 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', marginTop: 20, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: '#eee', paddingBottom: 5 },
  label: { fontSize: 16, fontWeight: 'bold', marginTop: 10, marginBottom: 5 },
  input: { height: 40, borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 12, paddingHorizontal: 8, color: '#000' },
  socialInputContainer: { flexDirection: 'row', alignItems: 'center', borderColor: 'gray', borderWidth: 1, borderRadius: 5, marginBottom: 12, paddingHorizontal: 8 },
  socialIcon: { marginRight: 10 },
  socialInput: { flex: 1, height: 40, color: '#000' },
  radioContainer: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 20 },
  radioButton: { flexDirection: 'row', alignItems: 'center', width: '48%', marginBottom: 8 },
  radioLabel: { fontSize: 16, flex: 1, flexWrap: 'wrap' },
  stylesContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 10 },
  checkboxContainer: { flexDirection: 'row', alignItems: 'center', width: '48%', marginBottom: 10 },
  checkbox: { height: 20, width: 20, borderRadius: 3, borderWidth: 1, borderColor: '#000', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  checkboxChecked: { width: 12, height: 12, backgroundColor: '#000' },
  checkboxLabel: { fontSize: 16, flex: 1 },
  legalContainer: { marginVertical: 15 },
  legalText: { textAlign: 'center', color: 'gray', fontSize: 12 },
  linkText: { color: '#007BFF', textDecorationLine: 'underline' },
});

export default SignupScreen;
