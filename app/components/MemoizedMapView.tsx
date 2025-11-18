import React, { memo } from 'react';
import MapView, { Marker, PROVIDER_GOOGLE, MapPressEvent, Region, MapType } from 'react-native-maps';
import { StyleSheet } from 'react-native';
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
    handleSpotPress
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
      {spots.map((spot: any) => (
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
    </MapView>
  );
});

const styles = StyleSheet.create({
  map: {
    flex: 1,
  },
});

export default MemoizedMapView;
