import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const LanguageSelector = () => {
  const { t, i18n } = useTranslation();

  const isSpanish = i18n.language === 'es';

  const changeLanguage = () => {
    const newLang = isSpanish ? 'en' : 'es';
    i18n.changeLanguage(newLang);
  };

  const buttonText = isSpanish ? t('languageSelector.switchToEnglish') : t('languageSelector.switchToSpanish');
  const flag = isSpanish ? '🇬🇧' : '🇪🇸';

  return (
    <TouchableOpacity onPress={changeLanguage} style={styles.container}>
      <Text style={styles.text}>{buttonText}</Text>
      <Text style={styles.flag}>{flag}</Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
  },
  flag: {
    fontSize: 20,
    marginLeft: 0.5,
  },
  text: {
    color: '#007BFF',
    fontSize: 14,
  },
});

export default LanguageSelector;
