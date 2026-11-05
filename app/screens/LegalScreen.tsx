import React, { useLayoutEffect } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import type {RootStackScreenProps} from '../../src/navigation/types';

const LegalScreen = ({navigation, route}: RootStackScreenProps<'LegalScreen'>) => {
  const { title, content } = route.params;

  // Usar useLayoutEffect para establecer el título de la pantalla
  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.content}>{content}</Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  content: {
    fontSize: 16,
    lineHeight: 24,
  },
});

export default LegalScreen;
