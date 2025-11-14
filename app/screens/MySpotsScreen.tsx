import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { getSpotsByUserId, Spot, deleteSpot } from '../../src/services/firestoreService';
import { authInstance as auth } from '../../src/firebaseConfig';
import Icon from 'react-native-vector-icons/FontAwesome';

const MySpotsScreen = () => {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const fetchSpots = async () => {
        const user = auth.currentUser;
        if (!user) {
          setError(t('alerts.notLoggedIn'));
          setLoading(false);
          setSpots([]);
          return;
        }

        try {
          setLoading(true);
          setError(null);
          const userSpots = await getSpotsByUserId(user.uid);
          setSpots(userSpots);
        } catch (e) {
          console.error(e);
          setError(t('mySpots.fetchError'));
        } finally {
          setLoading(false);
        }
      };

      fetchSpots();
    }, [t])
  );

  const handleDelete = (spotId: string) => {
    Alert.alert(
      t('mySpots.deleteConfirmTitle'),
      t('mySpots.deleteConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSpot(spotId);
              setSpots(prevSpots => prevSpots.filter(spot => spot.id !== spotId));
              Alert.alert(t('mySpots.deleteSuccessTitle'), t('mySpots.deleteSuccessMessage'));
            } catch (err) {
              console.error("Error deleting spot: ", err);
              Alert.alert(t('alerts.error'), t('mySpots.deleteError'));
            }
          },
        },
      ]
    );
  };

  const renderSpotItem = ({ item }: { item: Spot }) => (
    <View style={styles.spotItemContainer}>
      <TouchableOpacity 
        style={styles.spotItem}
        onPress={() => navigation.navigate('SpotDetail' as never, { spotId: item.id } as never)}
      >
        <Text style={styles.spotName}>{item.name}</Text>
        <Text style={styles.spotDescription}>{item.description}</Text>
      </TouchableOpacity>
      <TouchableOpacity 
        style={styles.deleteButton}
        onPress={() => handleDelete(item.id!)}
      >
        <Icon name="trash" size={24} color="#E53935" />
      </TouchableOpacity>
    </View>
  );

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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('mySpots.title')}</Text>
      {spots.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.noSpotsText}>{t('mySpots.noSpots')}</Text>
        </View>
      ) : (
        <FlatList
          data={spots}
          renderItem={renderSpotItem}
          keyExtractor={(item) => item.id!}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
    backgroundColor: '#fff',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginVertical: 20,
  },
  list: {
    paddingHorizontal: 10,
  },
  noSpotsText: {
    textAlign: 'center',
    paddingHorizontal: 32,
    fontSize: 16,
    width: '100%',
  },
  spotItemContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
    padding: 15,
    marginVertical: 8,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#eee',
  },
  spotItem: {
    flex: 1,
    marginRight: 10,
  },
  deleteButton: {
    padding: 5,
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
  errorText: {
    color: 'red',
    textAlign: 'center',
  },
});

export default MySpotsScreen;
