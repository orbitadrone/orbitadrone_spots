import React from 'react';
import {NavigationContainer, LinkingOptions} from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useTranslation } from 'react-i18next';
import AppNavigator from './AppNavigator'; // El que tiene el BottomTabNavigator
import LoginScreen from '../(auth)/index';
import SignupScreen from '../(auth)/signup';
import LegalScreen from '../screens/LegalScreen';
import type {
  AuthenticatedUser,
  RootStackParamList,
  RootStackScreenProps,
} from '../../src/navigation/types';

const Stack = createStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['https://orbitadrone.com', 'orbitadrone://'],
  config: {
    screens: {
      App: {
        screens: {
          SpotDetail: 'spot/:spotId',
          EventDetail: 'event/:eventId',
          Main: {
            screens: {
              Map: 'map',
              Feed: 'feed',
              MySpots: 'my-spots',
              Profile: 'profile',
            },
          },
        },
      },
      Login: 'login',
      Signup: 'signup',
    },
  },
};

const RootNavigator = ({ user }: { user: AuthenticatedUser }) => {
  const { t } = useTranslation();

  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
        {user ? (
          <Stack.Screen name="App" component={AppNavigator} />
        ) : (
          <>
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ title: t('login.title') }}
            />
            <Stack.Screen
              name="Signup"
              component={SignupScreen}
              options={{ title: t('signup.title') }}
            />
          </>
        )}
        <Stack.Screen
          name="LegalScreen"
          component={LegalScreen}
          options={({route}: {route: RootStackScreenProps<'LegalScreen'>['route']}) => ({
            title: route.params.title,
            headerShown: true,
          })}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;
