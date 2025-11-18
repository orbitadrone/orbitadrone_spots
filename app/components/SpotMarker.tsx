import React, { memo } from 'react';
import { Marker } from 'react-native-maps';

const SpotMarker = memo(
  ({
    spot,
    handleSpotPress,
  }: {
    spot: any;
    handleSpotPress: (spot: any, event: any) => void;
  }) => {
    const coordinates = spot.coordinates;
    const latitude =
      coordinates?.latitude ??
      coordinates?._latitude ??
      spot.latitude ??
      spot.lat;
    const longitude =
      coordinates?.longitude ??
      coordinates?._longitude ??
      spot.longitude ??
      spot.lng ??
      spot.lon;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return null;
    }

    return (
      <Marker
        key={spot.id}
        coordinate={{
          latitude,
          longitude,
        }}
        pinColor="#007BFF"
        onPress={e => handleSpotPress(spot, e)}
      />
    );
  },
);

export default SpotMarker;
