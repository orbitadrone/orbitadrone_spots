import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Button, Alert, Platform, PermissionsAndroid, Switch, Text } from 'react-native';
import MapView, { PROVIDER_GOOGLE, Marker } from 'react-native-maps';
import { auth } from '../src/firebaseConfig';
import rnFirebaseAuth from '@react-native-firebase/auth';
import { useTranslation } from 'react-i18next';
import Geolocation, { GeolocationResponse } from '@react-native-community/geolocation';

const HomeScreen = () => {
  const { t } = useTranslation();
  const [location, setLocation] = useState<GeolocationResponse | null>(null);
  const [isSatelliteMap, setIsSatelliteMap] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const requestLocationPermission = async () => {
      if (Platform.OS === 'ios') {
        Geolocation.requestAuthorization();
      } else if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: t('alerts.locationPermissionTitle'),
              message: t('alerts.locationPermissionMessage'),
              buttonNeutral: t('alerts.askMeLater'),
              buttonNegative: t('alerts.cancel'),
              buttonPositive: t('alerts.ok'),
            },
          );
          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            
          } else {
            
            Alert.alert(t('alerts.locationPermissionDenied'), t('alerts.locationPermissionDeniedMessage'));
            return;
          }
        } catch (err: any) {
          
          setErrorMsg(err.message);
          Alert.alert(t('alerts.locationError'), err.message);
          return;
        }
      }

      Geolocation.getCurrentPosition(
        (position) => {
          
          setLocation(position);
        },
        (error) => {
          Alert.alert(t('alerts.locationError'), error.message);
        },
        { enableHighAccuracy: false, timeout: 30000, maximumAge: 10000 }
      );
    };

    requestLocationPermission();
  }, [t]);

  const handleLogout = async () => {
    try {
      // Use React Native Firebase for sign-out to avoid mixing SDKs
      await rnFirebaseAuth().signOut();
      // onAuthStateChanged in App.tsx will handle navigation to Login
    } catch (error: any) {
      Alert.alert(t('alerts.logoutError'), error.message);
    }
  };

  return (
    <View style={styles.container}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        mapType={isSatelliteMap ? "satellite" : "standard"}
        region={location ? {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        } : {
          latitude: 37.78825, // Default to San Francisco if location not available
          longitude: -122.4324,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        }}
      >
        {location && (
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }}
            title={t('home.myLocation')}
            description={t('home.myCurrentLocation')}
          />
        )}
      </MapView>
      <View style={styles.mapTypeToggle}>
        <Text style={styles.mapTypeToggleText}>{t('home.satellite')}</Text>
        <Switch
          onValueChange={setIsSatelliteMap}
          value={isSatelliteMap}
        />
      </View>
      <View style={styles.logoutButton}>
        <Button title={t('home.logoutButton')} onPress={handleLogout} color="#f44336" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  logoutButton: {
    position: 'absolute',
    top: 50,
    right: 10,
  },
  mapTypeToggle: {
    position: 'absolute',
    top: 50,
    left: 10,
    zIndex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderRadius: 10,
    padding: 5,
  },
  mapTypeToggleText: {
    color: 'black',
  },
});

export default HomeScreen;
