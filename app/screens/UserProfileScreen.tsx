import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Image, TouchableOpacity, Linking, Alert, FlatList } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { getUserProfile, getSpotsByUserId, UserProfile, Spot } from '../../src/services/firestoreService';
import Icon from 'react-native-vector-icons/FontAwesome';

const pilotTypeCanonicalMap: Record<string, string> = {
  piloto: 'pilot',
  pilot: 'pilot',
  empresa: 'company',
  company: 'company',
  fotografo: 'photographer',
  'fotógrafo': 'photographer',
  photographer: 'photographer',
};

const pilotTypeTranslationKeys: Record<string, string> = {
  pilot: 'profile.pilotTypePilot',
  photographer: 'profile.pilotTypePhotographer',
  company: 'profile.pilotTypeCompany',
};

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

const UserProfileScreen = () => {
  const { t } = useTranslation();
  const route = useRoute();
  const navigation = useNavigation();
  const { userId } = route.params as { userId: string };
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [spots, setSpots] = useState<Spot[]>([]);

  useEffect(() => {
    const fetchUserProfileAndSpots = async () => {
      try {
        const fetchedProfile = await getUserProfile(userId);
        if (fetchedProfile) {
          setProfile(fetchedProfile);
        } else {
          Alert.alert(t('alerts.error'), t('alerts.fetchProfileError'));
        }

        const fetchedSpots = await getSpotsByUserId(userId);
        setSpots(fetchedSpots);

      } catch (error) {
        console.error("Error fetching user profile and spots: ", error);
        Alert.alert(t('alerts.error'), t('alerts.fetchProfileError'));
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfileAndSpots();
  }, [userId, t]);

  const handleLinkPress = async (url: string, type: 'web' | 'whatsapp' | 'email') => {
    let finalUrl = url;
    if (type === 'email') {
      finalUrl = `mailto:${url}`;
    } else if (type === 'whatsapp') {
      const cleanNumber = url.replace(/[^0-9]/g, '');
      finalUrl = `https://wa.me/${cleanNumber}`;
    } else if (!url.startsWith('http')) {
      finalUrl = `https://${url}`;
    }

    console.log('Attempting to open URL:', finalUrl);
    const supported = await Linking.canOpenURL(finalUrl);
    console.log('Is URL supported?', supported);

    if (supported) {
      await Linking.openURL(finalUrl);
    } else {
      Alert.alert(t('alerts.cannotOpenLink'));
    }
  };

  const renderSpotItem = ({ item }: { item: Spot }) => (
    <TouchableOpacity 
      style={styles.spotItem}
      onPress={() => navigation.navigate('SpotDetail' as never, { spotId: item.id } as never)}
    >
      <Text style={styles.spotName}>{item.name}</Text>
      <Text style={styles.spotDescription}>{item.description}</Text>
    </TouchableOpacity>
  );

  const getPilotInfo = () => {
    const pilotTypes = normalizePilotTypes(profile);

    const pilotTypeInfo = pilotTypes
      .map(type => {
        const translationKey = pilotTypeTranslationKeys[type];
        if (translationKey) {
          return t(translationKey);
        }
        return type;
      })
      .join(', ');

    const flightStylesInfo = (profile?.flightStyles || [])
      .map(style => {
        const cleanStyle = style.trim().toLowerCase();
        const key = `flightStyles.${cleanStyle}`;
        // Fallback to the style name if translation doesn't exist
        return t(key, { defaultValue: cleanStyle });
      })
      .join(', ');

    return [pilotTypeInfo, flightStylesInfo].filter(Boolean).join(' | ');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text>{t('alerts.fetchProfileError')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <Icon name="arrow-left" size={20} color="#000" />
      </TouchableOpacity>
      <View style={styles.profileHeader}>
        {profile.backgroundPictureUrl ? (
          <Image source={{ uri: profile.backgroundPictureUrl }} style={styles.backgroundPicture} />
        ) : (
          <View style={styles.backgroundPicturePlaceholder} />
        )}
        <View style={styles.headerContent}>
          {profile.profilePictureUrl ? (
            <Image source={{ uri: profile.profilePictureUrl }} style={styles.profilePicture} />
          ) : (
            <View style={styles.profilePicturePlaceholder}>
              <Icon name="user" size={60} color="#ccc" />
            </View>
          )}
          <Text style={styles.displayName}>{profile.displayName}</Text>
          {profile.cityRegion && (
            <Text style={styles.infoText}>{profile.cityRegion}</Text>
          )}
          <Text style={styles.infoText}>{getPilotInfo()}</Text>
        </View>
      </View>

      {profile.bio && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.bioLabel')}</Text>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.socialsLabel')}</Text>
        <View style={styles.socialIconsContainer}>
          {profile.socials?.whatsapp && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.whatsapp, 'whatsapp')}>
              <Icon name="whatsapp" size={30} color="#25D366" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.email && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.email, 'email')}>
              <Icon name="envelope" size={30} color="#B23121" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.youtube && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.youtube, 'web')}>
              <Icon name="youtube" size={30} color="#FF0000" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.instagram && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.instagram, 'web')}>
              <Icon name="instagram" size={30} color="#C13584" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.facebook && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.facebook, 'web')}>
              <Icon name="facebook" size={30} color="#4267B2" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.linkedin && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.linkedin, 'web')}>
              <Icon name="linkedin" size={30} color="#0077B5" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
          {profile.socials?.website && (
            <TouchableOpacity onPress={() => handleLinkPress(profile.socials.website, 'web')}>
              <Icon name="globe" size={30} color="#000000" style={styles.socialIcon} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('userProfile.publishedSpots')}</Text>
        {spots.length === 0 ? (
          <Text style={styles.noSpotsText}>{t('userProfile.noSpots')}</Text>
        ) : (
          <FlatList
            data={spots}
            renderItem={renderSpotItem}
            keyExtractor={(item) => item.id!}
            scrollEnabled={false}
          />
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 20,
    left: 20,
    zIndex: 1,
  },
  profileHeader: {
    alignItems: 'center',
  },
  backgroundPicture: {
    width: '100%',
    height: 150,
  },
  backgroundPicturePlaceholder: {
    width: '100%',
    height: 150,
    backgroundColor: '#e0e0e0',
  },
  headerContent: {
    alignItems: 'center',
    marginTop: -60,
  },
  profilePicture: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#fff',
    marginBottom: 10,
  },
  profilePicturePlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    marginBottom: 10,
  },
  displayName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoText: {
    fontSize: 16,
    color: 'gray',
    textAlign: 'center',
    marginHorizontal: 20,
  },
  section: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  bioText: {
    fontSize: 16,
    lineHeight: 24,
  },
  socialIconsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 10,
  },
  socialIcon: {
    margin: 15,
  },
  noSpotsText: {
    textAlign: 'center',
    paddingHorizontal: 32,
    fontSize: 16,
    width: '100%',
  },
  spotItem: {
    backgroundColor: '#f9f9f9',
    padding: 20,
    marginVertical: 8,
    borderRadius: 5,
  },
  spotName: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  spotDescription: {
    fontSize: 14,
    color: 'gray',
    marginTop: 5,
  },
});

export default UserProfileScreen;
