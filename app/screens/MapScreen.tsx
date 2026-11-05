import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, Image, FlatList } from 'react-native';
import MapView, { MapPressEvent, Region, MapType } from 'react-native-maps';

import MemoizedMapView from '../components/MemoizedMapView';
import { useNavigation, useRoute } from '@react-navigation/native';
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
import {EventMarkerEntry, getPublicEventMarkers} from '../../src/services/eventService';
import { navigateToSpotAfterAd } from '../../src/utils/spotsNavigation';
import CustomButton from '../components/CustomButton';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from '@react-native-community/geolocation';
import CheckBox from '@react-native-community/checkbox';
import { adManager } from '../../src/services/adManager';
import RemoveAdsModal from '../components/RemoveAdsModal';
import AffiliateStoreSheet from '../components/AffiliateStoreSheet';
import { useAds } from '../context/AdContext';
import { useAuthContext } from '../context/AuthContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { flightStylesOptions } from '../../src/constants/flightStyles';
import { requestLocationPermission } from '../../src/utils/permissions';
import { palette, radii, shadows } from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import {
  MARKER_VISIBILITY_HIDE_THRESHOLD,
  MARKER_VISIBILITY_SHOW_THRESHOLD,
  SearchResult,
  arePilotMarkerListsEqual,
  areRegionsSimilar,
  buildFilteredPilots,
  buildFilteredSpots,
  buildPilotMarkerData,
  buildPilotMarkersForMap,
  buildSearchResults,
  getSpotRegion,
  parseMapSearch,
} from '../features/map/mapScreenShared';
import type {MainTabScreenNavigationProp, MainTabScreenProps} from '../../src/navigation/types';

const DEFAULT_MAP_REGION: Region = {
  latitude: 41.3851,
  longitude: 2.1734,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};
const MAP_FOCUS_REFRESH_MIN_INTERVAL_MS = 5000;

