import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Spot, UserProfile, getUserProfile } from '../../src/services/firestoreService';
import { Rating } from 'react-native-ratings';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';

type SpotWithCreator = Spot & { creator?: UserProfile | null };

const SpotVersionsScreen = () => {
  const { t } = useTranslation();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { spots } = route.params;

  const [spotsWithCreators, setSpotsWithCreators] = useState<SpotWithCreator[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCreators = async () => {
      setLoading(true);
      const spotsData = await Promise.all(
        spots.map(async (spot: Spot) => {
          const creator = await getUserProfile(spot.createdBy);
          return { ...spot, creator };
        })
      );
      
      // Ordenar por puntuación descendente
      spotsData.sort((a, b) => b.averageRating - a.averageRating);
      
      setSpotsWithCreators(spotsData);
      setLoading(false);
    };

    if (spots && spots.length > 0) {
      fetchCreators();
    }
  }, [spots]);

  const renderSpotItem = ({ item }: { item: SpotWithCreator }) => (
    <TouchableOpacity 
      style={styles.card}
      onPress={() => navigation.navigate('SpotDetail', { spotId: item.id })}
    >
      {item.mainImage ? (
        <Image source={{ uri: item.mainImage }} style={styles.cardImage} />
      ) : (
        <View style={[styles.cardImage, styles.cardImagePlaceholder]}>
          <Icon name="image-off-outline" size={32} color="#ccc" />
        </View>
      )}
      <View style={styles.cardContent}>
        <Text style={styles.spotName}>{item.name}</Text>
        <Text style={styles.spotAddress} numberOfLines={1}>{item.address}</Text>
        <View style={styles.ratingContainer}>
          <Rating
            type="star"
            ratingCount={5}
            imageSize={18}
            readonly
            startingValue={item.averageRating}
          />
          <Text style={styles.reviewCount}>({item.reviewCount})</Text>
        </View>
        <View style={styles.creatorContainer}>
          {item.creator?.profilePictureUrl ? (
            <Image source={{ uri: item.creator.profilePictureUrl }} style={styles.creatorAvatar} />
          ) : (
            <Icon name="account-circle" size={24} color="#ccc" />
          )}
          <Text style={styles.creatorName}>{item.creator?.displayName || t('common.unknownUser')}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Icon name="arrow-left" size={24} color="#000" />
      </TouchableOpacity>
      <Text style={styles.title}>{t('spotVersions.title')}</Text>
      <Text style={styles.subtitle}>{t('spotVersions.subtitle')}</Text>
      <FlatList
        data={spotsWithCreators}
        renderItem={renderSpotItem}
        keyExtractor={(item) => item.id!}
        contentContainerStyle={styles.list}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 16,
    zIndex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    padding: 8,
    borderRadius: 20,
  },
  title: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginTop: 40, marginBottom: 10 },
  subtitle: { fontSize: 16, color: 'gray', textAlign: 'center', marginBottom: 20, paddingHorizontal: 20 },
  list: { paddingHorizontal: 16 },
  card: { 
    flexDirection: 'row', 
    backgroundColor: '#f9f9f9', 
    borderRadius: 8, 
    padding: 12, 
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  cardImage: { width: 80, height: 80, borderRadius: 8 },
  cardImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eee',
  },
  cardContent: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  spotName: { fontSize: 18, fontWeight: 'bold' },
  spotAddress: { fontSize: 12, color: 'gray' },
  ratingContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 4 },
  reviewCount: { marginLeft: 8, fontSize: 14, color: 'gray' },
  creatorContainer: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  creatorAvatar: { width: 24, height: 24, borderRadius: 12, marginRight: 8 },
  creatorName: { fontSize: 14, color: '#333' },
});

export default SpotVersionsScreen;
