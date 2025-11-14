import React, { memo } from 'react';
import { Marker } from 'react-native-maps';
import { View, StyleSheet } from 'react-native';

const SpotMarker = memo(
  ({
    spot,
    handleSpotPress,
  }: {
    spot: any;
    handleSpotPress: (spot: any, event: any) => void;
  }) => {
    return (
      <Marker
        key={spot.id}
        coordinate={{
          latitude: spot.coordinates.latitude,
          longitude: spot.coordinates.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        onPress={e => handleSpotPress(spot, e)}
        tracksViewChanges={false}
      >
        <View style={styles.markerDot} />
      </Marker>
    );
  },
);

const styles = StyleSheet.create({
  markerDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF385C',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
});

export default SpotMarker;
