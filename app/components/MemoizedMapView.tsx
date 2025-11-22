import React, { memo } from 'react';
import MapView, { Marker, PROVIDER_GOOGLE, MapPressEvent, Region, MapType } from 'react-native-maps';
import { StyleSheet, View, Image } from 'react-native';
import SpotMarker from './SpotMarker';
import MemoizedGeojson from './MemoizedGeojson';

interface MemoizedMapViewProps {
  mapRef: React.RefObject<MapView>;
  region: Region;
  onRegionChangeComplete: (region: Region) => void;
  onPress: (event: MapPressEvent) => void;
  showsUserLocation: boolean;
  showsCompass: boolean;
  mapType: MapType;
  selectedCoordinate: any;
  spots: any[];
  showAirZones: boolean;
  airZones: any;
  handleSpotPress: (spot: any) => void;
  showMarkers: boolean;
  handlePilotMarkerPress?: (userId: string) => void;
  pilotMarkers?: Array<{
    id: string;
    latitude: number;
    longitude: number;
    photoUrl?: string | null;
  }>;
}

const MemoizedMapView = memo((
  { 
    mapRef,
    region,
    onRegionChangeComplete,
    onPress,
    showsUserLocation,
    showsCompass,
    mapType,
    selectedCoordinate,
    spots,
    showAirZones,
    airZones,
    handleSpotPress,
    showMarkers,
    pilotMarkers,
    handlePilotMarkerPress,
  }: MemoizedMapViewProps
) => {
  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      region={region}
      onRegionChangeComplete={onRegionChangeComplete}
      onPress={onPress}
      showsUserLocation={showsUserLocation}
      showsCompass={showsCompass}
      mapType={mapType}
    >
      {selectedCoordinate && <Marker coordinate={selectedCoordinate} pinColor="green" />}
      {showMarkers &&
        spots.map((spot: any) => (
          <SpotMarker key={spot.id} spot={spot} handleSpotPress={handleSpotPress} />
        ))}
      {showAirZones && airZones && (
        <MemoizedGeojson
          geojson={airZones}
          strokeColor="red"
          fillColor="rgba(255,0,0,0.3)"
          strokeWidth={2}
        />
      )}
      {showMarkers &&
        pilotMarkers?.map(marker => (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.latitude,
              longitude: marker.longitude,
            }}
            anchor={{x: 0.5, y: 0.5}}
            onPress={() => handlePilotMarkerPress?.(marker.id)}>
            <View style={styles.pilotMarkerWrapper}>
              {marker.photoUrl ? (
                <Image source={{uri: marker.photoUrl}} style={styles.pilotMarkerImage} />
              ) : (
                <View style={styles.pilotMarkerFallback} />
              )}
            </View>
          </Marker>
        ))}
    </MapView>
  );
});

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
  pilotMarkerWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    backgroundColor: '#fff',
    elevation: 4,
  },
  pilotMarkerImage: {
    width: '100%',
    height: '100%',
  },
  pilotMarkerFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#007bff',
  },
});

export default MemoizedMapView;
