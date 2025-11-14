
import React, { useState } from 'react';
import { View, Text, TextInput, Button, StyleSheet, Image, TouchableOpacity, ScrollView, Linking } from 'react-native';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from '@react-native-firebase/auth';
import { auth } from '../../src/firebaseConfig';
import { useTranslation } from 'react-i18next';
import LanguageSelector from '../components/LanguageSelector';
import Dialog from "react-native-dialog";
import Toast from 'react-native-toast-message';

const LoginScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      Toast.show({
        type: 'error',
        text1: t('alerts.error'),
        text2: t('alerts.enterEmailAndPassword')
      });
      return;
    }
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, trimmedPassword);
    } catch (error: any) {
      console.error('[Login] signInWithEmailAndPassword failed', error);
      const errorMessage =
        typeof error?.message === 'string'
          ? error.message
          : t('alerts.loginError');
      Toast.show({
        type: 'error',
        text1: t('alerts.loginError'),
        text2: errorMessage,
      });
    } finally {
      setLoading(false);
    }
  };

  const showDialog = () => {
    console.log('Email al abrir diálogo:', email); // <-- LÍNEA DE DEPURACIÓN
    setResetEmail(email); // Pre-fill with the email from the input field
    setDialogVisible(true);
  };

  const handleCancel = () => {
    setDialogVisible(false);
  };

  const handleSend = async () => {
    if (resetEmail) {
      try {
        await sendPasswordResetEmail(auth, resetEmail);
        Toast.show({
          type: 'success',
          text1: t('login.emailSent'),
          text2: t('login.passwordResetLinkSent')
        });
      } catch (error: any) {
        Toast.show({
          type: 'error',
          text1: t('alerts.error'),
          text2: error.message
        });
      }
    } else {
      Toast.show({
        type: 'info',
        text1: t('alerts.attention'),
        text2: t('login.invalidEmail')
      });
    }
    setDialogVisible(false);
  };

  const showLegal = async (type: 'terms' | 'privacy') => {
    const url =
      type === 'terms'
        ? 'https://orbitadrone.com/terminos-condiciones-app'
        : 'https://orbitadrone.com/politica-privacidad-app';
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        throw new Error('URL not supported');
      }
    } catch (error) {
      console.error('[Legal] Failed to open legal URL', error);
      Toast.show({
        type: 'error',
        text1: t('alerts.error'),
      });
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Image
        source={require('../../src/assets/images/ORBITA_DRONE_SPOTS.png')}
        style={styles.logo}
      />
      <Text style={styles.title}>{t('login.title')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('login.emailPlaceholder')}
        placeholderTextColor="#888"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        editable={!loading}
      />
      <TextInput
        style={styles.input}
        placeholder={t('login.passwordPlaceholder')}
        placeholderTextColor="#888"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        editable={!loading}
      />
      <TouchableOpacity onPress={showDialog}>
        <Text style={styles.forgotPasswordText}>{t('login.forgotPassword')}</Text>
      </TouchableOpacity>
      <Button title={t('login.loginButton')} onPress={handleLogin} disabled={loading} />
      <View style={styles.buttonSpacer} />
      <Button
        title={t('login.signupButton')}
        onPress={() => navigation.navigate('Signup')}
        disabled={loading}
      />
      <LanguageSelector />
      <View style={styles.legalContainer}>
        <Text style={styles.legalText}>
          {t('login.legalText')}{' '}
          <Text style={styles.linkText} onPress={() => showLegal('terms')}>
            {t('login.termsLink')}
          </Text>{' '}
          &{' '}
          <Text style={styles.linkText} onPress={() => showLegal('privacy')}>
            {t('login.privacyLink')}
          </Text>
        </Text>
      </View>
      
      <Dialog.Container visible={dialogVisible}>
        <Dialog.Title>{t('login.resetPasswordPromptTitle')}</Dialog.Title>
        <Dialog.Description style={styles.dialogDescription}>
          {t('login.resetPasswordPromptMessage')}
        </Dialog.Description>
        <Dialog.Input 
          onChangeText={setResetEmail}
          value={resetEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder={t('login.emailPlaceholder')}
          placeholderTextColor="#666"
          style={styles.dialogInput}
        />
        <Dialog.Button label={t('login.cancel')} onPress={handleCancel} />
        <Dialog.Button label={t('login.send')} onPress={handleSend} />
      </Dialog.Container>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
  },
  logo: {
    width: 150,
    height: 150,
    alignSelf: 'center',
    marginBottom: 24,
    resizeMode: 'contain',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    marginBottom: 12,
    paddingHorizontal: 8,
    color: '#000', // Asegurar que el texto sea visible
  },
  buttonSpacer: {
    marginTop: 12,
  },
  forgotPasswordText: {
    color: '#007BFF',
    textAlign: 'right',
    marginBottom: 12,
  },
  legalContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  legalText: {
    fontSize: 12,
    color: 'gray',
    textAlign: 'center',
  },
  linkText: {
    color: '#007BFF',
    textDecorationLine: 'underline',
  },
  dialogDescription: {
    color: '#333',
  },
  dialogInput: {
    color: '#000',
  },
});

export default LoginScreen;
