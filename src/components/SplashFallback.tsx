import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

const splashImage = require('../assets/images/ORBITA_DRONE_SPOTS.png');

type SplashFallbackProps = {
  message?: string;
  showIndicator?: boolean;
};

const SplashFallback: React.FC<SplashFallbackProps> = ({
  message,
  showIndicator = true,
}) => (
  <View style={styles.container}>
    <Image source={splashImage} style={styles.logo} resizeMode="contain" />
    {showIndicator ? <ActivityIndicator color="#ffffff" /> : null}
    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020202',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logo: {
    width: 220,
    height: 220,
    marginBottom: 24,
  },
  message: {
    marginTop: 12,
    fontSize: 14,
    color: '#ffffff',
    textAlign: 'center',
  },
});

export default SplashFallback;