export default function MapScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<MainTabScreenNavigationProp<'Map'>>();
  const route = useRoute<MainTabScreenProps<'Map'>['route']>();
  const insets = useSafeAreaInsets();
  const { areAdsDisabled, disableAdsForSession, isPremium } = useAds();
  const {
    region,
    setRegion,
    selectedCoordinate,
    setSelectedCoordinate,
  } = useMap();

  const mapRef = useRef<MapView>(null);
  const lastHandledEventFocusRef = useRef<number | null>(null);
  const isAnimatingMap = useRef(false); // Nueva referencia para controlar la animación del mapa
  const lastSpotsFetchStartedAtRef = useRef(0);
  const lastPilotMarkersFetchStartedAtRef = useRef(0);
  const lastEventMarkersFetchStartedAtRef = useRef(0);
  const isFetchingSpotsRef = useRef(false);
  const isFetchingPilotMarkersRef = useRef(false);
  const isFetchingEventMarkersRef = useRef(false);
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
  const [eventMarkers, setEventMarkers] = useState<EventMarkerEntry[]>([]);
  const [showMapInstructions, setShowMapInstructions] = useState(true);

  const pilotMarkerData = useMemo(
    () => buildPilotMarkerData(pilotProfile),
    [pilotProfile],
  );

  const pilotMarkersForMap = useMemo(() => {
    return buildPilotMarkersForMap({
      pilotMarkerData,
      pilotMarkers,
      userId: user?.uid,
    });
  }, [pilotMarkers, pilotMarkerData, user?.uid]);

  // --- Estados para el buscador y filtro ---
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [isFilterModalVisible, setFilterModalVisible] = useState(false);
  const [isRemoveAdsModalVisible, setRemoveAdsModalVisible] = useState(false);
  const [isStoreMenuVisible, setStoreMenuVisible] = useState(false);
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

  const parsedSearch = useMemo(() => parseMapSearch(searchQuery), [searchQuery]);
  const displayRegion = region ?? DEFAULT_MAP_REGION;

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
        animateToRegion(DEFAULT_MAP_REGION);
      },
      {enableHighAccuracy: false, timeout: 20000, maximumAge: 1000},
    );
  }, [animateToRegion, t]);

  const displaySpots = useMemo(
    () =>
      buildFilteredSpots({
        parsedSearch,
        selectedStyles,
        spots,
      }),
    [parsedSearch, selectedStyles, spots],
  );

  const displayPilots = useMemo(
    () =>
      buildFilteredPilots({
        parsedSearch,
        pilotMarkers: pilotMarkersForMap,
      }),
    [parsedSearch, pilotMarkersForMap],
  );

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
        logger.error('[MapScreen] failed to fetch user profile', err);
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

  

  const onRegionChangeComplete = (newRegion: Region) => {
    if (isAnimatingMap.current) {
      return;
    }
    if (!areRegionsSimilar(region, newRegion)) {
      setRegion(newRegion);
    }
    // Use hysteresis to avoid toggling markers on minor zoom jitter
    if (showSpotsOnZoom && newRegion.latitudeDelta > MARKER_VISIBILITY_HIDE_THRESHOLD) {
      setShowSpotsOnZoom(false);
    } else if (!showSpotsOnZoom && newRegion.latitudeDelta < MARKER_VISIBILITY_SHOW_THRESHOLD) {
      setShowSpotsOnZoom(true);
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

  const handleSpotPress = useCallback((spot: any, event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    setSelectedSpot(spot);
  }, []);

  const fetchSpots = useCallback(async ({force = false}: {force?: boolean} = {}) => {
    const now = Date.now();
    if (!force) {
      if (isFetchingSpotsRef.current) {
        logger.log('[MapScreen] skipped spots fetch because one is already in flight');
        return;
      }

      const elapsedMs = now - lastSpotsFetchStartedAtRef.current;
      if (elapsedMs < MAP_FOCUS_REFRESH_MIN_INTERVAL_MS) {
        logger.log('[MapScreen] skipped spots focus refresh', {
          elapsedMs,
          minIntervalMs: MAP_FOCUS_REFRESH_MIN_INTERVAL_MS,
        });
        return;
      }
    }

    isFetchingSpotsRef.current = true;
    lastSpotsFetchStartedAtRef.current = now;
    setLoading(true);
    setError(null);
    try {
      const fetchedSpots = await getSpots();
      logger.log('MapScreen: fetched spots', fetchedSpots.length);
      setSpots(Array.isArray(fetchedSpots) ? fetchedSpots : []);
    } catch (err) {
      logger.error('Error fetching spots', err);
      setError(t('alerts.fetchSpotError'));
      setSpots([]); // Asegurarse de que spots sea un array en caso de error
    } finally {
      isFetchingSpotsRef.current = false;
      setLoading(false);
    }
  }, [t]);

  const fetchPilotMarkers = useCallback(async ({force = false}: {force?: boolean} = {}) => {
    const now = Date.now();
    if (!force) {
      if (isFetchingPilotMarkersRef.current) {
        logger.log('[MapScreen] skipped pilot markers fetch because one is already in flight');
        return;
      }

      const elapsedMs = now - lastPilotMarkersFetchStartedAtRef.current;
      if (elapsedMs < MAP_FOCUS_REFRESH_MIN_INTERVAL_MS) {
        logger.log('[MapScreen] skipped pilot markers focus refresh', {
          elapsedMs,
          minIntervalMs: MAP_FOCUS_REFRESH_MIN_INTERVAL_MS,
        });
        return;
      }
    }

    isFetchingPilotMarkersRef.current = true;
    lastPilotMarkersFetchStartedAtRef.current = now;
    try {
      const markers = await getPublicPilotMarkers();
      setPilotMarkers(prev => (arePilotMarkerListsEqual(prev, markers) ? prev : markers));
    } catch (err) {
      logger.error('[MapScreen] failed to fetch pilot markers', err);
    } finally {
      isFetchingPilotMarkersRef.current = false;
    }
  }, []);

  const fetchEventMarkers = useCallback(async ({force = false}: {force?: boolean} = {}) => {
    const now = Date.now();
    if (!force) {
      if (isFetchingEventMarkersRef.current) {
        logger.log('[MapScreen] skipped event markers fetch because one is already in flight');
        return;
      }

      const elapsedMs = now - lastEventMarkersFetchStartedAtRef.current;
      if (elapsedMs < MAP_FOCUS_REFRESH_MIN_INTERVAL_MS) {
        logger.log('[MapScreen] skipped event markers focus refresh', {
          elapsedMs,
          minIntervalMs: MAP_FOCUS_REFRESH_MIN_INTERVAL_MS,
        });
        return;
      }
    }

    isFetchingEventMarkersRef.current = true;
    lastEventMarkersFetchStartedAtRef.current = now;
    try {
      const markers = await getPublicEventMarkers();
      setEventMarkers(markers);
    } catch (err) {
      logger.error('[MapScreen] failed to fetch event markers', err);
    } finally {
      isFetchingEventMarkersRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchSpots({force: true});
    const unsubscribe = navigation.addListener('focus', () => {
      fetchSpots();
    });
    return unsubscribe;
  }, [navigation, fetchSpots]);

  useEffect(() => {
    fetchPilotMarkers({force: true});
    const unsubscribe = navigation.addListener('focus', () => {
      fetchPilotMarkers();
    });
    return unsubscribe;
  }, [navigation, fetchPilotMarkers]);

  useEffect(() => {
    fetchEventMarkers({force: true});
    const unsubscribe = navigation.addListener('focus', () => {
      fetchEventMarkers();
    });
    return unsubscribe;
  }, [navigation, fetchEventMarkers]);



  const searchResults = useMemo<SearchResult[]>(() => {
    return buildSearchResults(displayPilots, displaySpots);
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
    const spotRegion = getSpotRegion(spot);
    if (!spotRegion) {
      return;
    }
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
      navigation.navigate('UserProfile', {userId: markerUserId});
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

  const handleEventMarkerPress = useCallback(
    (eventId?: string) => {
      if (!eventId) {
        return;
      }
      navigation.navigate('EventDetail', {eventId});
    },
    [navigation],
  );

  useEffect(() => {
    const focusRequestedAt = route.params?.focusRequestedAt;
    if (
      typeof focusRequestedAt !== 'number' ||
      lastHandledEventFocusRef.current === focusRequestedAt
    ) {
      return;
    }

    const latitude = route.params?.focusLatitude;
    const longitude = route.params?.focusLongitude;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      lastHandledEventFocusRef.current = focusRequestedAt;
      animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        },
        700,
      );
      return;
    }

    const focusEventId = route.params?.focusEventId;
    if (!focusEventId) {
      return;
    }

    const marker = eventMarkers.find(entry => entry.id === focusEventId);
    if (!marker) {
      return;
    }

    lastHandledEventFocusRef.current = focusRequestedAt;
    animateToRegion(
      {
        latitude: marker.latitude,
        longitude: marker.longitude,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      700,
    );
  }, [
    animateToRegion,
    eventMarkers,
    route.params?.focusEventId,
    route.params?.focusLatitude,
    route.params?.focusLongitude,
    route.params?.focusRequestedAt,
  ]);

  return (
    <View style={styles.container}>
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
      <AffiliateStoreSheet
        visible={isStoreMenuVisible}
        onClose={() => setStoreMenuVisible(false)}
        source="map"
      />
      <MemoizedMapView
        mapRef={mapRef}
        region={displayRegion}
        onRegionChangeComplete={onRegionChangeComplete}
        onPress={handleMapPress}
        showsUserLocation
        showsCompass
        mapType={mapType}
        selectedCoordinate={selectedCoordinate}
        spots={spots}
        showAirZones={false}
        airZones={null}
        handleSpotPress={handleSpotPress}
        pilotMarkers={pilotMarkersForMap}
        handlePilotMarkerPress={handlePilotMarkerPress}
        eventMarkers={eventMarkers}
        handleEventMarkerPress={handleEventMarkerPress}
        showMarkers={showSpotsOnZoom}
      />

      <View style={[styles.headerContainer, { top: insets.top + 10 }]}>
        <View style={styles.sideControlsContainer}>
          <TouchableOpacity style={styles.controlButton} onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}>
            <Icon name="satellite-variant" size={24} color="#333" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={handleCenterOnUserLocation}>
            <Icon name="crosshairs-gps" size={24} color="#333" />
          </TouchableOpacity>
          {!isPremium ? (
            <TouchableOpacity style={styles.controlButton} onPress={() => setRemoveAdsModalVisible(true)}>
              <Icon name="crown-outline" size={24} color="#333" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.controlButton} onPress={() => setStoreMenuVisible(true)}>
            <Icon name="shopping-outline" size={24} color="#333" />
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
                navigation.navigate('AddSpot', { coordinate: selectedCoordinate });
              }}
            />
            <CustomButton
              title={t('map.cancel')}
              onPress={() => setServiceMenuVisible(false)}
              variant="outline"
              color="#e53935"
              textColor="#e53935"
              style={styles.modalSecondaryButton}
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
              <Icon name="close" size={24} color={palette.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{t('map.filterByFlightStyle')}</Text>
            <View style={styles.checkboxGrid}>
              {flightStylesOptions.map(style => (
                <View key={style} style={styles.checkboxContainer}>
                  <CheckBox
                    value={selectedStyles.includes(style)}
                    tintColors={{ true: palette.highlight, false: palette.borderMuted }}
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
              <CustomButton
                title={t('map.clear')}
                variant="outline"
                style={styles.filterActionButtonSecondary}
                onPress={() => setSelectedStyles([])}
              />
              <CustomButton
                title={t('map.apply')}
                style={styles.filterActionButton}
                onPress={() => setFilterModalVisible(false)}
              />
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
                    <View style={styles.resultRatingRow}>
                      <Rating
                        type="star"
                        ratingCount={5}
                        imageSize={15}
                        readonly
                        startingValue={spotItem.averageRating}
                        style={styles.resultRating}
                      />
                      <Text style={styles.resultReviewCount}>({spotItem.reviewCount})</Text>
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
    backgroundColor: palette.backgroundLight,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: palette.borderLight,
    height: 50,
    ...shadows.subtle,
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    color: palette.textPrimary,
  },
  filterButton: {
    paddingLeft: 10,
  },
  sideControlsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  controlButton: {
    backgroundColor: palette.backgroundCard,
    borderWidth: 1,
    borderColor: palette.borderLight,
    width: 50,
    height: 50,
    borderRadius: radii.lg,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.subtle,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(248,250,252,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: palette.textSecondary,
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
    color: palette.textPrimary,
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
    backgroundColor: palette.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: 20, // Revert to standard padding
    paddingHorizontal: 20, // Keep horizontal padding
    paddingBottom: 20, // Keep bottom padding
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  modalSecondaryButton: {
    marginTop: 10,
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
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.lg,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
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
    color: palette.textPrimary,
  },
  calloutRating: {
    fontSize: 14,
    textAlign: 'center',
    color: palette.textSecondary,
  },
  closeCalloutButton: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.lg,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  filterModalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  filterModalContent: {
    backgroundColor: palette.backgroundCard,
    borderRadius: radii.lg,
    padding: 20,
    width: '85%',
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
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
    color: palette.textPrimary,
  },
  filterActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 20,
  },
  filterActionButton: {
    flex: 1,
  },
  filterActionButtonSecondary: {
    flex: 1,
    marginRight: 8,
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
  resultRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resultRating: {
    paddingVertical: 2,
  },
  resultReviewCount: {
    marginLeft: 5,
    color: 'gray',
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
