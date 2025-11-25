import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, Image, Button, FlatList, Platform } from 'react-native';
import MapView, { MapPressEvent, Region, MapType, Polygon } from 'react-native-maps';
import RNFS from 'react-native-fs';

import MemoizedMapView from '../components/MemoizedMapView';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Rating } from 'react-native-ratings';
import { useMap } from '../context/MapContext';
import {
  getSpots,
  Spot,
  getSpotWithVersions,
  getPublicPilotMarkers,
  PilotMarkerMapEntry,
  getUserProfile,
  UserProfile,
} from '../../src/services/firestoreService';
import { navigateToSpotAfterAd } from '../../src/utils/spotsNavigation';
import CustomButton from '../components/CustomButton';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from '@react-native-community/geolocation';
import CheckBox from '@react-native-community/checkbox';
import { adManager } from '../../src/services/adManager';
import RemoveAdsModal from '../components/RemoveAdsModal';
import { useAds } from '../context/AdContext';
import { useAuthContext } from '../context/AuthContext';

import { flightStylesOptions } from '../../src/constants/flightStyles';
import { requestLocationPermission } from '../../src/utils/permissions';

const areRegionsSimilar = (a: Region | null, b: Region, tolerance = 0.00001) => {
  if (!a) {
    return false;
  }

  return (
    Math.abs(a.latitude - b.latitude) <= tolerance &&
    Math.abs(a.longitude - b.longitude) <= tolerance &&
    Math.abs(a.latitudeDelta - b.latitudeDelta) <= tolerance &&
    Math.abs(a.longitudeDelta - b.longitudeDelta) <= tolerance
  );
};

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation();
  const { areAdsDisabled, disableAdsForSession } = useAds();
  const {
    region,
    setRegion,
    selectedCoordinate,
    setSelectedCoordinate,
  } = useMap();

  const mapRef = useRef<MapView>(null);
  const isAnimatingMap = useRef(false); // Nueva referencia para controlar la animación del mapa
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mapType, setMapType] = useState<MapType>('standard');
  const [isServiceMenuVisible, setServiceMenuVisible] = useState(false);
  const [showSpotsOnZoom, setShowSpotsOnZoom] = useState(true); // Nuevo estado para controlar la visibilidad de los spots por zoom
  
  const [selectedSpot, setSelectedSpot] = useState<any>(null);
  const { user } = useAuthContext();
  const [pilotProfile, setPilotProfile] = useState<UserProfile | null>(null);
  const [isPilotProfileLoading, setPilotProfileLoading] = useState(true);
  const [pilotMarkers, setPilotMarkers] = useState<PilotMarkerMapEntry[]>([]);
  const [showMapInstructions, setShowMapInstructions] = useState(true);
  const [spainGeoData, setSpainGeoData] = useState<any>(null); // New state for GeoJSON data

  const isValidPilotMarker = (marker?: { latitude?: number; longitude?: number }) =>
    Boolean(
      marker &&
        typeof marker.latitude === 'number' &&
        typeof marker.longitude === 'number',
    );

  const pilotMarker = pilotProfile?.pilotMarker;
  const pilotMarkerData = useMemo(() => {
    return isValidPilotMarker(pilotMarker) && pilotProfile?.showPilotMarker !== false
      ? {
          latitude: pilotMarker!.latitude,
          longitude: pilotMarker!.longitude,
          photoUrl: pilotProfile?.profilePictureUrl,
        }
      : null;
  }, [pilotMarker, pilotProfile?.showPilotMarker, pilotProfile?.profilePictureUrl]);

  const pilotMarkersForMap = useMemo(() => {
    if (!pilotMarkerData || !user?.uid) {
      return pilotMarkers;
    }
    const existingIndex = pilotMarkers.findIndex(
      marker => marker.id === user.uid,
    );
    if (existingIndex !== -1) {
      const updated = [...pilotMarkers];
      updated[existingIndex] = {
        ...updated[existingIndex],
        latitude: pilotMarkerData.latitude,
        longitude: pilotMarkerData.longitude,
        photoUrl:
          pilotMarkerData.photoUrl ?? updated[existingIndex].photoUrl ?? null,
      };
      return updated;
    }
    return [
      ...pilotMarkers,
      {
        id: user.uid,
        latitude: pilotMarkerData.latitude,
        longitude: pilotMarkerData.longitude,
        photoUrl: pilotMarkerData.photoUrl ?? null,
      },
    ];
  }, [pilotMarkers, pilotMarkerData, user?.uid]);

  // --- Estados para el buscador y filtro ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [isFilterModalVisible, setFilterModalVisible] = useState(false);
  const [displaySpots, setDisplaySpots] = useState<Spot[]>([]);
  const [displayPilots, setDisplayPilots] = useState<PilotMarkerMapEntry[]>([]);
  const [isRemoveAdsModalVisible, setRemoveAdsModalVisible] = useState(false);
  // --- Fin de estados para el buscador ---

  const animateToRegion = useCallback(
    (target: Region, duration = 1000) => {
      isAnimatingMap.current = true;
      mapRef.current?.animateToRegion(target, duration);
      setRegion(target);
      setTimeout(() => {
        isAnimatingMap.current = false;
      }, duration + 200);
      return target;
    },
    [setRegion],
  );

  const normalizeTag = useCallback((value: string) => {
    const cleaned = value.replace(/^#+/, '').trim().toLowerCase();
    return cleaned.replace(/\s+/g, '');
  }, []);

  const parsedSearch = useMemo(() => {
    const tokens = searchQuery.split(/\s+/).map(token => token.trim()).filter(Boolean);
    const tags = tokens
      .filter(token => token.startsWith('#'))
      .map(token => normalizeTag(token))
      .filter(Boolean);
    const terms = tokens
      .filter(token => !token.startsWith('#'))
      .map(token => token.toLowerCase());
    return {
      tags,
      terms,
      hasSearch: tokens.length > 0,
      plainQuery: terms.join(' ').trim(),
    };
  }, [searchQuery, normalizeTag]);

  const handleCenterOnUserLocation = useCallback(async () => {
    const hasPermission = await requestLocationPermission();
    if (!hasPermission) {
      Alert.alert(
        t('alerts.locationPermissionTitle'),
        t('alerts.locationPermissionDeniedMessage'),
      );
      return;
    }

    Geolocation.getCurrentPosition(
      position => {
        const {latitude, longitude} = position.coords;
        const newRegion: Region = {
          latitude,
          longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        };
        animateToRegion(newRegion, 1000);
      },
      geolocationError => {
        let errorMessage = t('map.locationError');
        if (geolocationError && typeof geolocationError.message === 'string') {
          errorMessage += `\nError: ${geolocationError.message}`;
        }
        Alert.alert(t('alerts.error'), errorMessage);
        animateToRegion({
          latitude: 41.3851,
          longitude: 2.1734,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      },
      {enableHighAccuracy: false, timeout: 20000, maximumAge: 1000},
    );
  }, [animateToRegion, setRegion, t]);


  useEffect(() => {
    const timer = setTimeout(() => {
      handleCenterOnUserLocation();
    }, 100);

    return () => clearTimeout(timer); // Limpiar el temporizador si el componente se desmonta
  }, [handleCenterOnUserLocation]);

  // --- Lógica de filtrado ---
  useEffect(() => {
    let spotsResult = [...spots];
    const {hasSearch, terms, tags, plainQuery} = parsedSearch;
    if (hasSearch) {
      if (terms.length > 0) {
        spotsResult = spotsResult.filter(spot => {
          const haystack = `${spot.name} ${spot.address ?? ''} ${spot.description ?? ''}`.toLowerCase();
          return terms.every(term => haystack.includes(term));
        });
      }
      if (tags.length > 0) {
        spotsResult = spotsResult.filter(spot => {
          const spotTags = (spot.tags ?? []).map(value => normalizeTag(value));
          return tags.every(tag => spotTags.includes(tag));
        });
      }
    }

    if (selectedStyles.length > 0) {
      spotsResult = spotsResult.filter(
        spot =>
          spot.flightStyles && spot.flightStyles.some(style => selectedStyles.includes(style)),
      );
    }
    setDisplaySpots(
      hasSearch || selectedStyles.length > 0 ? spotsResult : spots,
    );

    if (plainQuery) {
      const pilotMatches = pilotMarkersForMap.filter(marker => {
        const lowercasedQuery = plainQuery.toLowerCase();
        const nameMatch = marker.displayName?.toLowerCase().includes(lowercasedQuery);
        const regionMatch = marker.cityRegion?.toLowerCase().includes(lowercasedQuery);
        return Boolean(nameMatch || regionMatch);
      });
      setDisplayPilots(pilotMatches);
    } else {
      setDisplayPilots([]);
    }
  }, [parsedSearch, selectedStyles, spots, pilotMarkersForMap, normalizeTag]);
  // --- Fin de la lógica de filtrado ---

  useEffect(() => {
    if (!user) {
      setPilotProfile(null);
      setPilotProfileLoading(false);
      return;
    }
    let cancelled = false;
    const loadProfile = async () => {
      try {
        setPilotProfileLoading(true);
        const data = await getUserProfile(user.uid);
        if (!cancelled) {
          setPilotProfile(data);
        }
      } catch (err) {
        console.error('[MapScreen] failed to fetch user profile', err);
      } finally {
        if (!cancelled) {
          setPilotProfileLoading(false);
        }
      }
    };
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, [user]);

  

      useEffect(() => {
    const getAssetPath = (filename: string) => {
      if (Platform.OS === 'android') {
        return `file:///android_asset/${filename}`;
      }
      // For iOS, files in the main bundle are usually accessed directly by name
      // or through NSBundle.mainBundle().pathForResource.
      // For simplicity here, we'll assume direct access if bundled correctly.
      // For complex cases, a native bridge might be needed.
      return filename;
    };

    const loadSpainGeo = async () => {
      try {
        const path = getAssetPath('spain.json');
        const content = await RNFS.readFile(path, 'utf8');
        setSpainGeoData(JSON.parse(content));
      } catch (error) {
        console.error('Error loading spain.json:', error);
      }
    };
    loadSpainGeo();
  }, []);

  const onRegionChangeComplete = (newRegion: Region) => {
    if (isAnimatingMap.current) {
      return;
    }
    if (!areRegionsSimilar(region, newRegion)) {
      setRegion(newRegion);
    }
    const zoomThreshold = 0.25;
    if (newRegion.latitudeDelta < zoomThreshold) {
      if (!showSpotsOnZoom) {
        setShowSpotsOnZoom(true);
      }
    } else {
      if (showSpotsOnZoom) {
        setShowSpotsOnZoom(false);
      }
    }
  };

  const handleMapPress = useCallback((event: MapPressEvent) => {
    if (selectedSpot) {
      setSelectedSpot(null);
    } else {
      setSelectedCoordinate(event.nativeEvent.coordinate);
      setServiceMenuVisible(true);
    }
  }, [selectedSpot, setSelectedCoordinate]);

  const handleSpotPress = useCallback((spot: any, event: any) => {
    event.stopPropagation();
    setSelectedSpot(spot);
  }, []);

  const fetchSpots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedSpots = await getSpots();
      console.log('MapScreen: fetched spots', fetchedSpots.length);
      if (fetchedSpots.length > 0) {
        console.log('MapScreen: first spot', JSON.stringify(fetchedSpots[0]));
      }
      setSpots(Array.isArray(fetchedSpots) ? fetchedSpots : []);
    } catch (err) {
      console.error("Error fetching spots:", err);
      setError(t('alerts.fetchSpotError'));
      setSpots([]); // Asegurarse de que spots sea un array en caso de error
    } finally {
      setLoading(false);
    }
  }, [t]);

  const fetchPilotMarkers = useCallback(async () => {
    try {
      const markers = await getPublicPilotMarkers();
      setPilotMarkers(markers);
    } catch (err) {
      console.error('[MapScreen] failed to fetch pilot markers', err);
    }
  }, []);

  useEffect(() => {
    fetchSpots();
    const unsubscribe = navigation.addListener('focus', () => {
      fetchSpots();
    });
    return unsubscribe;
  }, [navigation, fetchSpots]);

  useEffect(() => {
    fetchPilotMarkers();
    const unsubscribe = navigation.addListener('focus', fetchPilotMarkers);
    return unsubscribe;
  }, [navigation, fetchPilotMarkers]);



  const searchResults = useMemo<SearchResult[]>(() => {
    const pilotEntries = displayPilots.map(pilot => ({
      type: 'pilot' as const,
      pilot,
    }));
    const spotEntries = displaySpots.map(spot => ({
      type: 'spot' as const,
      spot,
    }));
    return [...pilotEntries, ...spotEntries];
  }, [displayPilots, displaySpots]);

  const handleCalloutPress = (spotId: string) => {
  setSelectedSpot(null);
  adManager.showInterstitialAd(() => {
    navigateToSpotAfterAd({
      navigation,
      spotId,
      fetchVersions: getSpotWithVersions,
        onFallback: () => {
          Alert.alert(t('alerts.error'), t('map.spotNotFound'));
        },
      });
    }, areAdsDisabled);
  };

  const handleGoToSpot = (spot: Spot) => {
    const coordinates: any = (spot as any).coordinates;
    const latitude =
      coordinates?.latitude ??
      coordinates?._latitude ??
      (spot as any).latitude ??
      (spot as any).lat;
    const longitude =
      coordinates?.longitude ??
      coordinates?._longitude ??
      (spot as any).longitude ??
      (spot as any).lng ??
      (spot as any).lon;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return;
    }

    const spotRegion = {
      latitude,
      longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
    animateToRegion(spotRegion, 1000);
    setSelectedSpot(spot); // Seleccionar el spot para mostrar el callout
    
    // Limpiar búsqueda para cerrar la lista
    setSearchQuery('');
    setSelectedStyles([]);
  };

  const handlePilotMarkerPress = useCallback(
    (markerUserId?: string) => {
      if (!markerUserId) {
        return;
      }
      navigation.navigate('UserProfile' as never, {userId: markerUserId} as never);
    },
    [navigation],
  );
  const handlePilotResultPress = useCallback(
    (pilot: PilotMarkerMapEntry) => {
      const pilotRegion = {
        latitude: pilot.latitude,
        longitude: pilot.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      animateToRegion(pilotRegion, 1000);
      setSearchQuery('');
      setSelectedStyles([]);
      handlePilotMarkerPress(pilot.id);
    },
    [animateToRegion, handlePilotMarkerPress],
  );

  const holes = useMemo(() => {
    if (!spainGeoData) {
      return [];
    }
    const spainFeature = spainGeoData.features.find((f: any) => f.id === 'ESP');
    if (!spainFeature || spainFeature.geometry.type !== 'MultiPolygon') {
      return [];
    }
    return spainFeature.geometry.coordinates.flatMap((polygon: any) =>
      polygon.map((ring: any) =>
        ring.map((coord: any) => ({
          latitude: coord[1],
          longitude: coord[0],
        })),
      ),
    );
  }, [spainGeoData]);

  return (
    <View style={styles.container}>
      {console.log('MapScreen render', {showSpotsOnZoom, displayLength: displaySpots.length, region})}
      <RemoveAdsModal
        isVisible={isRemoveAdsModalVisible}
        onClose={() => setRemoveAdsModalVisible(false)}
        onWatchAd={() => {
          setRemoveAdsModalVisible(false);
          adManager.showRewardedAd(
            () => {
              // El usuario ha ganado la recompensa
              disableAdsForSession();
              Alert.alert(
                t('removeAds.rewardEarnedTitle'),
                t('removeAds.rewardEarnedMessage'),
              );
            },
            () => {
              Alert.alert(t('alerts.error'), t('removeAds.rewardNotReady'));
            },
          );
        }}
      />
      {!region ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
          <Text>{t('map.gettingLocation')}</Text>
        </View>
      ) : (
        <MemoizedMapView
          mapRef={mapRef}
          region={region}
          onRegionChangeComplete={onRegionChangeComplete}
          onPress={handleMapPress}
          showsUserLocation
          showsCompass
          mapType={mapType}
          selectedCoordinate={selectedCoordinate}
          spots={spots}
          showAirZones={false}
          airZones={null}
          handleSpotPress={(spot, event) => handleSpotPress(spot, event)}
          pilotMarkers={pilotMarkersForMap}
          handlePilotMarkerPress={handlePilotMarkerPress}
          showMarkers={showSpotsOnZoom}
        >
          {spainGeoData && (
            <Polygon
              coordinates={[
                { latitude: 90, longitude: -180 },
                { latitude: 90, longitude: 0 },
                { latitude: 90, longitude: 180 },
                { latitude: -90, longitude: 180 },
                { latitude: -90, longitude: 0 },
                { latitude: -90, longitude: -180 },
              ]}
              holes={holes}
              fillColor="rgba(0,0,0,0.5)"
              strokeWidth={0}
            />
          )}
        </MemoizedMapView>
      )}

      <View style={styles.headerContainer}>
        <View style={styles.sideControlsContainer}>
          <TouchableOpacity style={styles.controlButton} onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}>
            <Icon name="satellite-variant" size={24} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={handleCenterOnUserLocation}>
            <Icon name="crosshairs-gps" size={24} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={() => setRemoveAdsModalVisible(true)}>
            <Icon name="crown-outline" size={24} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.searchContainer}>
          <TextInput
            key={i18n.language}
            style={styles.searchInput}
            placeholder={t('map.searchPlaceholder')}
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <TouchableOpacity style={styles.filterButton} onPress={() => setFilterModalVisible(true)}>
            <Icon name="filter-variant" size={24} color="#333" />
          </TouchableOpacity>
        </View>
      </View>

      {showMapInstructions && (
        <View style={styles.instructionsCard}>
          <Text style={styles.instructionsTitle}>{t('map.instructionsTitle')}</Text>
          <View style={styles.instructionsList}>
            <Text style={styles.instructionsItem}>• {t('map.instructionsSearchSpot')}</Text>
            <Text style={styles.instructionsItem}>• {t('map.instructionsTapSpot')}</Text>
            <Text style={styles.instructionsItem}>• {t('map.instructionsAddSpot')}</Text>
          </View>
          <TouchableOpacity
            style={styles.instructionsDismiss}
            onPress={() => setShowMapInstructions(false)}>
            <Text style={styles.instructionsDismissText}>{t('map.instructionsDismiss')}</Text>
          </TouchableOpacity>
        </View>
      )}
      {isPilotProfileLoading && (
        <View style={styles.pilotLoadingCard}>
          <ActivityIndicator size="small" color="#007bff" />
          <Text style={styles.pilotLoadingText}>{t('map.loadingPilotMarker')}</Text>
        </View>
      )}

      {selectedSpot && (
        <View style={styles.calloutContainer}>
          <TouchableOpacity onPress={() => handleCalloutPress(selectedSpot.id)}>
            {selectedSpot.mainImage && (
              <Image source={{ uri: selectedSpot.mainImage }} style={styles.calloutImage} />
            )}
            <Text style={styles.calloutTitle}>{selectedSpot.name}</Text>
            {selectedSpot.averageRating !== undefined && (
              <Text style={styles.calloutRating}>{'⭐'.repeat(Math.round(selectedSpot.averageRating))}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeCalloutButton} onPress={() => setSelectedSpot(null)}>
              <Icon name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
          <Text style={styles.loadingText}>{t('map.loadingSpots')}</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <Modal
        animationType="slide"
        transparent={true}
        visible={isServiceMenuVisible}
        onRequestClose={() => setServiceMenuVisible(false)}
      >
        <View style={styles.bottomSheetView}>
          <View style={styles.bottomSheetModalView}>
            <Text style={styles.modalTitle}>{t('map.actions')}</Text>
            <CustomButton
              title={t('map.createNewSpot')}
              onPress={() => {
                setServiceMenuVisible(false);
                navigation.navigate('AddSpot' as never, { coordinate: selectedCoordinate } as never);
              }}
            />
            <CustomButton
              title={t('map.cancel')}
              onPress={() => setServiceMenuVisible(false)}
              style={{ marginTop: 10, backgroundColor: 'red' }}
            />
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent={true}
        visible={isFilterModalVisible}
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <View style={styles.filterModalContainer}>
          <View style={styles.filterModalContent}>
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setFilterModalVisible(false)}>
              <Icon name="close" size={24} color="#333" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('map.filterByFlightStyle')}</Text>
            <View style={styles.checkboxGrid}>
              {flightStylesOptions.map(style => (
                <View key={style} style={styles.checkboxContainer}>
                  <CheckBox
                    value={selectedStyles.includes(style)}
                    tintColors={{ true: '#007BFF', false: '#888' }}
                    onValueChange={() => {
                      setSelectedStyles(prev => 
                        prev.includes(style) 
                          ? prev.filter(s => s !== style) 
                          : [...prev, style]
                      );
                    }}
                  />
                  <Text style={styles.checkboxLabel}>{t(`flightStyles.${style}`)}</Text>
                </View>
              ))}
            </View>
            <View style={styles.filterActions}>
              <Button title={t('map.clear')} onPress={() => setSelectedStyles([])} />
              <Button title={t('map.apply')} onPress={() => setFilterModalVisible(false)} />
            </View>
          </View>
        </View>
      </Modal>

      {(searchQuery.length > 0 || selectedStyles.length > 0) && (
        <View style={styles.resultsContainer}>
          <TouchableOpacity 
            style={styles.closeResultsButton} 
            onPress={() => {
              setSearchQuery('');
              setSelectedStyles([]);
            }}
          >
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <FlatList
            data={searchResults}
            keyExtractor={item =>
              item.type === 'pilot' ? `pilot-${item.pilot.id}` : `spot-${item.spot.id}`
            }
            renderItem={({item}) => {
              if (item.type === 'pilot') {
                return (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => handlePilotResultPress(item.pilot)}>
                    {item.pilot.photoUrl ? (
                      <Image
                        source={{uri: item.pilot.photoUrl}}
                        style={styles.resultImage}
                      />
                    ) : (
                      <View style={[styles.resultImage, styles.pilotFallback]}>
                        <Icon name="account" size={22} color="#fff" />
                      </View>
                    )}
                    <View style={styles.resultTextContainer}>
                      <Text style={styles.resultName}>
                        {item.pilot.displayName || t('map.unknownPilot')}
                      </Text>
                      {item.pilot.cityRegion ? (
                        <Text style={styles.resultAddress} numberOfLines={1}>
                          {item.pilot.cityRegion}
                        </Text>
                      ) : null}
                      <Text style={styles.resultPilotBadge}>{t('map.pilotResult')}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }
              const spotItem = item.spot;
              return (
                <TouchableOpacity style={styles.resultItem} onPress={() => handleGoToSpot(spotItem)}>
                  <Image source={{uri: spotItem.mainImage}} style={styles.resultImage} />
                  <View style={styles.resultTextContainer}>
                    <Text style={styles.resultName}>{spotItem.name}</Text>
                    <Text style={styles.resultAddress} numberOfLines={1}>
                      {spotItem.address}
                    </Text>
                    <View style={{flexDirection: 'row', alignItems: 'center'}}>
                      <Rating
                        type="star"
                        ratingCount={5}
                        imageSize={15}
                        readonly
                        startingValue={spotItem.averageRating}
                        style={{paddingVertical: 2}}
                      />
                      <Text style={{marginLeft: 5, color: 'gray'}}>({spotItem.reviewCount})</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={<Text style={styles.noResultsText}>{t('map.noResults')}</Text>}
          />
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1,
    gap: 10,
  },
  instructionsCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  instructionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  instructionsList: {
    marginBottom: 8,
  },
  instructionsItem: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
  },
  instructionsDismiss: {
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  instructionsDismissText: {
    color: '#1a73e8',
    fontWeight: '600',
  },
  pilotLoadingCard: {
    position: 'absolute',
    top: 180,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pilotLoadingText: {
    marginLeft: 8,
    color: '#fff',
    fontSize: 13,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 25,
    height: 50,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: '#000',
  },
  filterButton: {
    paddingLeft: 10,
  },
  sideControlsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: 'white',
    marginTop: 10,
  },
  errorOverlay: {
    position: 'absolute',
    top: '50%',
    left: '10%',
    right: '10%',
    backgroundColor: 'red',
    padding: 10,
    borderRadius: 5,
    alignItems: 'center',
  },
  errorText: {
    color: 'white',
    fontWeight: 'bold',
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 22,
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    marginBottom: 20, // Add margin bottom to separate from search input
    zIndex: 10, // Ensure title is on top
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    marginBottom: 10,
    paddingHorizontal: 10,
    width: 250,
    borderRadius: 5,
  },
  bottomSheetView: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  bottomSheetModalView: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20, // Revert to standard padding
    paddingHorizontal: 20, // Keep horizontal padding
    paddingBottom: 20, // Keep bottom padding
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: -2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  fullScreenModalContainer: {
    flex: 1,
    backgroundColor: 'white',
    paddingTop: 20, // Adjust as needed for status bar/notch
  },
  fullScreenModalContent: {
    padding: 20,
    alignItems: 'center', // Centra el contenido horizontalmente
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  gridButton: {
    minWidth: '40%',
    margin: 8,
  },
  gridButtonText: {
    fontSize: 14,
  },
  calloutContainer: {
    position: 'absolute',
    bottom: 150,
    left: '50%',
    marginLeft: -75,
    width: 150,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  calloutImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 5,
  },
  calloutTitle: {
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 2,
    textAlign: 'center',
  },
  calloutRating: {
    fontSize: 14,
    textAlign: 'center',
  },
  closeCalloutButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: '#000',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  filterModalContent: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '80%',
  },
  closeModalButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1,
  },
  checkboxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginVertical: 10,
  },
  checkboxContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '48%',
    marginBottom: 10,
  },
  checkboxLabel: {
    marginLeft: 8,
    flex: 1,
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 20,
  },
  resultsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 10,
    paddingTop: 20,
  },
  closeResultsButton: {
    position: 'absolute',
    top: -15,
    right: 15,
    backgroundColor: '#333',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  resultItem: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  pilotFallback: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#007bff',
  },
  resultTextContainer: {
    flex: 1,
    marginLeft: 15,
    justifyContent: 'center'
  },
  resultName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  resultAddress: {
    fontSize: 14,
    color: 'gray',
  },
  resultPilotBadge: {
    marginTop: 4,
    fontSize: 12,
    color: '#007bff',
    fontWeight: '600',
  },
  noResultsText: {
    textAlign: 'center',
    marginTop: 20,
    color: 'gray',
  },
});
type SearchResult =
  | {type: 'pilot'; pilot: PilotMarkerMapEntry}
  | {type: 'spot'; spot: Spot};
