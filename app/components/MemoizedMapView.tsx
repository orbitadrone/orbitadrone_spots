import React, { memo, useEffect, useState } from 'react';
import MapView, { Marker, PROVIDER_GOOGLE, MapPressEvent, Region, MapType } from 'react-native-maps';
import { StyleSheet, View, Image } from 'react-native';
import SpotMarker from './SpotMarker';
import MemoizedGeojson from './MemoizedGeojson';

type PilotMarkerItem = {
  id: string;
  latitude: number;
  longitude: number;
  photoUrl?: string | null;
};

type EventMarkerItem = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
};

type PilotMarkerProps = {
  marker: PilotMarkerItem;
  onMarkerPress?: (userId: string) => void;
};

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
  handleSpotPress: (spot: any, event: any) => void;
  showMarkers: boolean;
  handlePilotMarkerPress?: (userId: string) => void;
  pilotMarkers?: PilotMarkerItem[];
  eventMarkers?: EventMarkerItem[];
  handleEventMarkerPress?: (eventId: string) => void;
  children?: React.ReactNode;
}

const PilotMarker = memo(({marker, onMarkerPress}: PilotMarkerProps) => {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    // Reset tracking when the image source changes so the new one renders.
    setTracksViewChanges(true);
  }, [marker.photoUrl]);

  return (
    <Marker
      coordinate={{
        latitude: marker.latitude,
        longitude: marker.longitude,
      }}
      anchor={{x: 0.5, y: 0.5}}
      onPress={() => onMarkerPress?.(marker.id)}
      tracksViewChanges={tracksViewChanges}>
      <View style={styles.pilotMarkerWrapper}>
        {marker.photoUrl ? (
          <Image
            source={{uri: marker.photoUrl}}
            style={styles.pilotMarkerImage}
            onLoad={() => setTracksViewChanges(false)}
          />
        ) : (
          <View style={styles.pilotMarkerFallback} />
        )}
      </View>
    </Marker>
  );
});

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
    eventMarkers,
    handleEventMarkerPress,
    children,
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
      showsMyLocationButton={false}
      showsCompass={showsCompass}
      mapType={mapType}
    >
      {children}
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
          <PilotMarker
            key={marker.id}
            marker={marker}
            onMarkerPress={handlePilotMarkerPress}
          />
        ))}
      {showMarkers &&
        eventMarkers?.map(marker => (
          <Marker
            key={`event-${marker.id}`}
            coordinate={{latitude: marker.latitude, longitude: marker.longitude}}
            pinColor="#facc15"
            title={marker.title}
            onPress={() => handleEventMarkerPress?.(marker.id)}
          />
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
